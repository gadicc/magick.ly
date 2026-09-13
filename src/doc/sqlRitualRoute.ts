import "server-only";

import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { legacyIdAliases } from "../db/schema/legacyIds";
import { parseRitualRouteIdentity } from "./ritualRouteIdentity";

type SelectDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
interface RouteDatabase {
  transaction<T>(work: (transaction: SelectDatabase) => Promise<T>): Promise<T>;
}

/** Resolve only the exact Mongo docs/ObjectId namespace retained for old links. */
export async function resolveRitualRouteId(
  database: RouteDatabase,
  routeId: string,
): Promise<string | null> {
  const identity = parseRitualRouteIdentity(routeId);
  if (!identity) return null;
  if (identity.kind === "canonical") return identity.ritualId;
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ canonicalId: legacyIdAliases.canonicalId })
      .from(legacyIdAliases)
      .where(
        and(
          eq(legacyIdAliases.sourceSystem, "mongodb"),
          eq(legacyIdAliases.entityType, "docs"),
          eq(legacyIdAliases.legacyIdType, "objectid"),
          eq(legacyIdAliases.legacyIdValue, identity.legacyId),
        ),
      )
      .limit(1);
    return row?.canonicalId ?? null;
  });
}
