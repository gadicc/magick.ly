import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidV7 } from "./ids";

/** Source type is part of identity; matching string/ObjectId text is not enough. */
export const legacyIdType = pgEnum("legacy_id_type", ["objectid", "string"]);

/** Durable aliases survive importer retries and old clients returning offline. */
export const legacyIdAliases = pgTable(
  "legacy_id_aliases",
  {
    id: uuidV7("id").primaryKey(),
    sourceSystem: text("source_system").notNull(),
    entityType: text("entity_type").notNull(),
    legacyIdType: legacyIdType("legacy_id_type").notNull(),
    legacyIdValue: text("legacy_id_value").notNull(),
    // Multiple aliases can deliberately identify one canonical entity. Domain
    // tables arrive later; this polymorphic target is validated by the importer.
    canonicalId: uuid("canonical_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("legacy_id_aliases_source_key_unique").on(
      table.sourceSystem,
      table.entityType,
      table.legacyIdType,
      table.legacyIdValue,
    ),
    index("legacy_id_aliases_canonical_idx").on(
      table.entityType,
      table.canonicalId,
    ),
    check(
      "legacy_id_aliases_source_nonempty",
      sql`length(btrim(${table.sourceSystem})) > 0`,
    ),
    check(
      "legacy_id_aliases_entity_nonempty",
      sql`length(btrim(${table.entityType})) > 0`,
    ),
    check(
      "legacy_id_aliases_objectid_format",
      sql`${table.legacyIdType} <> 'objectid' or ${table.legacyIdValue} ~ '^[0-9a-f]{24}$'`,
    ),
    check(
      "legacy_id_aliases_canonical_uuid_v7",
      sql`substring(${table.canonicalId}::text from 15 for 1) = '7' and substring(${table.canonicalId}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
    ),
  ],
);
