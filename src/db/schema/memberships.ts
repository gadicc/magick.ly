import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LegacyAliasKey } from "../legacyIds";
import { user } from "./auth";
import { uuidV7 } from "./ids";

const instant = (name: string) => timestamp(name, { withTimezone: true });
const history = () => ({
  createdAt: instant("created_at"),
  updatedAt: instant("updated_at"),
  legacySyncUpdatedAtMilliseconds: bigint(
    "legacy_sync_updated_at_milliseconds",
    {
      mode: "number",
    },
  ),
});
const v7 = (name: string, id: AnyPgColumn) =>
  check(
    name,
    sql`substring(${id}::text from 15 for 1) = '7' and substring(${id}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
  );

/** Group names are labels, not unique identifiers or sources of permissions. */
export const userGroups = pgTable(
  "user_groups",
  {
    id: uuidV7("id").primaryKey(),
    name: text("name").notNull(),
    ...history(),
  },
  (table) => [v7("user_groups_id_v7", table.id)],
);

/** An admin-only edge is valid; effective admin access is evaluated by the existing policy. */
export const userGroupGrants = pgTable(
  "user_group_grants",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => userGroups.id),
    member: boolean("member").notNull().default(false),
    admin: boolean("admin").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.groupId] }),
    index("user_group_grants_group_idx").on(table.groupId),
    check(
      "user_group_grants_has_grant",
      sql`${table.member} or ${table.admin}`,
    ),
  ],
);

/** Protected source evidence, including duplicate entries and absent versus empty arrays. */
export const legacyUserGroupGrants = pgTable("legacy_user_group_grants", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id),
  groupIdsPresent: boolean("group_ids_present").notNull(),
  groupAdminIdsPresent: boolean("group_admin_ids_present").notNull(),
  groupReferences: jsonb("group_references")
    .$type<LegacyAliasKey[]>()
    .notNull(),
  groupAdminReferences: jsonb("group_admin_references")
    .$type<LegacyAliasKey[]>()
    .notNull(),
  importedAt: instant("imported_at").notNull(),
});

/** Ordinary temple metadata excludes invitation material. Unknown historical creators stay null. */
export const temples = pgTable(
  "temples",
  {
    id: uuidV7("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdById: uuid("created_by_id").references(() => user.id),
    ...history(),
  },
  (table) => [
    v7("temples_id_v7", table.id),
    // Preserve the original URL spelling while refusing normalized collisions.
    uniqueIndex("temples_slug_normalized_unique").on(
      sql`lower(btrim(${table.slug}))`,
    ),
    check("temples_slug_nonempty", sql`length(btrim(${table.slug})) > 0`),
    index("temples_created_by_idx").on(table.createdById),
  ],
);

/** Admin-only read/share configuration; the legacy UI needs the original invite code. */
export const templeInvites = pgTable("temple_invites", {
  templeId: uuid("temple_id")
    .primaryKey()
    .references(() => temples.id),
  joinPass: text("join_pass").notNull(),
});

/** Grade zero is valid. No grade, admin or creation-time inference occurs during import. */
export const templeMemberships = pgTable(
  "temple_memberships",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    templeId: uuid("temple_id")
      .notNull()
      .references(() => temples.id),
    grade: integer("grade").notNull(),
    admin: boolean("admin").notNull().default(false),
    motto: text("motto"),
    addedAt: instant("added_at").notNull(),
    memberSince: instant("member_since"),
    ...history(),
  },
  (table) => [
    v7("temple_memberships_id_v7", table.id),
    uniqueIndex("temple_memberships_user_temple_unique").on(
      table.userId,
      table.templeId,
    ),
    index("temple_memberships_temple_idx").on(table.templeId),
    check("temple_memberships_grade_nonnegative", sql`${table.grade} >= 0`),
  ],
);
