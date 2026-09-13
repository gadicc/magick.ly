import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Protected singleton checkpoint for the maintenance importer. The saved payload
 * owns all allocations; SQL defaults must never create IDs or dates on a retry.
 * No domain foreign keys can erase this evidence when application rows change.
 */
export const legacyImportRuns = pgTable(
  "legacy_import_runs",
  {
    runId: uuid("run_id").primaryKey(),
    slot: integer("slot").notNull().unique(),
    profile: text("profile").$type<"magickli-legacy-import-run-v1">().notNull(),
    sourceManifestSha256: text("source_manifest_sha256").notNull(),
    sourceDescriptorSha256: text("source_descriptor_sha256").notNull(),
    configurationSha256: text("configuration_sha256").notNull(),
    schemaSha256: text("schema_sha256").notNull(),
    targetSha256: text("target_sha256").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    expectedRowsSha256: text("expected_rows_sha256").notNull(),
    payload: text("payload").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reconciliationSha256: text("reconciliation_sha256"),
  },
  (table) => [
    check(
      "legacy_import_runs_id_v7",
      sql`substring(${table.runId}::text from 15 for 1) = '7' and substring(${table.runId}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
    ),
    check("legacy_import_runs_singleton", sql`${table.slot} = 1`),
    check(
      "legacy_import_runs_profile",
      sql`${table.profile} = 'magickli-legacy-import-run-v1'`,
    ),
    ...[
      table.sourceManifestSha256,
      table.sourceDescriptorSha256,
      table.configurationSha256,
      table.schemaSha256,
      table.targetSha256,
      table.payloadSha256,
      table.expectedRowsSha256,
    ].map((column) =>
      check(
        `legacy_import_runs_${column.name}_hex`,
        sql`${column} ~ '^[0-9a-f]{64}$'`,
      ),
    ),
    check(
      "legacy_import_runs_payload_bytes",
      sql`octet_length(${table.payload}) between 1 and 67108864`,
    ),
    check(
      "legacy_import_runs_payload_hash",
      sql`${table.payloadSha256} = encode(sha256(convert_to(${table.payload}, 'UTF8')), 'hex')`,
    ),
    check(
      "legacy_import_runs_finite_timestamps",
      sql`isfinite(${table.importedAt}) and isfinite(${table.preparedAt})
        and (${table.completedAt} is null or isfinite(${table.completedAt}))`,
    ),
    check(
      "legacy_import_runs_completion",
      sql`(${table.completedAt} is null and ${table.reconciliationSha256} is null)
        or (${table.completedAt} is not null and ${table.reconciliationSha256} is not null
          and ${table.reconciliationSha256} = ${table.expectedRowsSha256}
          and ${table.completedAt} >= ${table.preparedAt})`,
    ),
  ],
);
