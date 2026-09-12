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
