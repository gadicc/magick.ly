import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidV7 } from "./ids";

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const timestamps = () => ({
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
const v7 = (name: string, id: AnyPgColumn) =>
  check(
    name,
    sql`substring(${id}::text from 15 for 1) = '7' and substring(${id}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
  );

/** Adapter-owned identity only: application access and historical profile data live separately. */
export const user = pgTable(
  "auth_user",
  {
    id: uuidV7("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps(),
  },
  (table) => [
    v7("auth_user_id_v7", table.id),
    uniqueIndex("auth_user_email_case_unique").on(sql`lower(${table.email})`),
  ],
);

/** Fresh Better Auth sessions are created after cutover; no legacy session is imported. */
export const session = pgTable(
  "auth_session",
  {
    id: uuidV7("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: instant("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (table) => [
    v7("auth_session_id_v7", table.id),
    index("auth_session_user_idx").on(table.userId),
  ],
);

/** The provider subject is text; only our local account row ID is a UUIDv7. */
export const account = pgTable(
  "auth_account",
  {
    id: uuidV7("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (table) => [
    v7("auth_account_id_v7", table.id),
    uniqueIndex("auth_account_provider_subject_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("auth_account_user_idx").on(table.userId),
  ],
);

/** New OAuth state and verification records only; legacy values are discarded. */
export const verification = pgTable(
  "auth_verification",
  {
    id: uuidV7("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    ...timestamps(),
  },
  (table) => [
    v7("auth_verification_id_v7", table.id),
    index("auth_verification_identifier_idx").on(table.identifier),
  ],
);
