import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { legacyIdType } from "./legacyIds";
import { loomFilesTable } from "./loomFiles";

/**
 * Protected migration evidence, never included in a Loom file metadata response.
 * The public path is a historical compatibility obligation, not an attachment grant.
 * Object bytes are not verified by this metadata-only import.
 */
export const legacyFileSnapshots = pgTable(
  "legacy_file_snapshots",
  {
    sourceSystem: text("source_system").notNull(),
    legacyIdType: legacyIdType("legacy_id_type").notNull(),
    legacyIdValue: text("legacy_id_value").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => loomFilesTable.id),
    sourceEjson: text("source_ejson").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    serializationVersion: text("serialization_version").notNull(),
    legacyPublicPath: text("legacy_public_path").notNull(),
    sourceStorageProvider: text("source_storage_provider").notNull(),
    sourceBucket: text("source_bucket").notNull(),
    sourceObjectKey: text("source_object_key").notNull(),
    // Explicit verified addressing evidence, separate from the unchanged public digest.
    sourceObjectKeyPrefix: text("source_object_key_prefix")
      .notNull()
      .default(""),
    legacySyncUpdatedAtMilliseconds: bigint(
      "legacy_sync_updated_at_milliseconds",
      { mode: "number" },
    ),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceSystem, table.legacyIdType, table.legacyIdValue],
    }),
    uniqueIndex("legacy_file_snapshot_file_unique").on(table.fileId),
    check("legacy_file_source_system", sql`${table.sourceSystem} = 'mongodb'`),
    check(
      "legacy_file_source_id",
      sql`length(${table.legacyIdValue}) > 0 and (${table.legacyIdType} <> 'objectid' or ${table.legacyIdValue} ~ '^[0-9a-f]{24}$')`,
    ),
    check(
      "legacy_file_sync_timestamp",
      sql`${table.legacySyncUpdatedAtMilliseconds} between 0 and 9007199254740991`,
    ),
    check(
      "legacy_file_serialization",
      sql`${table.serializationVersion} = 'bson-canonical-ejson-v1'`,
    ),
    check(
      "legacy_file_source_hash",
      sql`${table.sourceSha256} = encode(sha256(convert_to(${table.sourceEjson}, 'UTF8')), 'hex')`,
    ),
    check(
      "legacy_file_source_json_object",
      sql`json_typeof(${table.sourceEjson}::json) = 'object'`,
    ),
    check(
      "legacy_file_source_location",
      sql`length(btrim(${table.sourceStorageProvider})) > 0 and length(btrim(${table.sourceBucket})) > 0 and ${table.sourceObjectKey} = ${table.sourceObjectKeyPrefix} || (${table.sourceEjson}::json ->> 'sha256')`,
    ),
    check(
      "legacy_file_source_digest",
      sql`coalesce(json_typeof(${table.sourceEjson}::json -> 'sha256') = 'string' and (${table.sourceEjson}::json ->> 'sha256') ~ '^[0-9a-f]{64}$', false)`,
    ),
    check(
      "legacy_file_source_prefix",
      sql`octet_length(${table.sourceObjectKeyPrefix}) <= 960 and (${table.sourceObjectKeyPrefix} = '' or right(${table.sourceObjectKeyPrefix}, 1) = '/')`,
    ),
    check(
      "legacy_file_public_path",
      sql`${table.legacyPublicPath} = '/api/file2?sha256=' || (${table.sourceEjson}::json ->> 'sha256')`,
    ),
  ],
);

/**
 * Evidence that one immutable legacy object was copied and byte-verified at a
 * closed replacement location. The original snapshot remains the source of
 * import provenance and is never rewritten during relocation.
 */
export const legacyFileRelocations = pgTable(
  "legacy_file_relocations",
  {
    fileId: uuid("file_id")
      .primaryKey()
      .references(() => loomFilesTable.id),
    sourceStorageProvider: text("source_storage_provider").notNull(),
    sourceBucket: text("source_bucket").notNull(),
    sourceObjectKey: text("source_object_key").notNull(),
    sourceMetadataSha256: text("source_metadata_sha256").notNull(),
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    destinationStorageProvider: text("destination_storage_provider").notNull(),
    destinationBucket: text("destination_bucket").notNull(),
    destinationObjectKey: text("destination_object_key").notNull(),
    verificationProfile: text("verification_profile").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("legacy_file_relocation_destination_unique").on(
      table.destinationStorageProvider,
      table.destinationBucket,
      table.destinationObjectKey,
    ),
    check(
      "legacy_file_relocation_file_id_v7",
      sql`substring(${table.fileId}::text from 15 for 1) = '7' and substring(${table.fileId}::text from 20 for 1) in ('8','9','a','b')`,
    ),
    check(
      "legacy_file_relocation_source",
      sql`length(btrim(${table.sourceStorageProvider})) > 0 and length(btrim(${table.sourceBucket})) > 0 and length(${table.sourceObjectKey}) > 0 and ${table.sourceMetadataSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "legacy_file_relocation_content",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$' and ${table.byteSize} between 1 and 20971520`,
    ),
    check(
      "legacy_file_relocation_destination",
      sql`${table.destinationStorageProvider} = 'r2' and ${table.destinationBucket} = 'magickli-files-production' and ${table.destinationObjectKey} = 'legacy-file2/' || ${table.contentSha256} and (${table.sourceStorageProvider}, ${table.sourceBucket}, ${table.sourceObjectKey}) <> (${table.destinationStorageProvider}, ${table.destinationBucket}, ${table.destinationObjectKey})`,
    ),
    check(
      "legacy_file_relocation_verification",
      sql`${table.verificationProfile} = 'magickli-legacy-file-relocation-v1' and ${table.verifiedAt} >= '1970-01-01T00:00:00Z'::timestamptz and isfinite(${table.verifiedAt})`,
    ),
  ],
);
