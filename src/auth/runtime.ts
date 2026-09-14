import "server-only";
import {
  isBetterAuthLocalTestLoginEnabled,
  requireBetterAuthSecret,
} from "@gadicc/loom/next/auth";
import { db } from "../db/neonFull";
import { createSqlAuth } from "./sqlAuth";

/** One SQL auth instance. Next loads deployment environment variables itself. */
export const sqlAuth = createSqlAuth({
  db,
  // An explicit deployment origin prevents Preview from borrowing Production's
  // ROOT_URL/NEXTAUTH_URL or accepting an untrusted request Host header.
  baseURL: process.env.BETTER_AUTH_URL ?? "",
  secret: requireBetterAuthSecret(),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  localTestLoginEnabled: isBetterAuthLocalTestLoginEnabled(process.env),
});
