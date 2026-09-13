import "server-only";
import { createBetterAuthSessionConfig } from "@gadicc/loom/next/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "../db/schema/auth";
import { createUuidV7, isUuidV7 } from "../lib/ids";

/** Explicit deployment configuration; constructing this does not switch login routes. */
export interface SqlAuthOptions {
  /** A transactional Drizzle PostgreSQL connection (neonFull in the app). */
  db: Parameters<typeof drizzleAdapter>[0];
  /** Exact origin, including the port for local development; no host wildcards. */
  baseURL: string;
  /** Resolve through Loom's requireBetterAuthSecret in the eventual runtime wrapper. */
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
}

/**
 * Shared SQL authentication configuration for runtime integration and rehearsal.
 * Identity lives in auth tables; current application grants are read separately.
 * No env loader, database singleton or test-only provider bypass is installed here.
 */
export function createSqlAuth(options: SqlAuthOptions) {
  let origin: URL;
  try {
    origin = new URL(options.baseURL);
  } catch {
    throw new Error("Invalid SQL auth origin");
  }
  if (
    origin.origin !== options.baseURL ||
    origin.hostname.includes("*") ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid SQL auth origin");
  if (
    typeof options.secret !== "string" ||
    options.secret.length < 32 ||
    typeof options.googleClientId !== "string" ||
    !options.googleClientId.trim() ||
    typeof options.googleClientSecret !== "string" ||
    !options.googleClientSecret.trim() ||
    typeof options.db?.transaction !== "function"
  )
    throw new Error("Invalid SQL auth configuration");

  return betterAuth({
    appName: "Magickly",
    baseURL: origin.origin,
    secret: options.secret,
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema,
      // New user and provider account must commit together.
      transaction: true,
    }),
    advanced: {
      cookiePrefix: "magickli-sql",
      // Better Auth otherwise skips origin checks in NODE_ENV=test. Rehearsal
      // and runtime must exercise the same request protections.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: createUuidV7 },
    },
    session: createBetterAuthSessionConfig(),
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    socialProviders: {
      google: {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
        overrideUserInfo: false,
      },
    },
    emailAndPassword: { enabled: false },
    user: { deleteUser: { enabled: false } },
    logger: {
      level: "warn",
      // Adapter errors can contain raw SQL token parameters. Never forward the
      // library's message/arguments, even when OAuth token encryption is enabled.
      log(level) {
        if (level === "error") console.error("SQL_AUTH_ERROR");
        else if (level === "warn") console.warn("SQL_AUTH_WARNING");
      },
    },
  });
}

/** SQL identity only; application authorization never comes from OAuth fields. */
export type SqlAuth = ReturnType<typeof createSqlAuth>;
export type SqlAuthSession = SqlAuth["$Infer"]["Session"];

/**
 * Read the actual session for each call, including checks after awaited provider
 * work. Do not wrap this in React.cache: an earlier read must not hide revocation.
 * Public UI may separately use Loom's short-lived cached session reader.
 */
export async function getFreshSqlSession(
  auth: SqlAuth,
  headers: Headers,
): Promise<SqlAuthSession | null> {
  const current = await auth.api.getSession({
    headers: new Headers(headers),
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!current) return null;
  if (
    !isUuidV7(current.user.id) ||
    !isUuidV7(current.session.id) ||
    current.user.id !== current.user.id.toLowerCase() ||
    current.session.id !== current.session.id.toLowerCase() ||
    current.session.userId !== current.user.id
  )
    throw new Error("Invalid SQL authentication identity");
  if (
    !(current.session.expiresAt instanceof Date) ||
    !Number.isFinite(current.session.expiresAt.getTime())
  )
    throw new Error("Invalid SQL authentication identity");
  if (current.session.expiresAt.getTime() <= Date.now()) return null;
  return current;
}

/** Adapter for domain services that accept an authenticated canonical user ID. */
export async function getFreshSqlUserId(
  auth: SqlAuth,
  headers: Headers,
): Promise<string | null> {
  return (await getFreshSqlSession(auth, headers))?.user.id ?? null;
}
