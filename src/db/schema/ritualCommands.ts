import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Immutable SQL-v2 outcomes. Result domain IDs are historical values, deliberately
 * not FKs that block future deletion. Replay still requires current parent edit
 * access; this receipt is never an access grant. Legacy-v1 receipts stay separate.
 */
export const ritualWriteReceipts = pgTable(
  "ritual_write_receipts_v2",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    requestHash: text("request_hash").notNull(),
    kind: text("kind").$type<"create" | "save" | "publish">().notNull(),
    ritualId: uuid("ritual_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    ...[table.operationId, table.ritualId, table.revisionId].map((column) =>
      check(
        `ritual_write_receipts_v2_${column.name}_v7`,
        sql`substring(${column}::text from 15 for 1) = '7' and substring(${column}::text from 20 for 1) in ('8','9','a','b')`,
      ),
    ),
    check(
      "ritual_write_receipts_v2_hash_valid",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ritual_write_receipts_v2_kind_valid",
      sql`${table.kind} in ('create','save','publish')`,
    ),
    check(
      "ritual_write_receipts_v2_version_safe",
      sql`${table.version} between 1 and 9007199254740991`,
    ),
  ],
);
