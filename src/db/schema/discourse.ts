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
import { user } from "./auth";

/**
 * App-owned forum identity, never an OAuth login or an email-based account merge.
 * Readers must match the explicit forum origin before using its external ID.
 */
export const discourseUserLinks = pgTable(
  "discourse_user_links",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    forumOrigin: text("forum_origin").notNull(),
    // Discourse owns this numeric identity; it must never become a local UUID.
    discourseUserId: bigint("discourse_user_id", { mode: "number" }).notNull(),
    // Local row bookkeeping, not a claim about when the forum account was linked.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.forumOrigin] }),
    uniqueIndex("discourse_user_links_forum_account_unique").on(
      table.forumOrigin,
      table.discourseUserId,
    ),
    check(
      "discourse_user_links_external_id_safe",
      sql`${table.discourseUserId} between 1 and 9007199254740991`,
    ),
    // The planner checks canonical URL serialization too. This SQL boundary
    // prevents paths, credentials and unbounded index keys from being stored.
    check(
      "discourse_user_links_forum_origin_shape",
      sql`octet_length(${table.forumOrigin}) <= 255 and ${table.forumOrigin} ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'`,
    ),
  ],
);
