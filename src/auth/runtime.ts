import "server-only";
import {
  isBetterAuthLocalTestLoginEnabled,
  requireBetterAuthSecret,
} from "@gadicc/loom/next/auth";
import { db } from "../db/neonFull";
import { createSqlAuth } from "./sqlAuth";

// createSqlAuth reports unset and malformed values alike, so name what is unset.
function requireSetting(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing SQL auth setting. Set ${name}.`);
  return value;
}

/** One SQL auth instance. Next loads deployment environment variables itself. */
export const sqlAuth = createSqlAuth({
  db,
  // An explicit deployment origin prevents Preview from borrowing Production's
  // ROOT_URL/NEXTAUTH_URL or accepting an untrusted request Host header.
  baseURL: requireSetting("BETTER_AUTH_URL"),
  secret: requireBetterAuthSecret(),
  googleClientId: requireSetting("GOOGLE_CLIENT_ID"),
  googleClientSecret: requireSetting("GOOGLE_CLIENT_SECRET"),
  localTestLoginEnabled: isBetterAuthLocalTestLoginEnabled(process.env),
});
