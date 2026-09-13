import "server-only";

import { and, asc, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { ritualBundlePublicationIntents } from "../db/schema/ritualBundles";
import { rituals } from "../db/schema/rituals";
import { loadSqlRitualPrincipal } from "../doc/sqlPolicy";
import { isUuidV7 } from "../lib/ids";
import { isRitualBundlePublicationPolicyId } from "./ritualBundlePublication";

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
export interface SqlRitualPublicationBackfillDatabase {
  transaction<T>(
    work: (tx: ReadDatabase) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}
export interface RitualPublicationBackfillCursor {
  expectedActorId: string;
  afterRitualId: string | null;
}
export interface RitualPublicationBackfillCandidate {
  ritualId: string;
  currentRevisionId: string;
  currentCompiledArtifactId: string | null;
  version: number;
  pendingOperationIds: readonly string[];
}
export interface RitualPublicationBackfillPage {
  candidates: readonly RitualPublicationBackfillCandidate[];
  exhausted: boolean;
}
export class RitualPublicationBackfillReadError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "AUTH_REQUIRED"
      | "ACTOR_CHANGED"
      | "FORBIDDEN"
      | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "RitualPublicationBackfillReadError";
  }
}
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
function fail(code: RitualPublicationBackfillReadError["code"]): never {
  throw new RitualPublicationBackfillReadError(code);
}

/** One bounded global-admin page; profile data and source never leave SQL. */
export function createSqlRitualPublicationBackfillReader(
  database: SqlRitualPublicationBackfillDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { publicationPolicyId: string; now?: () => number },
) {
  if (!isRitualBundlePublicationPolicyId(options.publicationPolicyId))
    throw new TypeError("Invalid publication backfill policy");
  const now = options.now ?? Date.now;
  return async function read(
    input: RitualPublicationBackfillCursor,
    signal = new AbortController().signal,
  ): Promise<RitualPublicationBackfillPage> {
    const request = structuredClone(input);
    if (
      !request ||
      !id(request.expectedActorId) ||
      (request.afterRitualId !== null && !id(request.afterRitualId))
    )
      fail("INVALID_REQUEST");
    if (signal.aborted) fail("UNAVAILABLE");
    const actorId = await getVerifiedActorId();
    if (!id(actorId)) fail("AUTH_REQUIRED");
    if (actorId !== request.expectedActorId) fail("ACTOR_CHANGED");
    try {
      return await database.transaction(
        async (tx) => {
          const principal = await loadSqlRitualPrincipal(tx, actorId);
          if (!principal) fail("AUTH_REQUIRED");
          if (!principal.globalAdmin) fail("FORBIDDEN");
          const rows = await tx
            .select({
              ritualId: rituals.id,
              currentRevisionId: rituals.currentRevisionId,
              currentCompiledArtifactId: rituals.currentCompiledArtifactId,
              version: rituals.version,
            })
            .from(rituals)
            .where(
              and(
                isNotNull(rituals.currentRevisionId),
                request.afterRitualId === null
                  ? undefined
                  : gt(rituals.id, request.afterRitualId),
              ),
            )
            .orderBy(asc(rituals.id))
            .limit(17);
          if (signal.aborted) fail("UNAVAILABLE");
          const selected = rows.slice(0, 16);
          const time = now();
          if (!Number.isSafeInteger(time) || time < 0) fail("UNAVAILABLE");
          const instant = new Date(time);
          const candidates: RitualPublicationBackfillCandidate[] = [];
          for (const row of selected) {
            const intents = await tx
              .select({
                operationId: ritualBundlePublicationIntents.operationId,
              })
              .from(ritualBundlePublicationIntents)
              .where(
                and(
                  eq(
                    ritualBundlePublicationIntents.actorId,
                    request.expectedActorId,
                  ),
                  eq(ritualBundlePublicationIntents.ritualId, row.ritualId),
                  eq(
                    ritualBundlePublicationIntents.currentRevisionId,
                    row.currentRevisionId!,
                  ),
                  row.currentCompiledArtifactId === null
                    ? isNull(
                        ritualBundlePublicationIntents.currentCompiledArtifactId,
                      )
                    : eq(
                        ritualBundlePublicationIntents.currentCompiledArtifactId,
                        row.currentCompiledArtifactId,
                      ),
                  eq(ritualBundlePublicationIntents.parentVersion, row.version),
                  eq(
                    ritualBundlePublicationIntents.publicationPolicyId,
                    options.publicationPolicyId,
                  ),
                  isNull(ritualBundlePublicationIntents.completedAt),
                  lte(ritualBundlePublicationIntents.createdAt, instant),
                  gt(ritualBundlePublicationIntents.expiresAt, instant),
                ),
              )
              .orderBy(asc(ritualBundlePublicationIntents.operationId))
              .limit(2);
            if (signal.aborted) fail("UNAVAILABLE");
            candidates.push({
              ritualId: row.ritualId,
              currentRevisionId: row.currentRevisionId!,
              currentCompiledArtifactId: row.currentCompiledArtifactId,
              version: row.version,
              // Another actor's intent cannot be claimed by this operation.
              pendingOperationIds: Object.freeze(
                intents.map((intent) => intent.operationId),
              ),
            });
          }
          return Object.freeze({
            exhausted: rows.length < 17,
            candidates: Object.freeze(candidates),
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      if (error instanceof RitualPublicationBackfillReadError) throw error;
      fail("UNAVAILABLE");
    }
  };
}

/** Fresh global-admin gate for the gap between backfill scans and publication work. */
export function createSqlRitualPublicationGlobalAdminChecker(
  database: SqlRitualPublicationBackfillDatabase,
  getVerifiedActorId: () => Promise<string | null>,
) {
  return async function authorize(
    expectedActorId: string,
    signal = new AbortController().signal,
  ): Promise<void> {
    if (!id(expectedActorId)) fail("INVALID_REQUEST");
    if (signal.aborted) fail("UNAVAILABLE");
    const actorId = await getVerifiedActorId();
    if (!id(actorId)) fail("AUTH_REQUIRED");
    if (actorId !== expectedActorId) fail("ACTOR_CHANGED");
    try {
      await database.transaction(
        async (tx) => {
          const principal = await loadSqlRitualPrincipal(tx, actorId);
          if (!principal) fail("AUTH_REQUIRED");
          if (!principal.globalAdmin) fail("FORBIDDEN");
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      if (error instanceof RitualPublicationBackfillReadError) throw error;
      fail("UNAVAILABLE");
    }
  };
}
