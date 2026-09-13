import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { ritualRevisions } from "./rituals";

const instant = (name: string) => timestamp(name, { withTimezone: true });
const v7 = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`substring(${column}::text from 15 for 1) = '7' and substring(${column}::text from 20 for 1) in ('8','9','a','b')`,
  );
const exactHash = (name: string, value: AnyPgColumn, hash: AnyPgColumn) =>
  check(
    name,
    sql`${hash} = encode(sha256(convert_to(${value}, 'UTF8')), 'hex')`,
  );

/**
 * Immutable publication payload reserved before provider I/O. Domain selection
 * IDs are historical evidence, not foreign keys to mutable current pointers.
 * Only claim/completion fields change. Completion evidence survives removal of
 * the delivery marker so an uncertain retry cannot resurrect a deleted bundle.
 * Neither a pending intent nor its assets grants permission or delivery access.
 */
export const ritualBundlePublicationIntents = pgTable(
  "ritual_bundle_publication_intents",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    bundleId: uuid("bundle_id").notNull().unique(),
    ritualId: uuid("ritual_id").notNull(),
    currentRevisionId: uuid("current_revision_id").notNull(),
    currentCompiledArtifactId: uuid("current_compiled_artifact_id"),
    parentVersion: bigint("parent_version", { mode: "number" }).notNull(),
    descriptorSha256: text("descriptor_sha256").notNull(),
    contentSha256: text("content_sha256").notNull(),
    publicationPolicyId: text("publication_policy_id").notNull(),
    manifestJson: text("manifest_json").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    // Serialize plan metadata without its top-level sha256 to retain its digest.
    planJson: text("plan_json").notNull(),
    planSha256: text("plan_sha256").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    claimId: uuid("claim_id"),
    claimStartedAt: instant("claim_started_at"),
    claimExpiresAt: instant("claim_expires_at"),
    completedAt: instant("completed_at"),
  },
  (t) => [
    ...[
      t.operationId,
      t.bundleId,
      t.ritualId,
      t.currentRevisionId,
      t.currentCompiledArtifactId,
      t.claimId,
    ].map((column) => v7(`ritual_bundle_intents_${column.name}_v7`, column)),
    unique("ritual_bundle_intents_asset_binding").on(
      t.operationId,
      t.bundleId,
      t.ritualId,
    ),
    unique("ritual_bundle_intents_completion_binding").on(
      t.operationId,
      t.bundleId,
      t.ritualId,
      t.currentRevisionId,
    ),
    index("ritual_bundle_intents_expiry_idx").on(t.expiresAt),
    index("ritual_bundle_intents_ritual_idx").on(t.ritualId),
    check(
      "ritual_bundle_intents_identity",
      sql`${t.parentVersion} between 0 and 9007199254740991 and ${t.descriptorSha256} ~ '^[0-9a-f]{64}$' and ${t.contentSha256} ~ '^[0-9a-f]{64}$' and ${t.requestHash} ~ '^[0-9a-f]{64}$' and ${t.publicationPolicyId} ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'`,
    ),
    exactHash(
      "ritual_bundle_intents_manifest_hash",
      t.manifestJson,
      t.manifestSha256,
    ),
    exactHash("ritual_bundle_intents_plan_hash", t.planJson, t.planSha256),
    check(
      "ritual_bundle_intents_manifest",
      sql`octet_length(${t.manifestJson}) between 1 and 16777216 and coalesce(json_typeof(${t.manifestJson}::json) = 'object' and ${t.manifestJson}::json ->> 'version' = '1' and ${t.manifestJson}::json ->> 'bundleId' = ${t.bundleId}::text and ${t.manifestJson}::json ->> 'ritualId' = ${t.ritualId}::text and ${t.manifestJson}::json -> 'descriptor' ->> 'descriptorSha256' = ${t.descriptorSha256} and ${t.manifestJson}::json -> 'descriptor' ->> 'contentSha256' = ${t.contentSha256} and ${t.manifestJson}::json -> 'descriptor' ->> 'outputFormat' = 'json-rich-text' and ${t.manifestJson}::json -> 'descriptor' ->> 'outputFormatVersion' = '1', false)`,
    ),
    check(
      "ritual_bundle_intents_plan",
      sql`octet_length(${t.planJson}) between 1 and 16777216 and coalesce(json_typeof(${t.planJson}::json) = 'object' and ((${t.planJson}::json ->> 'profile' = 'magickli-ritual-asset-plan-v4' and ${t.planJson}::json ->> 'inventoryProfile' = 'magickli-jrt-assets-v2' and not (${t.planJson}::jsonb ? 'privateCatalogSha256')) or (${t.planJson}::json ->> 'profile' = 'magickli-ritual-asset-plan-v5' and ${t.planJson}::json ->> 'inventoryProfile' = 'magickli-jrt-assets-v3' and ${t.planJson}::jsonb ? 'privateCatalogSha256' and (${t.planJson}::json ->> 'privateCatalogSha256' is null or ${t.planJson}::json ->> 'privateCatalogSha256' ~ '^[0-9a-f]{64}$'))) and ${t.planJson}::json ->> 'contentSha256' = ${t.contentSha256} and ${t.planJson}::json ->> 'resolutionComplete' = 'true' and json_typeof(${t.planJson}::json -> 'issues') = 'array' and json_array_length(${t.planJson}::json -> 'issues') = 0 and not (${t.planJson}::jsonb ? 'sha256'), false)`,
    ),
    check(
      "ritual_bundle_intents_expiry",
      sql`${t.createdAt} >= '1970-01-01T00:00:00Z'::timestamptz and ${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '24 hours'`,
    ),
    check(
      "ritual_bundle_intents_claim",
      sql`(${t.claimId} is null and ${t.claimStartedAt} is null and ${t.claimExpiresAt} is null) or (${t.claimId} is not null and ${t.claimStartedAt} is not null and ${t.claimStartedAt} >= ${t.createdAt} and ${t.claimExpiresAt} is not null and ${t.claimExpiresAt} > ${t.claimStartedAt} and ${t.claimExpiresAt} <= ${t.expiresAt} and ${t.claimExpiresAt} <= ${t.claimStartedAt} + interval '120 seconds')`,
    ),
    check(
      "ritual_bundle_intents_completion",
      sql`${t.completedAt} is null or (${t.claimId} is not null and ${t.completedAt} >= ${t.claimStartedAt} and ${t.completedAt} < ${t.claimExpiresAt} and ${t.completedAt} <= ${t.expiresAt})`,
    ),
  ],
);

/**
 * Exact byte destinations reserved before I/O; never Loom Files rows or global
 * digest deduplication. The publisher verifies every receipt against its claim,
 * reservation and bytes. Receipt presence alone does not make a bundle readable.
 */
export const ritualBundleAssets = pgTable(
  "ritual_bundle_assets",
  {
    operationId: uuid("operation_id").notNull(),
    bundleId: uuid("bundle_id").notNull(),
    ritualId: uuid("ritual_id").notNull(),
    key: uuid("key").notNull(),
    assetIndex: integer("asset_index").notNull(),
    reference: text("reference").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime")
      .$type<
        | "image/png"
        | "image/jpeg"
        | "image/gif"
        | "image/webp"
        | "image/svg+xml"
      >()
      .notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    receiptJson: text("receipt_json"),
    receiptSha256: text("receipt_sha256"),
    verifiedAt: instant("verified_at"),
  },
  (t) => [
    primaryKey({
      name: "ritual_bundle_assets_bundle_key",
      columns: [t.bundleId, t.key],
    }),
    unique("ritual_bundle_assets_operation_index").on(
      t.operationId,
      t.assetIndex,
    ),
    unique("ritual_bundle_assets_destination").on(
      t.storageProvider,
      t.bucket,
      t.objectKey,
    ),
    foreignKey({
      name: "ritual_bundle_assets_intent_binding",
      columns: [t.operationId, t.bundleId, t.ritualId],
      foreignColumns: [
        ritualBundlePublicationIntents.operationId,
        ritualBundlePublicationIntents.bundleId,
        ritualBundlePublicationIntents.ritualId,
      ],
    }),
    v7("ritual_bundle_assets_key_v7", t.key),
    check(
      "ritual_bundle_assets_identity",
      sql`${t.key} <> ${t.bundleId} and ${t.assetIndex} between 0 and 511 and octet_length(${t.reference}) between 1 and 1048576 and position('#' in ${t.reference}) = 0 and ${t.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ritual_bundle_assets_bytes",
      sql`(${t.mime} in ('image/png','image/jpeg','image/gif','image/webp') and ${t.byteSize} between 1 and 20971520) or (${t.mime} = 'image/svg+xml' and ${t.byteSize} between 1 and 4194304)`,
    ),
    check(
      "ritual_bundle_assets_destination_nonempty",
      sql`octet_length(${t.storageProvider}) between 1 and 128 and length(btrim(${t.storageProvider})) > 0 and octet_length(${t.bucket}) between 1 and 255 and length(btrim(${t.bucket})) > 0 and octet_length(${t.objectKey}) between 1 and 1024`,
    ),
    check(
      "ritual_bundle_assets_receipt",
      sql`(${t.receiptJson} is null and ${t.receiptSha256} is null and ${t.verifiedAt} is null) or (${t.receiptJson} is not null and ${t.receiptSha256} is not null and ${t.verifiedAt} is not null and ${t.verifiedAt} >= '1970-01-01T00:00:00Z'::timestamptz and isfinite(${t.verifiedAt}) and octet_length(${t.receiptJson}) between 1 and 16384 and json_typeof(${t.receiptJson}::json) = 'object')`,
    ),
    check(
      "ritual_bundle_assets_receipt_binding",
      sql`${t.receiptJson} is null or coalesce(${t.receiptJson}::json ->> 'profile' = 'magickli-ritual-bundle-object-receipt-v1' and ${t.receiptJson}::json ->> 'operationId' = ${t.operationId}::text and ${t.receiptJson}::json ->> 'bundleId' = ${t.bundleId}::text and ${t.receiptJson}::json ->> 'assetKey' = ${t.key}::text and ${t.receiptJson}::json ->> 'storageProvider' = ${t.storageProvider} and ${t.receiptJson}::json ->> 'bucket' = ${t.bucket} and ${t.receiptJson}::json ->> 'objectKey' = ${t.objectKey} and ${t.receiptJson}::json ->> 'sha256' = ${t.sha256} and ${t.receiptJson}::json ->> 'mime' = ${t.mime} and json_typeof(${t.receiptJson}::json -> 'byteSize') = 'number' and (${t.receiptJson}::json ->> 'byteSize')::numeric = ${t.byteSize} and json_typeof(${t.receiptJson}::json -> 'verifiedAtMs') = 'number' and (${t.receiptJson}::json ->> 'verifiedAtMs')::numeric = extract(epoch from ${t.verifiedAt}) * 1000, false)`,
    ),
    exactHash(
      "ritual_bundle_assets_receipt_hash",
      t.receiptJson,
      t.receiptSha256,
    ),
  ],
);

/**
 * Sole completed marker. Immutable selection/payload fields come from its intent.
 * Publisher and reader must both verify the complete receipt set; SQL cannot
 * express that cross-row aggregate with a CHECK. No marker means no delivery.
 */
export const ritualBundles = pgTable(
  "ritual_bundles",
  {
    bundleId: uuid("bundle_id").primaryKey(),
    operationId: uuid("operation_id").notNull().unique(),
    ritualId: uuid("ritual_id").notNull(),
    currentRevisionId: uuid("current_revision_id").notNull(),
    publishedAt: instant("published_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "ritual_bundles_intent_binding",
      columns: [t.operationId, t.bundleId, t.ritualId, t.currentRevisionId],
      foreignColumns: [
        ritualBundlePublicationIntents.operationId,
        ritualBundlePublicationIntents.bundleId,
        ritualBundlePublicationIntents.ritualId,
        ritualBundlePublicationIntents.currentRevisionId,
      ],
    }),
    foreignKey({
      name: "ritual_bundles_own_revision",
      columns: [t.ritualId, t.currentRevisionId],
      foreignColumns: [ritualRevisions.ritualId, ritualRevisions.id],
    }),
    index("ritual_bundles_ritual_idx").on(t.ritualId, t.publishedAt),
    check(
      "ritual_bundles_published_at",
      sql`${t.publishedAt} >= '1970-01-01T00:00:00Z'::timestamptz and isfinite(${t.publishedAt})`,
    ),
  ],
);
