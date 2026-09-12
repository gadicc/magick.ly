import "server-only";
import { createHash } from "node:crypto";
import type { LoomFileCreateInput, LoomFileRecord } from "@gadicc/loom/files";
import { and, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { loomFilesTable } from "../db/schema/loomFiles";
import { ritualFileLinks, ritualUploadIntents } from "../db/schema/ritualFiles";
import { rituals } from "../db/schema/rituals";
import { getRitualAccess } from "../doc/access";
import {
  loadSqlRitualPrincipal,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "../doc/sqlPolicy";
import { createUuidV7 } from "../lib/ids";
import type {
  RitualUploadClaim,
  RitualUploadLocation,
  RitualUploadPublication,
  ValidatedRitualImage,
} from "./ritualUploadContracts";
import {
  type InitiateRitualUpload,
  isCanonicalUploadId,
  parseInitiateRitualUpload,
  RITUAL_IMAGE_LIMITS,
  type RitualUploadCode,
  RitualUploadError,
  type RitualUploadReceipt,
} from "./ritualUploadProtocol";

type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "execute"
>;
/** Transaction-capable PostgreSQL connection; provider I/O must stay outside this adapter. */
export interface SqlRitualUploadDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}
type Intent = typeof ritualUploadIntents.$inferSelect;
// JSON string decoding preserves a leading BOM even in PGlite's text decoder.
const intentFields = {
  ...getTableColumns(ritualUploadIntents),
  filename: sql<string>`to_json(${ritualUploadIntents.filename})`,
};
const fileFields = {
  ...getTableColumns(loomFilesTable),
  originalFilename: sql<
    string | null
  >`to_json(${loomFilesTable.originalFilename})`,
};
/** Server-only staging/canonical identity; never send this as a browser capability. */
export interface RitualUploadIntentDescriptor {
  request: InitiateRitualUpload;
  fileId: string;
  attachmentId: string;
  staging: RitualUploadLocation;
  canonical: RitualUploadLocation;
  intentExpiresAtMs: number;
  capabilityExpiresAtMs: number;
}
/** Sign a bounded direct capability separately, after this SQL authorization completes. */
export type InitiatedRitualUpload =
  | {
      kind: "initiated";
      replayed: boolean;
      intent: RitualUploadIntentDescriptor;
    }
  | { kind: "completed"; receipt: RitualUploadReceipt };

export const RITUAL_UPLOAD_SQL_LIMITS = Object.freeze({
  intentMs: 24 * 60 * 60 * 1000,
  claimMs: 120_000,
  capabilityMs: 10 * 60 * 1000,
});
function fail(code: RitualUploadCode): never {
  throw new RitualUploadError(code);
}
const active = (signal: AbortSignal) => {
  if (signal.aborted) fail("ABORTED");
};
const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0) &&
  value <= 8_640_000_000_000_000;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
  );
const sameLocation = (a: RitualUploadLocation, b: RitualUploadLocation) =>
  a.provider === b.provider &&
  a.bucket === b.bucket &&
  a.objectKey === b.objectKey;
function location(value: unknown): value is RitualUploadLocation {
  return (
    plain(value) &&
    Object.keys(value).length === 3 &&
    [value.provider, value.bucket, value.objectKey].every(
      (v) =>
        typeof v === "string" &&
        v.length > 0 &&
        v.length <= 2048 &&
        v.isWellFormed() &&
        !v.includes("\0"),
    ) &&
    typeof value.provider === "string" &&
    !!value.provider.trim() &&
    typeof value.bucket === "string" &&
    !!value.bucket.trim()
  );
}
function requestOf(row: Intent): InitiateRitualUpload {
  const request = parseInitiateRitualUpload({
    version: 1,
    operationId: row.operationId,
    expectedActorId: row.actorId,
    ritualId: row.ritualId,
    filename: row.filename,
    byteSize: row.byteSize,
    contentType: row.contentType,
    sha256: row.sha256,
  });
  if (!request || digest(request) !== row.requestHash) fail("UNAVAILABLE");
  return request;
}
function locations(row: Intent) {
  return {
    staging: {
      provider: row.stagingProvider,
      bucket: row.stagingBucket,
      objectKey: row.stagingObjectKey,
    },
    canonical: {
      provider: row.canonicalProvider,
      bucket: row.canonicalBucket,
      objectKey: row.canonicalObjectKey,
    },
  };
}
function claimOf(row: Intent): RitualUploadClaim {
  if (!row.claimId || !row.claimExpiresAt) fail("UNAVAILABLE");
  return {
    request: requestOf(row),
    fileId: row.fileId,
    attachmentId: row.attachmentId,
    ...locations(row),
    intentExpiresAtMs: row.expiresAt.getTime(),
    claimId: row.claimId,
    claimExpiresAtMs: row.claimExpiresAt.getTime(),
  };
}
function receiptOf(row: Intent): RitualUploadReceipt {
  if (!row.completedAt) fail("UNAVAILABLE");
  const request = requestOf(row);
  return {
    operationId: row.operationId,
    actorId: row.actorId,
    ritualId: row.ritualId,
    fileId: row.fileId,
    attachmentId: row.attachmentId,
    sha256: request.sha256,
    byteSize: request.byteSize,
    contentType: request.contentType,
    completedAtMs: row.completedAt.getTime(),
  };
}
function exactClaim(value: unknown, row: Intent): value is RitualUploadClaim {
  if (
    !plain(value) ||
    Object.keys(value).length !== 8 ||
    !location(value.staging) ||
    !location(value.canonical)
  )
    return false;
  const request = parseInitiateRitualUpload(value.request);
  return (
    !!request &&
    digest(request) === row.requestHash &&
    value.fileId === row.fileId &&
    value.attachmentId === row.attachmentId &&
    value.claimId === row.claimId &&
    value.intentExpiresAtMs === row.expiresAt.getTime() &&
    value.claimExpiresAtMs === row.claimExpiresAt?.getTime() &&
    sameLocation(value.staging, locations(row).staging) &&
    sameLocation(value.canonical, locations(row).canonical)
  );
}
function validImage(
  value: ValidatedRitualImage,
  request: InitiateRitualUpload,
) {
  return (
    plain(value) &&
    Object.keys(value).length === 5 &&
    value.contentType === request.contentType &&
    [value.width, value.frameHeight, value.frames, value.decodedPixels].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    ) &&
    value.width <= RITUAL_IMAGE_LIMITS.maxDimension &&
    value.frameHeight <= RITUAL_IMAGE_LIMITS.maxDimension &&
    value.frames <= RITUAL_IMAGE_LIMITS.maxFrames &&
    value.decodedPixels === value.width * value.frameHeight * value.frames &&
    value.decodedPixels <= RITUAL_IMAGE_LIMITS.maxPixels &&
    (!["image/png", "image/jpeg"].includes(value.contentType) ||
      value.frames === 1)
  );
}
function fileFacts(
  file: LoomFileCreateInput,
  row: Intent,
  image: ValidatedRitualImage,
) {
  const request = requestOf(row),
    format = request.contentType.slice(6);
  const keys = [
    "audioMeta",
    "bucket",
    "byteSize",
    "contentType",
    "detectedContentType",
    "imageMeta",
    "kind",
    "meta",
    "objectKey",
    "originalFilename",
    "ownerId",
    "ownerType",
    "sha256",
    "storageProvider",
    "visibility",
  ];
  if (
    !plain(file) ||
    Object.keys(file).some((key) => !keys.includes(key)) ||
    !validImage(image, request) ||
    file.audioMeta != null ||
    file.bucket !== row.canonicalBucket ||
    file.byteSize !== row.byteSize ||
    file.contentType !== row.contentType ||
    file.detectedContentType !== row.contentType ||
    file.kind !== "image" ||
    file.objectKey !== row.canonicalObjectKey ||
    file.originalFilename !== row.filename ||
    file.ownerId !== row.actorId ||
    file.ownerType !== "user" ||
    file.sha256 !== row.sha256 ||
    file.storageProvider !== row.canonicalProvider ||
    file.visibility !== "private" ||
    !plain(file.meta) ||
    Reflect.ownKeys(file.meta).length !== 0 ||
    !plain(file.imageMeta) ||
    Object.keys(file.imageMeta).length !== 3 ||
    file.imageMeta.format !== format ||
    file.imageMeta.width !== image.width ||
    file.imageMeta.height !== image.frameHeight
  )
    fail("UNAVAILABLE");
  return {
    audioMeta: null,
    bucket: row.canonicalBucket,
    byteSize: row.byteSize,
    contentType: request.contentType,
    detectedContentType: request.contentType,
    imageMeta: { format, width: image.width, height: image.frameHeight },
    kind: "image" as const,
    meta: {},
    objectKey: row.canonicalObjectKey,
    originalFilename: row.filename,
    ownerId: row.actorId,
    ownerType: "user",
    sha256: row.sha256,
    storageProvider: row.canonicalProvider,
    visibility: "private" as const,
  };
}
function safeError(error: unknown): never {
  if (error instanceof RitualUploadError) throw error;
  type DriverError = {
    code?: string;
    constraint?: string;
    constraint_name?: string;
  };
  const outer = error as (DriverError & { cause?: DriverError }) | undefined;
  // Drizzle wraps driver errors once. Read code and constraint from that same
  // object; postgres-js calls PostgreSQL's constraint field `constraint_name`.
  const driver = outer?.cause?.code ? outer.cause : outer;
  const code = driver?.code;
  const constraint = driver?.constraint_name ?? driver?.constraint;
  if (code === "55P03" || code === "40P01" || code === "40001") fail("BUSY");
  if (code === "57014") fail("TIMEOUT");
  if (code === "23505" && constraint === "loom_files_sha256_unique")
    fail("DUPLICATE");
  fail("UNAVAILABLE");
}

/**
 * App-owned SQL upload commands. Each public method verifies the current session
 * afresh. Lock order mirrors ritual writes: operation, persisted grants, intent,
 * parent, then publication rows. Positive grants remain share-locked through commit.
 * Unknown acknowledgements leave durable state for the same immutable operation.
 */
export function createSqlRitualUploads(
  db: SqlRitualUploadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: {
    /** Pure server-only factory with disjoint private staging/canonical namespaces. No signing or I/O. */
    locations: (input: {
      request: InitiateRitualUpload;
      fileId: string;
      attachmentId: string;
    }) => { staging: RitualUploadLocation; canonical: RitualUploadLocation };
    now?: () => number;
    intentDurationMs?: number;
    claimDurationMs?: number;
    capabilityDurationMs?: number;
  },
) {
  const duration = {
    intent: options.intentDurationMs ?? RITUAL_UPLOAD_SQL_LIMITS.intentMs,
    claim: options.claimDurationMs ?? RITUAL_UPLOAD_SQL_LIMITS.claimMs,
    capability:
      options.capabilityDurationMs ?? RITUAL_UPLOAD_SQL_LIMITS.capabilityMs,
  };
  if (
    ![duration.intent, duration.claim, duration.capability].every(
      (v) => instant(v) && v > 0,
    ) ||
    duration.intent > RITUAL_UPLOAD_SQL_LIMITS.intentMs ||
    duration.claim > RITUAL_UPLOAD_SQL_LIMITS.claimMs ||
    duration.capability > RITUAL_UPLOAD_SQL_LIMITS.capabilityMs
  )
    throw new RangeError("Invalid ritual upload timing");
  const now = () => {
    const value = (options.now ?? Date.now)();
    if (!instant(value)) fail("UNAVAILABLE");
    return value;
  };
  async function run<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      active(signal);
      const result = await work();
      active(signal);
      return result;
    } catch (error) {
      return safeError(error);
    }
  }
  async function operation<T>(
    actorId: string,
    operationId: string,
    signal: AbortSignal,
    work: (
      tx: Transaction,
      row: Intent | undefined,
      authorize: (ritualId: string) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return run(signal, async () => {
      if (!isCanonicalUploadId(actorId) || !isCanonicalUploadId(operationId))
        fail("INVALID_REQUEST");
      const verified = await getVerifiedActorId();
      active(signal);
      if (!isCanonicalUploadId(verified)) fail("AUTH_REQUIRED");
      if (verified !== actorId) fail("ACTOR_CHANGED");
      return db.transaction(
        async (tx) => {
          await tx.execute(sql`select set_config('lock_timeout','5000',true)`);
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${"magickli:ritual-upload:v1:" + operationId},0))`,
          );
          active(signal);
          const principal = await loadSqlRitualPrincipal(tx, verified, true);
          if (!principal) fail("AUTH_REQUIRED");
          const [row] = await tx
            .select(intentFields)
            .from(ritualUploadIntents)
            .where(eq(ritualUploadIntents.operationId, operationId))
            .for("update");
          if (row && row.actorId !== actorId) fail("ACTOR_CHANGED");
          const authorize = async (ritualId: string) => {
            const [parent] = await tx
              .select(sqlRitualParentFields)
              .from(rituals)
              .where(eq(rituals.id, ritualId))
              .for("share");
            active(signal);
            if (
              !parent ||
              !getRitualAccess(sqlRitualPolicy(parent), principal).edit
            )
              fail("FORBIDDEN");
          };
          const result = await work(tx, row, authorize);
          active(signal);
          return result;
        },
        { isolationLevel: "read committed" },
      );
    });
  }
  async function duplicate(tx: Pick<Transaction, "select">, sha256: string) {
    const [existing] = await tx
      .select({ id: loomFilesTable.id })
      .from(loomFilesTable)
      .where(eq(loomFilesTable.sha256, sha256));
    if (existing) fail("DUPLICATE");
  }
  async function completed(tx: Transaction, row: Intent) {
    const [file] = await tx
      .select(fileFields)
      .from(loomFilesTable)
      .where(eq(loomFilesTable.id, row.fileId))
      .for("share");
    const [link] = await tx
      .select()
      .from(ritualFileLinks)
      .where(eq(ritualFileLinks.id, row.attachmentId))
      .for("share");
    if (
      !file ||
      file.deletedAt ||
      !link ||
      link.deletedAt ||
      link.operationId !== row.operationId ||
      link.ritualId !== row.ritualId ||
      link.fileId !== row.fileId ||
      link.uploaderId !== row.actorId
    )
      fail("FORBIDDEN");
    if (
      file.sha256 !== row.sha256 ||
      file.byteSize !== row.byteSize ||
      file.contentType !== row.contentType ||
      file.detectedContentType !== row.contentType ||
      file.originalFilename !== row.filename ||
      file.ownerId !== row.actorId ||
      file.ownerType !== "user" ||
      file.visibility !== "private" ||
      file.storageProvider !== row.canonicalProvider ||
      file.bucket !== row.canonicalBucket ||
      file.objectKey !== row.canonicalObjectKey ||
      file.kind !== "image" ||
      file.audioMeta !== null ||
      !plain(file.meta) ||
      Object.keys(file.meta).length !== 0
    )
      fail("UNAVAILABLE");
    return { record: file as LoomFileRecord, receipt: receiptOf(row) };
  }
  async function initiate(
    input: unknown,
    signal = new AbortController().signal,
  ): Promise<InitiatedRitualUpload> {
    return run(signal, async () => {
      const request = parseInitiateRitualUpload(input);
      if (!request) fail("INVALID_REQUEST");
      return operation(
        request.expectedActorId,
        request.operationId,
        signal,
        async (tx, previous, authorize) => {
          if (previous && previous.requestHash !== digest(request))
            fail("OPERATION_CONFLICT");
          await authorize(request.ritualId);
          if (previous?.completedAt)
            return {
              kind: "completed",
              receipt: (await completed(tx, previous)).receipt,
            };
          const time = now();
          if (
            previous &&
            (previous.createdAt.getTime() > time ||
              previous.expiresAt.getTime() <= time)
          )
            fail("EXPIRED");
          if (previous?.claimId && previous.claimExpiresAt!.getTime() > time)
            fail("BUSY");
          await duplicate(tx, request.sha256);
          active(signal);
          let row = previous;
          if (!row) {
            const fileId = createUuidV7(),
              attachmentId = createUuidV7();
            const proposed = structuredClone(
              options.locations({
                request: { ...request },
                fileId,
                attachmentId,
              }),
            );
            if (
              !plain(proposed) ||
              Object.keys(proposed).length !== 2 ||
              !location(proposed.staging) ||
              !location(proposed.canonical) ||
              sameLocation(proposed.staging, proposed.canonical)
            )
              fail("UNAVAILABLE");
            // Serialize both location namespaces, including cross staging/canonical collisions.
            for (const key of [proposed.staging, proposed.canonical]
              .map((v) => JSON.stringify([v.provider, v.bucket, v.objectKey]))
              .sort())
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${"magickli:ritual-upload-location:" + key},0))`,
              );
            for (const loc of [proposed.staging, proposed.canonical]) {
              const [occupied] = await tx
                .select({ id: ritualUploadIntents.operationId })
                .from(ritualUploadIntents)
                .where(
                  or(
                    and(
                      eq(ritualUploadIntents.stagingProvider, loc.provider),
                      eq(ritualUploadIntents.stagingBucket, loc.bucket),
                      eq(ritualUploadIntents.stagingObjectKey, loc.objectKey),
                    ),
                    and(
                      eq(ritualUploadIntents.canonicalProvider, loc.provider),
                      eq(ritualUploadIntents.canonicalBucket, loc.bucket),
                      eq(ritualUploadIntents.canonicalObjectKey, loc.objectKey),
                    ),
                  ),
                );
              const [existingFile] = await tx
                .select({ id: loomFilesTable.id })
                .from(loomFilesTable)
                .where(
                  and(
                    eq(loomFilesTable.storageProvider, loc.provider),
                    eq(loomFilesTable.bucket, loc.bucket),
                    eq(loomFilesTable.objectKey, loc.objectKey),
                  ),
                );
              if (occupied || existingFile) fail("UNAVAILABLE");
            }
            const expires = time + duration.intent;
            if (!instant(expires)) fail("UNAVAILABLE");
            active(signal);
            [row] = await tx
              .insert(ritualUploadIntents)
              .values({
                operationId: request.operationId,
                actorId: request.expectedActorId,
                ritualId: request.ritualId,
                requestHash: digest(request),
                filename: request.filename,
                byteSize: request.byteSize,
                contentType: request.contentType,
                sha256: request.sha256,
                fileId,
                attachmentId,
                stagingProvider: proposed.staging.provider,
                stagingBucket: proposed.staging.bucket,
                stagingObjectKey: proposed.staging.objectKey,
                canonicalProvider: proposed.canonical.provider,
                canonicalBucket: proposed.canonical.bucket,
                canonicalObjectKey: proposed.canonical.objectKey,
                createdAt: new Date(time),
                expiresAt: new Date(expires),
              })
              .returning(intentFields);
          }
          const responded = now();
          if (responded < time || responded >= row.expiresAt.getTime())
            fail("EXPIRED");
          const capabilityExpiresAtMs = Math.min(
            time + duration.capability,
            row.expiresAt.getTime(),
          );
          if (responded >= capabilityExpiresAtMs) fail("TIMEOUT");
          return {
            kind: "initiated",
            replayed: !!previous,
            intent: {
              request: requestOf(row),
              fileId: row.fileId,
              attachmentId: row.attachmentId,
              ...locations(row),
              intentExpiresAtMs: row.expiresAt.getTime(),
              capabilityExpiresAtMs,
            },
          };
        },
      );
    });
  }
  const publication: RitualUploadPublication = {
    async claimAuthorized(input, signal) {
      if (!instant(input.nowMs)) fail("INVALID_REQUEST");
      return operation(
        input.actorId,
        input.operationId,
        signal,
        async (tx, row, authorize) => {
          if (!row) fail("INVALID_REQUEST");
          requestOf(row);
          await authorize(row.ritualId);
          if (row.completedAt)
            return {
              kind: "completed",
              receipt: (await completed(tx, row)).receipt,
            };
          const time = now();
          if (time < row.createdAt.getTime() || time >= row.expiresAt.getTime())
            fail("EXPIRED");
          if (row.claimId && row.claimExpiresAt!.getTime() > time) fail("BUSY");
          await duplicate(tx, row.sha256);
          active(signal);
          const claimId = createUuidV7(),
            claimExpiresAt = new Date(
              Math.min(time + duration.claim, row.expiresAt.getTime()),
            );
          const [claimed] = await tx
            .update(ritualUploadIntents)
            .set({ claimId, claimStartedAt: new Date(time), claimExpiresAt })
            .where(
              and(
                eq(ritualUploadIntents.operationId, row.operationId),
                isNull(ritualUploadIntents.completedAt),
              ),
            )
            .returning(intentFields);
          active(signal);
          if (now() >= claimExpiresAt.getTime()) fail("EXPIRED");
          return { kind: "claimed", claim: claimOf(claimed) };
        },
      );
    },
    async findBySha256(sha256, signal) {
      return run(signal, async () => {
        if (!hash(sha256)) fail("INVALID_REQUEST");
        await db.transaction((tx) => duplicate(tx, sha256), {
          accessMode: "read only",
        });
        return null;
      });
    },
    async commitAuthorized(input, signal) {
      return run(signal, async () => {
        const snapshot = structuredClone(input),
          request = parseInitiateRitualUpload(snapshot.claim?.request);
        if (!request) fail("INVALID_REQUEST");
        return operation(
          snapshot.actorId,
          request.operationId,
          signal,
          async (tx, row, authorize) => {
            if (!row || !exactClaim(snapshot.claim, row))
              fail("OPERATION_CONFLICT");
            requestOf(row);
            await authorize(row.ritualId);
            const facts = fileFacts(snapshot.file, row, snapshot.image);
            if (row.completedAt) return completed(tx, row);
            const time = now();
            if (
              time < row.createdAt.getTime() ||
              time >= row.expiresAt.getTime() ||
              time < row.claimStartedAt!.getTime() ||
              time >= row.claimExpiresAt!.getTime()
            )
              fail("EXPIRED");
            await duplicate(tx, row.sha256);
            active(signal);
            const [record] = await tx
              .insert(loomFilesTable)
              .values({
                ...facts,
                id: row.fileId,
                createdAt: new Date(time),
                updatedAt: new Date(time),
                deletedAt: null,
              })
              .returning(fileFields);
            active(signal);
            await tx.insert(ritualFileLinks).values({
              id: row.attachmentId,
              operationId: row.operationId,
              ritualId: row.ritualId,
              fileId: row.fileId,
              uploaderId: row.actorId,
              createdAt: new Date(time),
            });
            active(signal);
            const commitTime = now();
            if (
              commitTime < time ||
              commitTime >= row.expiresAt.getTime() ||
              commitTime >= row.claimExpiresAt!.getTime()
            )
              fail("EXPIRED");
            const [done] = await tx
              .update(ritualUploadIntents)
              .set({ completedAt: new Date(commitTime) })
              .where(
                and(
                  eq(ritualUploadIntents.operationId, row.operationId),
                  eq(ritualUploadIntents.claimId, row.claimId!),
                  isNull(ritualUploadIntents.completedAt),
                ),
              )
              .returning(intentFields);
            if (!done) fail("BUSY");
            active(signal);
            return {
              record: record as LoomFileRecord,
              receipt: receiptOf(done),
            };
          },
        );
      });
    },
    async releaseClaim(claim, _code, signal) {
      return run(signal, async () => {
        const snapshot = structuredClone(claim),
          request = parseInitiateRitualUpload(snapshot.request);
        if (!request) fail("INVALID_REQUEST");
        return operation(
          request.expectedActorId,
          request.operationId,
          signal,
          async (tx, row, authorize) => {
            if (!row || row.completedAt || !exactClaim(snapshot, row)) return;
            await authorize(row.ritualId);
            active(signal);
            await tx
              .update(ritualUploadIntents)
              .set({
                claimId: null,
                claimStartedAt: null,
                claimExpiresAt: null,
              })
              .where(
                and(
                  eq(ritualUploadIntents.operationId, row.operationId),
                  eq(ritualUploadIntents.claimId, snapshot.claimId),
                  isNull(ritualUploadIntents.completedAt),
                ),
              );
          },
        );
      });
    },
  };
  return { initiate, publication };
}
