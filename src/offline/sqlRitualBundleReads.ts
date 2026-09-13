import "server-only";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import {
  ritualBundleAssets,
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../db/schema/ritualBundles";
import { rituals } from "../db/schema/rituals";
import { getRitualAccess } from "../doc/access";
import {
  loadSqlRitualPrincipal,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "../doc/sqlPolicy";
import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { selectSqlRenderedRitual } from "../doc/sqlRendered";
import { isUuidV7 } from "../lib/ids";
import type { RitualRenderDescriptorV1 } from "./permissionContract";
import {
  type RitualBundleAssetMime,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";
import { isRitualBundlePublicationPolicyId } from "./ritualBundlePublication";
import { decodeRitualBundleRecords } from "./ritualBundleRecords";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

/** Canonical expected identity is a binding, never session verification. */
export interface RitualBundleReadRequest {
  expectedActorId: string;
  ritualId: string;
  bundleId?: string;
}
export interface RitualBundleAssetReadRequest extends RitualBundleReadRequest {
  bundleId: string;
  assetKey: string;
}

/** Authorized completed manifest only; private plan/storage evidence is excluded. */
export interface SqlRitualBundleManifest {
  manifestJson: string;
  manifestSha256: string;
  manifest: RitualBundleManifestV1;
}

/**
 * Server-only snapshot for a later bounded object read. This is not a browser
 * capability or lease. Reauthorize after provider I/O and compare this complete
 * binding before exposing bytes; a former successful lookup grants no future read.
 */
export interface SqlRitualBundleAsset {
  expectedActorId: string;
  ritualId: string;
  bundleId: string;
  assetKey: string;
  manifestSha256: string;
  descriptor: RitualRenderDescriptorV1;
  publicationPolicyId: string;
  sha256: string;
  mime: RitualBundleAssetMime;
  byteSize: number;
  location: { provider: string; bucket: string; objectKey: string };
  receiptSha256: string;
}

const canonicalId = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

function request(
  value: unknown,
  asset: boolean,
): RitualBundleAssetReadRequest | RitualBundleReadRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const allowed = asset
    ? ["expectedActorId", "ritualId", "bundleId", "assetKey"]
    : ["expectedActorId", "ritualId", "bundleId"];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  const row = value as Record<string, unknown>;
  if (
    !canonicalId(row.expectedActorId) ||
    !canonicalId(row.ritualId) ||
    (row.bundleId !== undefined && !canonicalId(row.bundleId)) ||
    (asset && (!canonicalId(row.bundleId) || !canonicalId(row.assetKey)))
  )
    return null;
  return {
    expectedActorId: row.expectedActorId,
    ritualId: row.ritualId,
    ...(row.bundleId === undefined ? {} : { bundleId: row.bundleId }),
    ...(asset ? { assetKey: row.assetKey as string } : {}),
  };
}

// JSON text projection avoids PGlite's bare-text leading-BOM decoding quirk.
const assetFields = {
  ...getTableColumns(ritualBundleAssets),
  reference: sql<string>`to_json(${ritualBundleAssets.reference})`,
  storageProvider: sql<string>`to_json(${ritualBundleAssets.storageProvider})`,
  bucket: sql<string>`to_json(${ritualBundleAssets.bucket})`,
  objectKey: sql<string>`to_json(${ritualBundleAssets.objectKey})`,
};

/**
 * Inactive current-access reader. Every call verifies the signed-in canonical
 * actor, then reloads identity, policy, selected output and completed publication
 * in one read-only repeatable-read snapshot. Later revocation affects the next
 * call. All denied/missing/stale/corrupt/operational failures return null; this
 * result is never an authoritative offline revocation response.
 *
 * An omitted bundle selects the newest accepted-policy publication for the exact
 * current selection. A corrupt chosen publication fails closed without silently
 * falling back to an older snapshot. Pending reservations are never readable.
 */
export function createSqlRitualBundleReader(
  db: SqlRitualReadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { acceptedPublicationPolicyIds: readonly string[] },
) {
  if (
    !Array.isArray(options.acceptedPublicationPolicyIds) ||
    options.acceptedPublicationPolicyIds.length > 32 ||
    Array.from(options.acceptedPublicationPolicyIds).some(
      (value) => !isRitualBundlePublicationPolicyId(value),
    )
  )
    throw new RangeError("Invalid ritual bundle publication policy");
  const policies = [...new Set(options.acceptedPublicationPolicyIds)];

  async function read(input: unknown, asset: boolean) {
    try {
      const bound = request(input, asset);
      if (!bound || policies.length === 0) return null;
      const actorId = await getVerifiedActorId();
      if (!canonicalId(actorId) || actorId !== bound.expectedActorId)
        return null;
      return await db.transaction(
        async (tx) => {
          const principal = await loadSqlRitualPrincipal(tx, actorId);
          if (!principal) return null;
          const [parent] = await tx
            .select({
              ...sqlRitualParentFields,
              title: sql<string>`to_json(${rituals.title})`,
            })
            .from(rituals)
            .where(eq(rituals.id, bound.ritualId));
          if (
            !parent ||
            !getRitualAccess(sqlRitualPolicy(parent), principal).read
          )
            return null;
          const selected = await selectSqlRenderedRitual(tx, parent);
          if (!selected) return null;
          const descriptor = createRitualRenderDescriptor(parent, selected);
          const [candidate] = await tx
            .select({
              marker: ritualBundles,
              intent: ritualBundlePublicationIntents,
            })
            .from(ritualBundles)
            .innerJoin(
              ritualBundlePublicationIntents,
              and(
                eq(
                  ritualBundlePublicationIntents.operationId,
                  ritualBundles.operationId,
                ),
                eq(
                  ritualBundlePublicationIntents.bundleId,
                  ritualBundles.bundleId,
                ),
                eq(
                  ritualBundlePublicationIntents.ritualId,
                  ritualBundles.ritualId,
                ),
                eq(
                  ritualBundlePublicationIntents.currentRevisionId,
                  ritualBundles.currentRevisionId,
                ),
              ),
            )
            .where(
              and(
                eq(ritualBundles.ritualId, bound.ritualId),
                eq(
                  ritualBundlePublicationIntents.descriptorSha256,
                  descriptor.descriptorSha256,
                ),
                inArray(
                  ritualBundlePublicationIntents.publicationPolicyId,
                  policies,
                ),
                bound.bundleId === undefined
                  ? undefined
                  : eq(ritualBundles.bundleId, bound.bundleId),
              ),
            )
            .orderBy(
              desc(ritualBundles.publishedAt),
              desc(ritualBundles.bundleId),
            )
            .limit(1);
          if (!candidate) return null;
          const { marker, intent } = candidate;
          if (
            intent.currentRevisionId !== parent.currentRevisionId ||
            intent.currentCompiledArtifactId !==
              parent.currentCompiledArtifactId ||
            intent.parentVersion !== parent.version ||
            intent.contentSha256 !== selected.contentSha256
          )
            return null;
          const rows = await tx
            .select(assetFields)
            .from(ritualBundleAssets)
            .where(
              and(
                eq(ritualBundleAssets.operationId, intent.operationId),
                eq(ritualBundleAssets.bundleId, marker.bundleId),
                eq(ritualBundleAssets.ritualId, parent.id),
              ),
            )
            .orderBy(asc(ritualBundleAssets.assetIndex));
          const decoded = await decodeRitualBundleRecords(intent, rows, marker);
          if (
            !decoded ||
            decoded.manifest.title !== parent.title ||
            decoded.manifest.renderedJson !== selected.contentJson
          )
            return null;
          return {
            bound,
            intent,
            descriptor,
            manifest: decoded.manifest,
            rows,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch {
      return null;
    }
  }

  return {
    async getManifest(
      input: RitualBundleReadRequest,
    ): Promise<SqlRitualBundleManifest | null> {
      const found = await read(input, false);
      return found
        ? {
            manifestJson: found.intent.manifestJson,
            manifestSha256: found.intent.manifestSha256,
            manifest: found.manifest,
          }
        : null;
    },
    async getAsset(
      input: RitualBundleAssetReadRequest,
    ): Promise<SqlRitualBundleAsset | null> {
      const found = await read(input, true);
      if (!found || !("assetKey" in found.bound)) return null;
      const assetKey = found.bound.assetKey;
      const row = found.rows.find((value) => value.key === assetKey);
      const entry = found.manifest.assets.find(
        (value) => value.key === assetKey,
      );
      if (!row || !entry || row.receiptSha256 === null) return null;
      return {
        expectedActorId: found.bound.expectedActorId,
        ritualId: found.bound.ritualId,
        bundleId: found.manifest.bundleId,
        assetKey: row.key,
        manifestSha256: found.intent.manifestSha256,
        descriptor: { ...found.descriptor },
        publicationPolicyId: found.intent.publicationPolicyId,
        sha256: row.sha256,
        mime: entry.mime,
        byteSize: row.byteSize,
        location: {
          provider: row.storageProvider,
          bucket: row.bucket,
          objectKey: row.objectKey,
        },
        receiptSha256: row.receiptSha256,
      };
    },
  };
}
