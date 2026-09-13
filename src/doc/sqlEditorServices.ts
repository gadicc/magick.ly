import "server-only";

import { asc } from "drizzle-orm";
import { temples, userGroups } from "../db/schema/memberships";
import { parseRitualPermissionRequest } from "../offline/permissionContract";
import { createSqlRitualPermissionChecker } from "../offline/sqlPermissionCheck";
import type {
  SqlRitualCreationOptionsV1,
  SqlRitualSourceDeliveryV1,
} from "./sqlEditorContract";
import { loadSqlRitualPrincipal } from "./sqlPolicy";
import type { SqlRitualReadDatabase } from "./sqlReads";
import { createSqlRitualReader } from "./sqlReads";

type SourcePermission = ReturnType<typeof createSqlRitualPermissionChecker>;
type CurrentSource = ReturnType<
  ReturnType<typeof createSqlRitualReader>["getCurrentSource"]
>;

/** Compose the two permission snapshots around the source read for focused race testing. */
export function createSqlRitualSourceDeliveryFromServices(
  permission: SourcePermission,
  getCurrentSource: (ritualId: string) => CurrentSource,
) {
  return async (input: unknown): Promise<SqlRitualSourceDeliveryV1 | null> => {
    const request = parseRitualPermissionRequest(input);
    if (!request) return null;
    const first = await permission(request);
    if (!first) return null;
    let latest = first;
    let source: SqlRitualSourceDeliveryV1["source"] = null;
    if (first.kind === "granted" && first.grant.sourceEdit && first.editor) {
      const selected = await getCurrentSource(request.ritualId);
      latest = (await permission(request)) ?? {
        version: 1,
        requestId: request.requestId,
        ownerId: request.expectedActorId,
        ritualId: request.ritualId,
        kind: "temporarily-unavailable",
      };
      if (
        selected &&
        latest.kind === "granted" &&
        latest.grant.sourceEdit &&
        latest.editor?.currentRevisionId === selected.currentRevisionId &&
        latest.editor.parentVersion === selected.version &&
        selected.revision.id === selected.currentRevisionId
      )
        source = {
          title: selected.ritual.title,
          revisionId: selected.currentRevisionId,
          parentVersion: selected.version,
          source: selected.revision.source,
        };
    }
    return {
      version: 1,
      requestId: request.requestId,
      ownerId: request.expectedActorId,
      ritualId: request.ritualId,
      permission: latest,
      source,
    };
  };
}

/**
 * Deliver source only when the post-read permission snapshot still names the same
 * current revision/version. The returned lease is always the final recheck.
 */
export function createSqlRitualSourceDelivery(
  database: SqlRitualReadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
) {
  const permission = createSqlRitualPermissionChecker(
    database,
    getVerifiedActorId,
  );
  const reader = createSqlRitualReader(database, getVerifiedActorId);
  return createSqlRitualSourceDeliveryFromServices(permission, (ritualId) =>
    reader.getCurrentSource(ritualId),
  );
}

/** Names are labels only; the SQL writer independently rechecks scope authority. */
export function createSqlRitualCreationOptionsReader(
  database: SqlRitualReadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
) {
  return async (): Promise<SqlRitualCreationOptionsV1 | null> => {
    const actorId = await getVerifiedActorId();
    if (!actorId) return null;
    return database.transaction(
      async (transaction) => {
        const principal = await loadSqlRitualPrincipal(transaction, actorId);
        if (!principal) return null;
        const groupRows = await transaction
          .select({ id: userGroups.id, name: userGroups.name })
          .from(userGroups)
          .orderBy(asc(userGroups.name), asc(userGroups.id));
        const templeRows = await transaction
          .select({ id: temples.id, name: temples.name })
          .from(temples)
          .orderBy(asc(temples.name), asc(temples.id));
        const groups = principal.globalAdmin
          ? groupRows
          : groupRows.filter((row) => principal.groupAdminIds.includes(row.id));
        const templeAdminIds = new Set(
          principal.templeMemberships
            .filter((membership) => membership.admin)
            .map((membership) => membership.templeId),
        );
        const allowedTemples = principal.globalAdmin
          ? templeRows
          : templeRows.filter((row) => templeAdminIds.has(row.id));
        return {
          version: 1,
          ownerId: principal.userId,
          public: principal.globalAdmin,
          groups,
          temples: allowedTemples,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  };
}
