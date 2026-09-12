import {
  bigint,
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  NormalizedLegacyAuthAccount,
  NormalizedLegacyEmail,
} from "../../migration/normalizeLegacyAuth";
import { account, user } from "./auth";
import { uuidV7 } from "./ids";

/** App-owned public profile fields cannot be overwritten by the auth adapter. */
export const userProfile = pgTable("user_profile", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
});

/** App-owned global access; group/temple grants belong to their later domain schemas. */
export const userAccess = pgTable("user_access", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  admin: boolean("admin").notNull().default(false),
});

/** Private provenance, never a secondary login or automatic account-linking directory. */
export const legacyUserEmails = pgTable(
  "legacy_user_emails",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    verified: boolean("verified").notNull(),
    evidence: jsonb("evidence")
      .$type<NormalizedLegacyEmail["evidence"]>()
      .notNull(),
  },
  (table) => [
    uniqueIndex("legacy_user_emails_user_value_unique").on(
      table.userId,
      table.value,
    ),
  ],
);

/** Nullable historical dates remain distinct from required adapter bookkeeping dates. */
export const legacyAuthUsers = pgTable("legacy_auth_users", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  syncUpdatedAtMilliseconds: bigint("sync_updated_at_milliseconds", {
    mode: "number",
  }),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
});

/** Identity provenance contains typed references and dates, never historical provider tokens. */
export const legacyAuthAccounts = pgTable("legacy_auth_accounts", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => account.id, { onDelete: "cascade" }),
  legacyType: text("legacy_type").$type<"oauth" | "oidc">().notNull(),
  modernSources: jsonb("modern_sources")
    .$type<NormalizedLegacyAuthAccount["modernSources"]>()
    .notNull(),
  embeddedSources: jsonb("embedded_sources")
    .$type<NormalizedLegacyAuthAccount["embeddedSources"]>()
    .notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
});
