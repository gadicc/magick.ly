import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { rituals } from "../db/schema/rituals";
import { getRitualAccess, parseRitualScope } from "../doc/access";
import {
  RITUAL_OUTPUT_FORMAT,
  RITUAL_OUTPUT_FORMAT_VERSION,
} from "../doc/compileContract";
import {
  loadSqlRitualPrincipal,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "../doc/sqlPolicy";
import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { selectSqlRenderedRitual } from "../doc/sqlRendered";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import { OFFLINE_AUTHORIZATION_WINDOW_MS } from "./lease";
import {
  parseRitualPermissionRequest,
  type RitualPermissionResponseV1,
} from "./permissionContract";

const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);

/**
 * Inactive server permission boundary. getVerifiedActorId verifies the current
 * session, returning null for missing/expired sessions; it must not read request
 * identity claims. A valid user's absent ritual is a denial, whereas malformed
 * persisted policy/output and operational errors are temporary.
 *
 * One read-only repeatable-read snapshot covers current identity, grants, policy
 * and selected output. Revocation after that snapshot affects the next check; an
 * issued grant expires at most fourteen days after this check's start. Nothing
 * here produces a complete bundle, authorizes assets, or fetches editor source.
 */
export function createSqlRitualPermissionChecker(
  db: SqlRitualReadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { now?: () => number; leaseDurationMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const duration = options.leaseDurationMs ?? OFFLINE_AUTHORIZATION_WINDOW_MS;
  if (
    !instant(duration) ||
    duration === 0 ||
    duration > OFFLINE_AUTHORIZATION_WINDOW_MS
  )
    throw new RangeError("Invalid offline permission duration");
  return async (input: unknown): Promise<RitualPermissionResponseV1 | null> => {
    const request = parseRitualPermissionRequest(input);
    if (!request) return null;
    const base = {
      version: 1 as const,
      requestId: request.requestId,
      ownerId: request.expectedActorId,
      ritualId: request.ritualId,
    };
    const temporary = { ...base, kind: "temporarily-unavailable" as const };
    const authentication = {
      ...base,
      kind: "authentication-required" as const,
    };
    try {
      const actorId = await getVerifiedActorId();
      if (!isUuidV7(actorId) || actorId !== request.expectedActorId)
        return authentication;
      // Starting before the first snapshot query is conservative: preparation time consumes the lease.
      const checkedAtMs = now();
      if (!instant(checkedAtMs) || !instant(checkedAtMs + duration))
        return temporary;
      const result = await db.transaction(
        async (tx): Promise<RitualPermissionResponseV1> => {
          const principal = await loadSqlRitualPrincipal(tx, actorId);
          if (!principal) return authentication;
          const [row] = await tx
            .select(sqlRitualParentFields)
            .from(rituals)
            .where(eq(rituals.id, request.ritualId));
          if (!row) return { ...base, kind: "denied" };
          const policy = sqlRitualPolicy(row);
          if (!policy || !parseRitualScope(policy.scope)) return temporary;
          const access = getRitualAccess(policy, principal);
          if (!access.read) return { ...base, kind: "denied" };
          const selected = await selectSqlRenderedRitual(tx, row);
          const rendered: Extract<
            RitualPermissionResponseV1,
            { kind: "granted" }
          >["rendered"] = selected
            ? {
                kind: "available",
                descriptor: {
                  // An internal identity digest, not a bundle ID. Revision tokens remain editor-only.
                  descriptorSha256: createHash("sha256")
                    .update(
                      JSON.stringify([
                        "magickli-ritual-render-descriptor-v1",
                        row.id,
                        row.currentRevisionId,
                        row.version,
                        row.currentCompiledArtifactId,
                        selected.contentSha256,
                        RITUAL_OUTPUT_FORMAT,
                        RITUAL_OUTPUT_FORMAT_VERSION,
                      ]),
                      "utf8",
                    )
                    .digest("hex"),
                  contentSha256: selected.contentSha256,
                  outputFormat: RITUAL_OUTPUT_FORMAT,
                  outputFormatVersion: RITUAL_OUTPUT_FORMAT_VERSION,
                },
              }
            : { kind: "temporarily-unavailable" };
          return {
            ...base,
            kind: "granted",
            rendered,
            editor:
              access.edit && row.currentRevisionId !== null
                ? {
                    currentRevisionId: row.currentRevisionId,
                    parentVersion: row.version,
                  }
                : null,
            grant: {
              version: 1,
              leaseId: createUuidV7(),
              ownerId: request.expectedActorId,
              ritualId: row.id,
              checkedAtMs,
              expiresAtMs: checkedAtMs + duration,
              respondedAtMs: checkedAtMs,
              sourceEdit: access.edit,
            },
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      if (result.kind !== "granted") return result;
      const respondedAtMs = now();
      if (
        !instant(respondedAtMs) ||
        respondedAtMs < checkedAtMs ||
        respondedAtMs >= result.grant.expiresAtMs
      )
        return temporary;
      return { ...result, grant: { ...result.grant, respondedAtMs } };
    } catch {
      return temporary;
    }
  };
}
