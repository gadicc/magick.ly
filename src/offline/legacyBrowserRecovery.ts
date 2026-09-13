import SuperJSON from "superjson";
import type { RitualOfflineDatabase } from "./storage";

const RECOVERY_PREFIX = "magickli:ritual-recovery:v1:";
const QUARANTINE_KEY_PREFIX = "legacy-browser:v1:";
const PENDING_FIELDS = [
  "__pendingSince",
  "__pendingInsert",
  "__pendingDelete",
  "__pendingBase",
] as const;

type Row = Record<string, unknown>;

interface LegacyCursor {
  toArraySync(): unknown[];
}

interface LegacyCollection {
  find(query?: Row, options?: Row): LegacyCursor;
}

/** Narrow Gongo surface used before the legacy browser cache can be retired. */
export interface LegacyBrowserCache {
  populated: boolean;
  idb: {
    on(event: "collectionsPopulated", listener: () => void): void;
    off(event: "collectionsPopulated", listener: () => void): void;
  };
  collection(name: string): LegacyCollection;
}

/** Browser recovery storage is enumerated without parsing, including corrupt values. */
export interface LegacyRecoveryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export interface LegacyRecoveryArchiveReport {
  pendingRitualOperations: number;
  pendingStudyOperations: number;
  recoveryEntries: number;
  anonymousStudyRows: number;
  quarantinedRows: number;
}

export interface LegacyBrowserFenceOptions {
  cache: LegacyBrowserCache;
  storage: LegacyRecoveryStorage;
  database: RitualOfflineDatabase;
  /** Must synchronously make every future legacy transport call inert. */
  blockNetwork(): void;
  /** Wait for a call that had already entered the transport when it was blocked. */
  settleNetwork?(): Promise<void>;
  /** May pause legacy mutations only after their first verified archive. */
  afterInitialArchive?(): Promise<void>;
  /** Stop subscriptions and persist the fence only after the final verified archive. */
  finalizeFence(): Promise<void>;
}

function row(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPendingRitualOperation(value: unknown): value is Row {
  return (
    row(value) && PENDING_FIELDS.some((field) => Object.hasOwn(value, field))
  );
}

function legacyOwnerId(value: unknown): string | null {
  let candidate = value;
  if (
    row(value) &&
    (value._bsontype === "ObjectID" || value._bsontype === "ObjectId") &&
    typeof value.toHexString === "function"
  )
    candidate = value.toHexString();
  return typeof candidate === "string" && /^[a-f\d]{24}$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

function runtimeElementRef(value: unknown): boolean {
  if (!row(value) || Reflect.ownKeys(value).length !== 1) return false;
  return typeof Node !== "undefined" && value.current instanceof Node;
}

function losslessGongoValue(
  value: unknown,
  copies = new WeakMap<object, unknown>(),
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  )
    return value;
  if (typeof value !== "object")
    throw new Error("Legacy browser recovery contains an unsupported value.");
  const existing = copies.get(value);
  if (existing) return existing;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw new Error("Legacy browser recovery contains an invalid date.");
    const date = new Date(value.getTime());
    copies.set(value, date);
    return date;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    copies.set(value, clone);
    const indexes = new Set(
      Array.from({ length: value.length }, (_, index) => String(index)),
    );
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index))
        throw new Error("Legacy browser recovery contains a sparse array.");
      clone.push(losslessGongoValue(value[index], copies));
    }
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          key !== "length" && (typeof key !== "string" || !indexes.has(key)),
      )
    )
      throw new Error("Legacy browser recovery contains array metadata.");
    return clone;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error("Legacy browser recovery contains an unsupported object.");
  const clone: Row = {};
  copies.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    )
      throw new Error("Legacy browser recovery contains object metadata.");
    // JRT role blocks attach a React DOM ref after render; it was never in IDB.
    if (key === "ref" && runtimeElementRef(descriptor.value)) continue;
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: losslessGongoValue(descriptor.value, copies),
      writable: true,
    });
  }
  return clone;
}

/**
 * SuperJSON retains the primitive, Date and reference semantics in persisted
 * Gongo documents. Unsupported structured-clone types fail before certification.
 */
function serializeGongoRow(value: Row): string {
  const serialized = SuperJSON.stringify(losslessGongoValue(value));
  if (SuperJSON.stringify(SuperJSON.parse(serialized)) !== serialized)
    throw new Error("Legacy browser recovery serialization is not stable.");
  return serialized;
}

async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function quarantineRow(
  originalKey: string,
  serialized: string,
): Promise<{ key: string; originalKey: string; serialized: string }> {
  const digest = await sha256(
    `${originalKey.length}:${originalKey}${serialized}`,
  );
  return {
    key: QUARANTINE_KEY_PREFIX + digest,
    originalKey,
    serialized,
  };
}

/** Resolve only after every configured Gongo collection has finished IDB population. */
export function waitForLegacyBrowserPopulation(
  cache: LegacyBrowserCache,
): Promise<void> {
  if (cache.populated) return Promise.resolve();
  return new Promise((resolve) => {
    const populated = () => {
      cache.idb.off("collectionsPopulated", populated);
      resolve();
    };
    cache.idb.on("collectionsPopulated", populated);
    // Close the listener-registration race without treating a session as authority.
    if (cache.populated) populated();
  });
}

/**
 * Copy legacy pending ritual work, recovery strings, and unattributed study data
 * into locked quarantine. Existing rows are immutable, and every write is read
 * back after commit before the archive is reported as safe.
 */
export async function preserveLegacyBrowserRecovery(
  cache: LegacyBrowserCache,
  storage: LegacyRecoveryStorage,
  database: RitualOfflineDatabase,
): Promise<LegacyRecoveryArchiveReport> {
  await waitForLegacyBrowserPopulation(cache);

  const pending = ["docs", "docRevisions"].flatMap((collection) =>
    cache
      .collection(collection)
      .find({}, { includePendingDeletes: true })
      .toArraySync()
      .filter(isPendingRitualOperation)
      .map((value) => ({
        originalKey: `gongo:${collection}:${String(value._id ?? "unknown")}`,
        serialized: serializeGongoRow(value),
      })),
  );
  const studyRows = cache
    .collection("studySet")
    .find({}, { includePendingDeletes: true })
    .toArraySync()
    .filter(row)
    .filter(
      (value) =>
        PENDING_FIELDS.some((field) => Object.hasOwn(value, field)) ||
        !legacyOwnerId(value.userId),
    );
  const pendingStudyOperations = studyRows.filter((value) =>
    PENDING_FIELDS.some((field) => Object.hasOwn(value, field)),
  ).length;
  const anonymousStudyRows = studyRows.filter(
    (value) => !legacyOwnerId(value.userId),
  ).length;
  const study = studyRows.map((value) => ({
    originalKey: `gongo:studySet:${String(value._id ?? "unknown")}`,
    serialized: serializeGongoRow(value),
  }));
  const recovery: { originalKey: string; serialized: string }[] = [];
  const storageKeys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of storageKeys) {
    if (!key?.startsWith(RECOVERY_PREFIX)) continue;
    const serialized = storage.getItem(key);
    if (serialized === null) continue;
    recovery.push({ originalKey: `localStorage:${key}`, serialized });
  }

  const candidates = await Promise.all(
    [...pending, ...recovery, ...study].map(({ originalKey, serialized }) =>
      quarantineRow(originalKey, serialized),
    ),
  );
  const entries = [
    ...new Map(candidates.map((entry) => [entry.key, entry])).values(),
  ];

  await database.transaction("rw", database.quarantine, async () => {
    for (const entry of entries) {
      const existing = await database.quarantine.get(entry.key);
      if (existing) {
        if (
          existing.originalKey !== entry.originalKey ||
          existing.serialized !== entry.serialized
        )
          throw new Error("Legacy quarantine key collision.");
      } else await database.quarantine.add(entry);
    }
  });

  // Verify after the transaction commits; an in-transaction read alone is not
  // evidence that IndexedDB durably accepted the copy.
  for (const entry of entries) {
    const stored = await database.quarantine.get(entry.key);
    if (
      stored?.originalKey !== entry.originalKey ||
      stored.serialized !== entry.serialized
    )
      throw new Error("Legacy browser recovery verification failed.");
  }

  return {
    pendingRitualOperations: pending.length,
    pendingStudyOperations,
    recoveryEntries: recovery.length,
    anonymousStudyRows,
    quarantinedRows: entries.length,
  };
}

/**
 * Start the SQL handoff fence. Network blocking happens synchronously and is
 * intentionally not rolled back after a storage failure; retry can safely
 * resume archival without allowing old requests to escape.
 */
export function fenceLegacyBrowserRecoveryForSql(
  options: LegacyBrowserFenceOptions,
): Promise<LegacyRecoveryArchiveReport> {
  options.blockNetwork();
  return (async () => {
    await options.settleNetwork?.();
    await preserveLegacyBrowserRecovery(
      options.cache,
      options.storage,
      options.database,
    );
    await options.afterInitialArchive?.();
    const report = await preserveLegacyBrowserRecovery(
      options.cache,
      options.storage,
      options.database,
    );
    await options.finalizeFence();
    return report;
  })();
}
