import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Immutable creation outcomes. Domain IDs are historical results, deliberately
 * not foreign keys that would block later membership removal or temple deletion.
 * Replaying a receipt never recreates rows or grants current administration.
 */
export const templeCreationReceipts = pgTable(
  "temple_creation_receipts",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => user.id),
    requestHash: text("request_hash").notNull(),
    templeId: uuid("temple_id").notNull(),
    firstAdminMembershipId: uuid("first_admin_membership_id").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    ...[table.operationId, table.templeId, table.firstAdminMembershipId].map(
      (column) =>
        check(
          `temple_creation_receipts_${column.name}_v7`,
          sql`substring(${column}::text from 15 for 1) = '7' and substring(${column}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
        ),
    ),
    check(
      "temple_creation_receipts_hash_valid",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "temple_creation_receipts_slug_nonempty",
      sql`length(btrim(${table.slug})) > 0`,
    ),
  ],
);
