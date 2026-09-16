import "server-only";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import {
  ritualBundleAssets,
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../db/schema/ritualBundles";
import { rituals } from "../db/schema/rituals";
import { getRitualAccess } from "../doc/access";
import {
  loadSqlRitualPrincipal,
  type SqlRitualParentRow,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "../doc/sqlPolicy";
import { selectSqlRenderedRitual } from "../doc/sqlRendered";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import type { PreparedRitualBundle } from "./prepareRitualBundle";
import {
  parseRitualBundleManifest,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";
import {
  bundleTextSha256,
  isRitualBundlePublicationPolicyId,
  parseRitualBundleStorageReceipt,
  RITUAL_BUNDLE_LOCATION_LIMITS,
  RITUAL_BUNDLE_PUBLICATION_LIMITS,
  type RitualBundleAssetReservation,
  type RitualBundleLocation,
  type RitualBundlePublicationClaim,
  RitualBundlePublicationError,
  type RitualBundlePublicationReceipt,
  ritualBundleRequestHash,
} from "./ritualBundlePublication";
import { decodeRitualBundleRecords } from "./ritualBundleRecords";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "execute"
>;
/** Use a transaction-capable PostgreSQL connection; provider I/O stays outside SQL. */
export interface SqlRitualBundlePublicationDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}
type Intent = typeof ritualBundlePublicationIntents.$inferSelect;
type Marker = typeof ritualBundles.$inferSelect;
type Asset = typeof ritualBundleAssets.$inferSelect;
type CurrentSelection = {
  parent: SqlRitualParentRow;
  contentJson: string;
  descriptor: RitualBundleManifestV1["descriptor"];
};
type AuthorizeSelection = (ritualId: string) => Promise<CurrentSelection>;
/** Expected actor is a request binding, never session proof. All operations reload persisted grants. */
export interface RitualBundleOperation {
  operationId: string;
  expectedActorId: string;
}
/** Private recovery payload for the worker. Never a browser manifest/download response. */
export interface ReservedRitualBundle {
  operationId: string;
  actorId: string;
  bundleId: string;
  ritualId: string;
  manifestJson: string;
  manifestSha256: string;
  planJson: string;
  planSha256: string;
  publicationPolicyId: string;
  intentExpiresAtMs: number;
  assets: readonly RitualBundleAssetReservation[];
}
type Completed = { kind: "completed"; receipt: RitualBundlePublicationReceipt };
export type RitualBundleReservationResult =
  | Completed
  | { kind: "reserved"; replayed: boolean; reservation: ReservedRitualBundle };
export type RitualBundleClaimResult =
  | Completed
  | {
      kind: "claimed";
      claim: RitualBundlePublicationClaim;
      reservation: ReservedRitualBundle;
    };

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0) &&
  value <= 8_640_000_000_000_000;
const active = (signal: AbortSignal) => {
  if (signal.aborted) fail("ABORTED");
};
function fail(code: RitualBundlePublicationError["code"]): never {
  throw new RitualBundlePublicationError(code);
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
// JSON decoding preserves opaque leading BOMs in PGlite's text path too.
const assetFields = {
  ...getTableColumns(ritualBundleAssets),
  reference: sql<string>`to_json(${ritualBundleAssets.reference})`,
  storageProvider: sql<string>`to_json(${ritualBundleAssets.storageProvider})`,
  bucket: sql<string>`to_json(${ritualBundleAssets.bucket})`,
  objectKey: sql<string>`to_json(${ritualBundleAssets.objectKey})`,
};
const parentFields = {
  ...sqlRitualParentFields,
  title: sql<string>`to_json(${rituals.title})`,
};

function location(value: unknown): value is RitualBundleLocation {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== 3
  )
    return false;
  return (
    Object.keys(RITUAL_BUNDLE_LOCATION_LIMITS) as (keyof RitualBundleLocation)[]
  ).every((key) => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    const field = property && "value" in property ? property.value : undefined;
    return (
      typeof field === "string" &&
      field.length > 0 &&
      field.isWellFormed() &&
      !field.includes("\0") &&
      Buffer.byteLength(field) <= RITUAL_BUNDLE_LOCATION_LIMITS[key] &&
      (key === "objectKey" || !!field.trim())
    );
  });
}
function reservation(
  row: Intent,
  assets: RitualBundleAssetReservation[],
): ReservedRitualBundle {
  return {
    operationId: row.operationId,
    actorId: row.actorId,
    bundleId: row.bundleId,
    ritualId: row.ritualId,
    manifestJson: row.manifestJson,
    manifestSha256: row.manifestSha256,
    planJson: row.planJson,
    planSha256: row.planSha256,
    publicationPolicyId: row.publicationPolicyId,
    intentExpiresAtMs: row.expiresAt.getTime(),
    assets,
  };
}
function claimOf(
  row: Intent,
  assets: RitualBundleAssetReservation[],
): RitualBundlePublicationClaim {
  if (!row.claimId || !row.claimStartedAt || !row.claimExpiresAt)
    fail("UNAVAILABLE");
  return {
    operationId: row.operationId,
    actorId: row.actorId,
    bundleId: row.bundleId,
    ritualId: row.ritualId,
    manifestSha256: row.manifestSha256,
    claimId: row.claimId,
    claimStartedAtMs: row.claimStartedAt.getTime(),
    claimExpiresAtMs: row.claimExpiresAt.getTime(),
    intentExpiresAtMs: row.expiresAt.getTime(),
    assets,
  };
}
function receiptOf(
  row: Intent,
  marker: Marker,
): RitualBundlePublicationReceipt {
  return {
    operationId: row.operationId,
    bundleId: row.bundleId,
    ritualId: row.ritualId,
    manifestSha256: row.manifestSha256,
    descriptorSha256: row.descriptorSha256,
    publishedAtMs: marker.publishedAt.getTime(),
  };
}
function safe(error: unknown): never {
  if (error instanceof RitualBundlePublicationError) throw error;
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = value?.code ?? value?.cause?.code;
  if (code === "55P03" || code === "40P01") fail("BUSY");
  if (code === "23505") fail("OPERATION_CONFLICT");
  fail("UNAVAILABLE");
}

/**
 * Reserve exact private locations, fence workers and atomically publish complete
 * receipts. This service accepts trusted prepared server evidence, never client
 * manifests or client storage claims. No provider operation runs in a transaction.
 * Successful publication does not grant an offline lease or change ritual scope.
 */
export function createSqlRitualBundlePublisher(
  db: SqlRitualBundlePublicationDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: {
    publicationPolicyId: string;
    locations: (input: {
      operationId: string;
      bundleId: string;
      ritualId: string;
      asset: RitualBundleManifestV1["assets"][number];
    }) => RitualBundleLocation;
    now?: () => number;
    intentDurationMs?: number;
    claimDurationMs?: number;
  },
) {
  const policyId = options.publicationPolicyId;
  const locations = options.locations;
  const clock = options.now ?? Date.now;
  const intentMs =
    options.intentDurationMs ?? RITUAL_BUNDLE_PUBLICATION_LIMITS.intentMs;
  const claimMs =
    options.claimDurationMs ?? RITUAL_BUNDLE_PUBLICATION_LIMITS.claimMs;
  if (
    !isRitualBundlePublicationPolicyId(policyId) ||
    typeof locations !== "function" ||
    !instant(intentMs) ||
    intentMs < 1 ||
    intentMs > RITUAL_BUNDLE_PUBLICATION_LIMITS.intentMs ||
    !instant(claimMs) ||
    claimMs < 1 ||
    claimMs > RITUAL_BUNDLE_PUBLICATION_LIMITS.claimMs
  )
    throw new RangeError("Invalid bundle publication configuration");
  const now = () => {
    const time = clock();
    if (!instant(time)) fail("UNAVAILABLE");
    return time;
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
      return safe(error);
    }
  }
  async function operation<T>(
    request: RitualBundleOperation,
    signal: AbortSignal,
    work: (
      tx: Transaction,
      row: Intent | undefined,
      authorize: AuthorizeSelection,
    ) => Promise<T>,
  ) {
    const bound = {
      operationId: request.operationId,
      expectedActorId: request.expectedActorId,
    };
    if (!id(bound.operationId) || !id(bound.expectedActorId))
      fail("INVALID_REQUEST");
    active(signal);
    const verified = await getVerifiedActorId();
    active(signal);
    if (!id(verified)) fail("AUTH_REQUIRED");
    if (verified !== bound.expectedActorId) fail("ACTOR_CHANGED");
    return db.transaction(
      async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout','5000',true)`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${"magickli:ritual-bundle:v1:" + bound.operationId},0))`,
        );
        active(signal);
        const principal = await loadSqlRitualPrincipal(tx, verified, true);
        if (!principal) fail("AUTH_REQUIRED");
        const [row] = await tx
          .select()
          .from(ritualBundlePublicationIntents)
          .where(
            eq(ritualBundlePublicationIntents.operationId, bound.operationId),
          )
          .for("update");
        if (row && row.actorId !== verified) fail("ACTOR_CHANGED");
        const authorize = async (ritualId: string) => {
          const [parent] = await tx
            .select(parentFields)
            .from(rituals)
            .where(eq(rituals.id, ritualId))
            .for("share");
          active(signal);
          if (
            !parent ||
            !getRitualAccess(sqlRitualPolicy(parent), principal).read
          )
            fail("FORBIDDEN");
          const selected = await selectSqlRenderedRitual(tx, parent);
          active(signal);
          if (!selected || !parent.currentRevisionId) fail("UNAVAILABLE");
          return {
            parent,
            contentJson: selected.contentJson,
            descriptor: createRitualRenderDescriptor(parent, selected),
          };
        };
        const result = await work(tx, row, authorize);
        active(signal);
        return result;
      },
      { isolationLevel: "read committed" },
    );
  }
  async function records(tx: Transaction, row: Intent) {
    const [marker] = await tx
      .select()
      .from(ritualBundles)
      .where(eq(ritualBundles.operationId, row.operationId))
      .for("share");
    const assets = await tx
      .select(assetFields)
      .from(ritualBundleAssets)
      .where(eq(ritualBundleAssets.operationId, row.operationId))
      .orderBy(asc(ritualBundleAssets.assetIndex))
      .limit(513)
      .for("share");
    if (!!row.completedAt !== !!marker) fail("UNAVAILABLE");
    const decoded = await decodeRitualBundleRecords(row, assets, marker);
    if (!decoded) fail("UNAVAILABLE");
    return { ...decoded, marker, rows: assets };
  }
  function selection(
    row: Intent,
    manifest: RitualBundleManifestV1,
    current: CurrentSelection,
  ) {
    if (
      row.publicationPolicyId !== policyId ||
      row.currentRevisionId !== current.parent.currentRevisionId ||
      row.currentCompiledArtifactId !==
        current.parent.currentCompiledArtifactId ||
      row.parentVersion !== current.parent.version ||
      !same(manifest.descriptor, current.descriptor) ||
      manifest.title !== current.parent.title ||
      manifest.renderedJson !== current.contentJson
    )
      fail("STALE");
  }
  function unexpired(row: Intent, time: number) {
    if (time < row.createdAt.getTime() || time >= row.expiresAt.getTime())
      fail("EXPIRED");
  }
  async function inspect(
    tx: Transaction,
    row: Intent | undefined,
    authorize: AuthorizeSelection,
  ) {
    if (!row) fail("INVALID_REQUEST");
    const current = await authorize(row.ritualId);
    const found = await records(tx, row);
    selection(row, found.manifest, current);
    return { row, ...found };
  }
  return {
    /** Persist payload and location reservations atomically before any object write. */
    async initiate(
      request: RitualBundleOperation,
      prepared: PreparedRitualBundle,
      signal = new AbortController().signal,
    ): Promise<RitualBundleReservationResult> {
      return run(signal, async () => {
        const bound = structuredClone(request);
        if (prepared.kind !== "prepared") fail("INVALID_REQUEST");
        const manifestJson = prepared.manifestJson,
          manifestSha256 = prepared.manifestSha256;
        const { sha256: planSha256, ...plan } = structuredClone(prepared.plan);
        const planJson = JSON.stringify(plan);
        if (
          Buffer.byteLength(planJson) >
            RITUAL_BUNDLE_PUBLICATION_LIMITS.planBytes ||
          bundleTextSha256(planJson) !== planSha256
        )
          fail("INVALID_REQUEST");
        const manifest = await parseRitualBundleManifest(manifestJson, {
          manifestSha256,
          bundleId: prepared.manifest.bundleId,
          ritualId: prepared.manifest.ritualId,
          descriptor: structuredClone(prepared.manifest.descriptor),
        });
        if (!manifest) fail("INVALID_REQUEST");
        const requestHash = ritualBundleRequestHash({
          operationId: bound.operationId,
          actorId: bound.expectedActorId,
          manifestSha256,
          planSha256,
          publicationPolicyId: policyId,
        });
        return operation(bound, signal, async (tx, previous, authorize) => {
          // The operation is the manifest published under this policy for the
          // bound actor. A rebuilt plan may differ in server-side provenance
          // (validator identity, catalog hashes, limits) without changing what
          // is published, so such a retry replays its completed receipt or
          // pending reservation instead of being stranded.
          if (
            previous &&
            (previous.manifestSha256 !== manifestSha256 ||
              previous.publicationPolicyId !== policyId)
          )
            fail("OPERATION_CONFLICT");
          if (previous) {
            const found = await inspect(tx, previous, authorize);
            if (found.marker)
              return {
                kind: "completed",
                receipt: receiptOf(previous, found.marker),
              };
            unexpired(previous, now());
            return {
              kind: "reserved",
              replayed: true,
              reservation: reservation(previous, found.reservations),
            };
          }
          const current = await authorize(manifest.ritualId);
          const time = now(),
            expires = time + intentMs;
          if (!instant(expires)) fail("UNAVAILABLE");
          const row: Intent = {
            operationId: bound.operationId,
            actorId: bound.expectedActorId,
            bundleId: manifest.bundleId,
            ritualId: manifest.ritualId,
            currentRevisionId: current.parent.currentRevisionId!,
            currentCompiledArtifactId: current.parent.currentCompiledArtifactId,
            parentVersion: current.parent.version,
            descriptorSha256: manifest.descriptor.descriptorSha256,
            contentSha256: manifest.descriptor.contentSha256,
            publicationPolicyId: policyId,
            manifestJson,
            manifestSha256,
            planJson,
            planSha256,
            requestHash,
            createdAt: new Date(time),
            expiresAt: new Date(expires),
            claimId: null,
            claimStartedAt: null,
            claimExpiresAt: null,
            completedAt: null,
          };
          selection(row, manifest, current);
          const assets: Asset[] = manifest.assets.map((asset, assetIndex) => {
            const proposed = structuredClone(
              locations({
                operationId: row.operationId,
                bundleId: row.bundleId,
                ritualId: row.ritualId,
                asset: { ...asset },
              }),
            );
            if (!location(proposed)) fail("UNAVAILABLE");
            return {
              operationId: row.operationId,
              bundleId: row.bundleId,
              ritualId: row.ritualId,
              key: asset.key,
              assetIndex,
              reference: asset.reference,
              sha256: asset.sha256,
              mime: asset.mime,
              byteSize: asset.bytes,
              ...proposed,
              receiptJson: null,
              receiptSha256: null,
              verifiedAt: null,
            };
          });
          const decoded = await decodeRitualBundleRecords(row, assets);
          if (!decoded) fail("INVALID_REQUEST");
          active(signal);
          await tx.insert(ritualBundlePublicationIntents).values(row);
          if (assets.length) await tx.insert(ritualBundleAssets).values(assets);
          active(signal);
          unexpired(row, now());
          return {
            kind: "reserved",
            replayed: false,
            reservation: reservation(row, decoded.reservations),
          };
        });
      });
    },
    /** Resume an existing immutable operation; only an expired worker claim can be replaced. */
    async claim(
      request: RitualBundleOperation,
      signal = new AbortController().signal,
    ): Promise<RitualBundleClaimResult> {
      return run(signal, () =>
        operation(request, signal, async (tx, previous, authorize) => {
          const found = await inspect(tx, previous, authorize);
          if (found.marker)
            return {
              kind: "completed",
              receipt: receiptOf(found.row, found.marker),
            };
          const time = now();
          unexpired(found.row, time);
          if (found.row.claimId && found.row.claimExpiresAt!.getTime() > time)
            fail("BUSY");
          const expires = Math.min(
            found.row.expiresAt.getTime(),
            time + claimMs,
          );
          if (!instant(expires)) fail("UNAVAILABLE");
          const [row] = await tx
            .update(ritualBundlePublicationIntents)
            .set({
              claimId: createUuidV7(),
              claimStartedAt: new Date(time),
              claimExpiresAt: new Date(expires),
            })
            .where(
              eq(
                ritualBundlePublicationIntents.operationId,
                found.row.operationId,
              ),
            )
            .returning();
          active(signal);
          const responded = now();
          if (responded < time || responded >= expires) fail("EXPIRED");
          return {
            kind: "claimed",
            claim: claimOf(row, found.reservations),
            reservation: reservation(row, found.reservations),
          };
        }),
      );
    },
    /** Receipts must come from the trusted exact-byte storage verifier, never an HTTP body. */
    async publish(
      input: RitualBundlePublicationClaim,
      inputReceipts: readonly unknown[],
      signal = new AbortController().signal,
    ): Promise<RitualBundlePublicationReceipt> {
      return run(signal, async () => {
        const claim = structuredClone(input),
          receipts = structuredClone(inputReceipts);
        return operation(
          { operationId: claim.operationId, expectedActorId: claim.actorId },
          signal,
          async (tx, previous, authorize) => {
            const found = await inspect(tx, previous, authorize);
            if (!same(claim, claimOf(found.row, found.reservations)))
              fail("OPERATION_CONFLICT");
            if (found.marker) return receiptOf(found.row, found.marker);
            const time = now();
            unexpired(found.row, time);
            if (time < claim.claimStartedAtMs || time >= claim.claimExpiresAtMs)
              fail("EXPIRED");
            if (
              !Array.isArray(receipts) ||
              receipts.length !== found.reservations.length
            )
              fail("INCOMPLETE");
            const validated = new Map<
              string,
              { receiptJson: string; receiptSha256: string; verifiedAt: Date }
            >();
            for (const value of receipts) {
              const receiptJson = JSON.stringify(value),
                receiptSha256 = bundleTextSha256(receiptJson);
              const key =
                value && typeof value === "object"
                  ? Object.getOwnPropertyDescriptor(value, "assetKey")?.value
                  : undefined;
              const asset = found.reservations.find((row) => row.key === key);
              if (!asset || validated.has(asset.key)) fail("INCOMPLETE");
              const parsed = parseRitualBundleStorageReceipt(
                receiptJson,
                receiptSha256,
                {
                  ...asset,
                  claimId: claim.claimId,
                  claimStartedAtMs: claim.claimStartedAtMs,
                  claimExpiresAtMs: claim.claimExpiresAtMs,
                },
              );
              if (!parsed || parsed.verifiedAtMs > time) fail("INCOMPLETE");
              validated.set(asset.key, {
                receiptJson,
                receiptSha256,
                verifiedAt: new Date(parsed.verifiedAtMs),
              });
            }
            for (const [key, fields] of validated) {
              active(signal);
              await tx
                .update(ritualBundleAssets)
                .set(fields)
                .where(
                  and(
                    eq(ritualBundleAssets.bundleId, claim.bundleId),
                    eq(ritualBundleAssets.key, key),
                  ),
                );
            }
            const commitTime = now();
            if (
              commitTime < time ||
              commitTime >= claim.claimExpiresAtMs ||
              commitTime >= claim.intentExpiresAtMs
            )
              fail("EXPIRED");
            const [row] = await tx
              .update(ritualBundlePublicationIntents)
              .set({ completedAt: new Date(commitTime) })
              .where(
                eq(
                  ritualBundlePublicationIntents.operationId,
                  claim.operationId,
                ),
              )
              .returning();
            const [marker] = await tx
              .insert(ritualBundles)
              .values({
                bundleId: row.bundleId,
                operationId: row.operationId,
                ritualId: row.ritualId,
                currentRevisionId: row.currentRevisionId,
                publishedAt: new Date(commitTime),
              })
              .returning();
            active(signal);
            // Awaited writes can consume the remaining claim lifetime. Keep
            // this check inside the transaction so expiry rolls back all rows.
            const finished = now();
            if (finished < commitTime || finished >= claim.claimExpiresAtMs)
              fail("EXPIRED");
            return receiptOf(row, marker);
          },
        );
      });
    },
    /** Failed stale workers cannot release a newer claim or erase completion evidence. */
    async releaseClaim(
      input: RitualBundlePublicationClaim,
      signal = new AbortController().signal,
    ): Promise<void> {
      return run(signal, async () => {
        const claim = structuredClone(input);
        return operation(
          { operationId: claim.operationId, expectedActorId: claim.actorId },
          signal,
          async (tx, previous, authorize) => {
            if (
              !previous ||
              previous.completedAt ||
              previous.claimId !== claim.claimId
            )
              return;
            const found = await inspect(tx, previous, authorize);
            if (!same(claim, claimOf(previous, found.reservations))) return;
            active(signal);
            await tx
              .update(ritualBundlePublicationIntents)
              .set({
                claimId: null,
                claimStartedAt: null,
                claimExpiresAt: null,
              })
              .where(
                eq(
                  ritualBundlePublicationIntents.operationId,
                  claim.operationId,
                ),
              );
          },
        );
      });
    },
  };
}
