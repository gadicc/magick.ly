import { createUuidV7 } from "../lib/ids";
import type { RitualWriteRequest, RitualWriteResult } from "./writes";

/** Identify the new list projection separately from old persisted Gongo subscriptions. */
export const ritualListSubscriptionArgs = { projectionVersion: 1 } as const;

const prefix = "magickli:ritual-recovery:v1:";
type Row = Record<string, unknown>;
/** Durable browser storage adapter; writes must throw rather than silently lose data. */
export interface DraftStorage {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** One editor instance owns a draft ID; concurrent tabs never overwrite each other's work. */
export interface RitualDraft {
  kind: "draft";
  id: string;
  ownerId: string;
  docId: string;
  source: string;
  savedSource: string;
  baseRevisionId: string | null;
  baseUpdatedAt: number | null;
  updatedAt: number;
  request?: RitualWriteRequest;
}
/** Immutable backup of an old pending Gongo mutation, before a server poll can replace it. */
export interface LegacyRitualDraft {
  kind: "legacy";
  id: string;
  ownerId: string | null;
  docId: string | null;
  collection: "docs" | "docRevisions";
  raw: Row;
  updatedAt: number;
}
/** A creation request remains attached until its original result can be confirmed. */
export interface RitualCreationDraft {
  kind: "creation";
  id: string;
  ownerId: string;
  docId: null;
  title: string;
  scopeKey: string;
  minGrade: number;
  source: string;
  updatedAt: number;
  request?: Extract<RitualWriteRequest, { kind: "create" }>;
  createdDocId?: string;
}
export type RitualRecovery =
  | RitualDraft
  | LegacyRitualDraft
  | RitualCreationDraft;
/** Existing Gongo transport; callers must explicitly enable its network connection. */
export type RitualRpc = (name: string, payload: object) => Promise<unknown>;

/** Only known wire identity fields use this legacy conversion. */
export function clientRitualId(value: unknown): string | null {
  let id = value;
  if (
    value &&
    typeof value === "object" &&
    "_bsontype" in value &&
    (value._bsontype === "ObjectID" || value._bsontype === "ObjectId") &&
    "toHexString" in value &&
    typeof value.toHexString === "function"
  )
    id = value.toHexString();
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id)
    ? id.toLowerCase()
    : null;
}
function row(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Retain records rather than deleting them on success, account changes, or conflicts. */
export function persistRitualRecovery(
  storage: DraftStorage,
  value: RitualRecovery,
): void {
  storage.setItem(prefix + value.id, JSON.stringify(value));
}
/** Show only records attributed to this account; retain corrupt/unattributed data untouched. */
export function readRitualRecovery(
  storage: DraftStorage,
  ownerId: string,
  docId?: string,
): RitualRecovery[] {
  const result: RitualRecovery[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
      if (
        !row(value) ||
        value.ownerId !== ownerId ||
        (docId && value.docId !== docId) ||
        typeof value.id !== "string" ||
        typeof value.updatedAt !== "number"
      )
        continue;
      if (
        value.kind === "draft" &&
        typeof value.source === "string" &&
        typeof value.savedSource === "string"
      )
        result.push(value as unknown as RitualDraft);
      if (value.kind === "legacy" && row(value.raw))
        result.push(value as unknown as LegacyRitualDraft);
      if (
        value.kind === "creation" &&
        typeof value.title === "string" &&
        typeof value.source === "string" &&
        typeof value.scopeKey === "string"
      )
        result.push(value as unknown as RitualCreationDraft);
    } catch {
      /* Corrupt recovery remains stored for manual inspection. */
    }
  }
  return result.sort(
    (a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id),
  );
}

interface LegacyCollection {
  find(query: Row, options?: Row): { toArraySync(): Row[] };
  _update(id: string, value: Row): unknown;
}
/** Narrow existing Gongo cache surface, including its raw non-pending update operation. */
export interface LegacyRitualCache {
  collection(name: string): LegacyCollection;
}

/**
 * Archive before pausing a generic mutation. If durable storage fails, the caller
 * must not poll: incoming records could otherwise replace the only pending copy.
 */
export async function preservePendingRitualChanges(
  db: LegacyRitualCache,
  storage: DraftStorage,
): Promise<void> {
  for (const collection of ["docs", "docRevisions"] as const) {
    const coll = db.collection(collection);
    for (const pending of coll
      .find(
        { __pendingSince: { $exists: true } },
        { includePendingDeletes: true },
      )
      .toArraySync()) {
      const raw = { ...pending };
      delete raw.__error;
      delete raw.__idbWaiting;
      const serialized = JSON.stringify(raw, (key, value) =>
        key === "ref" ? undefined : value,
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${collection}:${serialized}`),
      );
      const id = `legacy:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      if (!storage.getItem(prefix + id))
        persistRitualRecovery(storage, {
          kind: "legacy",
          id,
          collection,
          ownerId: clientRitualId(raw.userId),
          docId: clientRitualId(collection === "docs" ? raw._id : raw.docId),
          raw: JSON.parse(serialized),
          updatedAt:
            typeof raw.__pendingSince === "number"
              ? raw.__pendingSince
              : Date.now(),
        });
      if (
        typeof pending._id === "string" &&
        pending.__error !== "RITUAL_EDITOR_UPGRADE_REQUIRED"
      )
        coll._update(pending._id, {
          ...pending,
          __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
        });
    }
  }
}

function entries(value: unknown, coll: string): Row[] {
  if (!row(value) || !Array.isArray(value.results))
    throw new Error("The server did not return a ritual snapshot.");
  return value.results.flatMap((result) =>
    row(result) && result.coll === coll && Array.isArray(result.entries)
      ? result.entries.filter(row)
      : [],
  );
}
/** Fresh editor source with both tokens required for a compare-and-swap save. */
export interface RitualSnapshot {
  docId: string;
  source: string;
  revisionId: string | null;
  updatedAt: number | null;
}
/** Always ask for a full current snapshot; cached history is not a permission grant. */
export async function loadRitualSnapshot(
  rpc: RitualRpc,
  docId: string,
): Promise<RitualSnapshot> {
  const docs = entries(
    await rpc("subscribe", {
      name: "doc",
      args: { _id: docId },
      updatedAt: {},
    }),
    "docs",
  );
  const doc = docs.find((item) => clientRitualId(item._id) === docId);
  if (!doc || doc.canEdit !== true || doc.__deleted)
    throw new Error(
      "This ritual is unavailable for editing by the signed-in account.",
    );
  const revisionId = clientRitualId(doc.docRevisionId);
  if (doc.docRevisionId != null && !revisionId)
    throw new Error("The ritual has an invalid current revision.");
  const updatedAt =
    doc.__updatedAt == null
      ? null
      : typeof doc.__updatedAt === "number" &&
          Number.isSafeInteger(doc.__updatedAt) &&
          doc.__updatedAt >= 0
        ? doc.__updatedAt
        : undefined;
  if (updatedAt === undefined)
    throw new Error("The ritual has an invalid version token.");
  if (!revisionId) return { docId, source: "", revisionId: null, updatedAt };
  const revisions = entries(
    await rpc("subscribe", {
      name: "docRevisions",
      args: { docId },
      updatedAt: {},
    }),
    "docRevisions",
  );
  const revision = revisions.find(
    (item) =>
      clientRitualId(item._id) === revisionId &&
      clientRitualId(item.docId) === docId &&
      !item.__deleted,
  );
  if (!revision || typeof revision.text !== "string")
    throw new Error("The current ritual source is unavailable.");
  return { docId, source: revision.text, revisionId, updatedAt };
}

/** Fork on each mount so another tab or recovered session cannot overwrite this draft. */
export function newRitualDraft(
  ownerId: string,
  snapshot: RitualSnapshot,
  recovered?: RitualDraft,
): RitualDraft {
  return {
    kind: "draft",
    id: createUuidV7(),
    ownerId,
    docId: snapshot.docId,
    source: recovered?.source ?? snapshot.source,
    savedSource: recovered?.savedSource ?? snapshot.source,
    baseRevisionId: recovered ? recovered.baseRevisionId : snapshot.revisionId,
    baseUpdatedAt: recovered ? recovered.baseUpdatedAt : snapshot.updatedAt,
    updatedAt: Date.now(),
    ...(recovered?.request ? { request: recovered.request } : {}),
  };
}

/** Validate acknowledgement before it can replace a draft's concurrency tokens. */
export function ritualWriteResult(
  value: unknown,
  request: RitualWriteRequest,
): RitualWriteResult {
  if (!row(value) || typeof value.ok !== "boolean")
    throw new Error("The save result is unknown. Retry the pending request.");
  if (value.ok) {
    if (
      !clientRitualId(value.docId) ||
      (request.kind !== "create" && value.docId !== request.docId) ||
      (value.revisionId !== null && !clientRitualId(value.revisionId)) ||
      typeof value.updatedAt !== "number" ||
      !Number.isSafeInteger(value.updatedAt) ||
      value.updatedAt < 0 ||
      typeof value.replayed !== "boolean"
    )
      throw new Error(
        "The save acknowledgement is invalid. Retry the pending request.",
      );
  } else if (
    typeof value.message !== "string" ||
    typeof value.code !== "string" ||
    ![
      "UPGRADE_REQUIRED",
      "INVALID_REQUEST",
      "INVALID_SOURCE",
      "NOT_AUTHENTICATED",
      "ACCOUNT_CHANGED",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_STATE",
      "CONFLICT",
      "IDEMPOTENCY_KEY_REUSED",
      "TRANSACTIONS_REQUIRED",
      "UNAVAILABLE",
    ].includes(value.code)
  )
    throw new Error("The save result is unknown. Retry the pending request.");
  return value as RitualWriteResult;
}

/** Persist an immutable request before dispatch; retry it even if typing continues. */
export async function submitRitualDraft(
  draft: RitualDraft,
  rpc: RitualRpc,
  save: (draft: RitualDraft) => void,
  current: () => RitualDraft,
): Promise<RitualWriteResult> {
  const request =
    draft.request ??
    ({
      version: 1,
      expectedActorId: draft.ownerId,
      kind: "save",
      operationId: createUuidV7(),
      docId: draft.docId,
      expectedRevisionId: draft.baseRevisionId,
      expectedUpdatedAt: draft.baseUpdatedAt,
      source: draft.source,
    } satisfies RitualWriteRequest);
  if (
    request.kind !== "save" ||
    request.docId !== draft.docId ||
    request.expectedActorId !== draft.ownerId
  )
    throw new Error("Recovered request does not belong to this ritual.");
  save({ ...draft, request });
  const response = await rpc("ritualWrite", request);
  const result = ritualWriteResult(response, request);
  const latest = current();
  if (
    latest.ownerId !== draft.ownerId ||
    latest.docId !== draft.docId ||
    latest.id !== draft.id
  )
    throw new Error(
      "The editor changed while saving. The original request is retained.",
    );
  if (result.ok) {
    save({
      ...latest,
      request: undefined,
      savedSource: request.source,
      baseRevisionId: result.revisionId,
      baseUpdatedAt: result.updatedAt,
      updatedAt: Date.now(),
    });
  } else if (
    result.code !== "UNAVAILABLE" &&
    result.code !== "ACCOUNT_CHANGED"
  ) {
    // Preserve the rejected request in its old record; corrections get a fresh request.
    save({
      ...latest,
      id: createUuidV7(),
      request: undefined,
      updatedAt: Date.now(),
    });
  }
  return result;
}

/** Bounded waiting preserves an uncertain request for an identical retry. */
export function boundedRitualRpc(
  call: RitualRpc,
  timeoutMs = 20000,
): RitualRpc {
  return (name, payload) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "The request could not be confirmed. Your draft is retained; retry the same pending request.",
            ),
          ),
        timeoutMs,
      );
      void call(name, payload)
        .then(resolve, reject)
        .finally(() => clearTimeout(timeout));
    });
}

/** Explicit local export; no draft data is sent to another service. */
export function downloadRitualRecovery(
  value: unknown,
  filename = "ritual-recovery.json",
): void {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          value,
          (key, item) => (key === "ref" ? undefined : item),
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
