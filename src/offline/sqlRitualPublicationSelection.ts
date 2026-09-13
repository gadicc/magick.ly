import "server-only";

import { eq, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { rituals } from "../db/schema/rituals";
import { getRitualAccess } from "../doc/access";
import {
  loadSqlRitualPrincipal,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "../doc/sqlPolicy";
import { selectSqlRenderedRitual } from "../doc/sqlRendered";
import { isUuidV7 } from "../lib/ids";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
export interface SqlRitualPublicationSelectionDatabase {
  transaction<T>(
    work: (tx: ReadDatabase) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

export interface RitualPublicationSelectionRequest {
  expectedActorId: string;
  ritualId: string;
  expectedRevisionId: string;
  expectedVersion: number;
}

export interface RitualPublicationSelection {
  ritualId: string;
  title: string;
  contentJson: string;
  currentRevisionId: string;
  currentCompiledArtifactId: string | null;
  version: number;
  descriptor: ReturnType<typeof createRitualRenderDescriptor>;
}

export class SqlRitualPublicationSelectionError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "AUTH_REQUIRED"
      | "ACTOR_CHANGED"
      | "FORBIDDEN"
      | "STALE"
      | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "SqlRitualPublicationSelectionError";
  }
}

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const version = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);
function fail(code: SqlRitualPublicationSelectionError["code"]): never {
  throw new SqlRitualPublicationSelectionError(code);
}
// JSON decoding preserves opaque leading BOMs in PGlite's text path too.
const selectionFields = {
  ...sqlRitualParentFields,
  title: sql<string>`to_json(${rituals.title})`,
};

/**
 * Loads one exact current rendered selection for a current editor. Every call
 * independently verifies the session and persisted grants, so callers can place
 * it directly before each provider mutation without holding a SQL transaction.
 */
export function createSqlRitualPublicationSelectionReader(
  database: SqlRitualPublicationSelectionDatabase,
  getVerifiedActorId: () => Promise<string | null>,
) {
  return async function load(
    input: RitualPublicationSelectionRequest,
    signal = new AbortController().signal,
  ): Promise<RitualPublicationSelection> {
    const request = structuredClone(input);
    if (
      !request ||
      !id(request.expectedActorId) ||
      !id(request.ritualId) ||
      !id(request.expectedRevisionId) ||
      !version(request.expectedVersion)
    )
      fail("INVALID_REQUEST");
    if (signal.aborted) fail("UNAVAILABLE");
    const actorId = await getVerifiedActorId();
    if (signal.aborted) fail("UNAVAILABLE");
    if (!id(actorId)) fail("AUTH_REQUIRED");
    if (actorId !== request.expectedActorId) fail("ACTOR_CHANGED");
    try {
      return await database.transaction(
        async (tx) => {
          const principal = await loadSqlRitualPrincipal(tx, actorId);
          if (signal.aborted) fail("UNAVAILABLE");
          if (!principal) fail("AUTH_REQUIRED");
          const rows = await tx
            .select(selectionFields)
            .from(rituals)
            .where(eq(rituals.id, request.ritualId))
            .limit(2);
          if (rows.length !== 1 || !rows[0].currentRevisionId)
            fail("UNAVAILABLE");
          const parent = rows[0];
          const currentRevisionId = parent.currentRevisionId;
          if (!currentRevisionId) fail("UNAVAILABLE");
          if (!getRitualAccess(sqlRitualPolicy(parent), principal).edit)
            fail("FORBIDDEN");
          if (
            parent.currentRevisionId !== request.expectedRevisionId ||
            parent.version !== request.expectedVersion
          )
            fail("STALE");
          const selected = await selectSqlRenderedRitual(tx, parent);
          if (signal.aborted) fail("UNAVAILABLE");
          if (!selected) fail("UNAVAILABLE");
          return Object.freeze({
            ritualId: parent.id,
            title: parent.title,
            contentJson: selected.contentJson,
            currentRevisionId,
            currentCompiledArtifactId: parent.currentCompiledArtifactId,
            version: parent.version,
            descriptor: createRitualRenderDescriptor(parent, selected),
          });
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      if (error instanceof SqlRitualPublicationSelectionError) throw error;
      fail("UNAVAILABLE");
    }
  };
}
