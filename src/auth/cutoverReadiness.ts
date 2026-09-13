import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../db/neonFull";
import { legacyImportRuns } from "../db/schema/legacyImportRuns";

const PROFILE = "magickli-legacy-import-run-v1";
const SLOT = 1;
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

type ImportRun = typeof legacyImportRuns.$inferSelect;

/** A completed protected singleton remains valid after ordinary application writes. */
export function completedLegacyImportRun(value: unknown): value is ImportRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<ImportRun>;
  return (
    row.slot === SLOT &&
    row.profile === PROFILE &&
    row.completedAt instanceof Date &&
    Number.isFinite(row.completedAt.getTime()) &&
    sha256(row.expectedRowsSha256) &&
    row.reconciliationSha256 === row.expectedRowsSha256
  );
}

export function createSqlAuthCutoverReadiness(
  readRuns: () => Promise<readonly unknown[]>,
) {
  return async (): Promise<boolean> => {
    try {
      const rows = await readRuns();
      return rows.length === 1 && completedLegacyImportRun(rows[0]);
    } catch {
      return false;
    }
  };
}

export const sqlAuthCutoverReady = createSqlAuthCutoverReadiness(() =>
  db
    .select()
    .from(legacyImportRuns)
    .where(
      and(
        eq(legacyImportRuns.slot, SLOT),
        eq(legacyImportRuns.profile, PROFILE),
      ),
    ),
);

type AuthHandler = (request: Request) => Promise<Response>;

/** Guard every auth method before Better Auth can read a provider callback or create rows. */
export function guardSqlAuthHandler(
  handler: AuthHandler,
  ready: () => Promise<boolean> = sqlAuthCutoverReady,
): AuthHandler {
  return async (request) => {
    let available = false;
    try {
      available = await ready();
    } catch {
      // A readiness failure is never an anonymous or empty-import success.
    }
    if (!available)
      return Response.json(
        { error: "AUTH_CUTOVER_NOT_READY" },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store, max-age=0",
            "Retry-After": "60",
            Vary: "Cookie, Authorization",
          },
        },
      );
    return handler(request);
  };
}
