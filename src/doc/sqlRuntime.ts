import "server-only";

import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import { createSqlRitualReader } from "./sqlReads";
import { resolveRitualRouteId } from "./sqlRitualRoute";

/** Request-scoped authorization remains inside every repository call. */
export const sqlRitualReader = createSqlRitualReader(db, getCurrentSqlUserId);

/** Anonymous-only SQL projection; session state can never widen this reader. */
export const publicSqlRitualReader = createSqlRitualReader(
  db,
  async () => null,
);

export const resolveSqlRitualRouteId = (routeId: string) =>
  resolveRitualRouteId(db, routeId);
