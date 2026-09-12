import "server-only";
import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import { templeMemberships, userGroupGrants } from "../db/schema/memberships";
import { rituals } from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import { isUuidV7 } from "../lib/ids";
import type { RitualPolicy, RitualPrincipal } from "./access";

/** Shared persisted policy projection; source, invitations and import evidence stay excluded. */
export type SqlRitualSelectDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select"
>;
export const sqlRitualParentFields = {
  id: rituals.id,
  title: rituals.title,
  creatorId: rituals.creatorId,
  scope: rituals.scope,
  groupId: rituals.groupId,
  templeId: rituals.templeId,
  minGrade: rituals.minGrade,
  currentRevisionId: rituals.currentRevisionId,
  version: rituals.version,
  currentCompiledArtifactId: rituals.currentCompiledArtifactId,
  createdAt: rituals.createdAt,
  updatedAt: rituals.updatedAt,
};
export type SqlRitualParentRow = Pick<
  typeof rituals.$inferSelect,
  keyof typeof sqlRitualParentFields
>;

/** Reconstructs the shared policy without treating malformed mixed scope columns as public. */
export function sqlRitualPolicy(row: SqlRitualParentRow): RitualPolicy | null {
  const base = { id: row.id, creatorId: row.creatorId };
  if (
    row.scope === "public" &&
    row.groupId === null &&
    row.templeId === null &&
    row.minGrade === null
  )
    return { ...base, scope: { kind: "public" } };
  if (
    row.scope === "group" &&
    row.groupId !== null &&
    row.templeId === null &&
    row.minGrade === null
  )
    return { ...base, scope: { kind: "group", groupId: row.groupId } };
  if (
    row.scope === "temple" &&
    row.groupId === null &&
    row.templeId !== null &&
    row.minGrade !== null
  )
    return {
      ...base,
      scope: { kind: "temple", templeId: row.templeId, minGrade: row.minGrade },
    };
  return null;
}

/**
 * Reloads the same grants for reads and writes. Inside a write transaction, share
 * locks hold observed grants until commit, so concurrent revocation waits or is
 * observed before authorization. Missing grants confer no permission. Identity
 * key-share blocks deletion; profile fields never supply authorization.
 */
export async function loadSqlRitualPrincipal(
  tx: SqlRitualSelectDatabase,
  verifiedActorId: string | null,
  lockPermissions = false,
): Promise<RitualPrincipal | null> {
  const userId = isUuidV7(verifiedActorId)
    ? verifiedActorId.toLowerCase()
    : null;
  if (!userId) return null;
  let identity: { userId: string; admin: boolean | null } | undefined;
  if (lockPermissions) {
    const [record] = await tx
      .select({ userId: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("key share");
    if (!record) return null;
    const [access] = await tx
      .select({ admin: userAccess.admin })
      .from(userAccess)
      .where(eq(userAccess.userId, userId))
      .for("share");
    identity = { userId: record.userId, admin: access?.admin ?? null };
  } else {
    [identity] = await tx
      .select({ userId: user.id, admin: userAccess.admin })
      .from(user)
      .leftJoin(userAccess, eq(userAccess.userId, user.id))
      .where(eq(user.id, userId));
  }
  if (!identity) return null;
  const groupQuery = tx
    .select({
      groupId: userGroupGrants.groupId,
      member: userGroupGrants.member,
      admin: userGroupGrants.admin,
    })
    .from(userGroupGrants)
    .where(eq(userGroupGrants.userId, userId))
    .orderBy(asc(userGroupGrants.groupId));
  const groups = lockPermissions
    ? await groupQuery.for("share")
    : await groupQuery;
  const templeQuery = tx
    .select({
      templeId: templeMemberships.templeId,
      grade: templeMemberships.grade,
      admin: templeMemberships.admin,
    })
    .from(templeMemberships)
    .where(eq(templeMemberships.userId, userId))
    .orderBy(asc(templeMemberships.templeId));
  const temples = lockPermissions
    ? await templeQuery.for("share")
    : await templeQuery;
  return {
    userId: identity.userId,
    globalAdmin: identity.admin === true,
    groupIds: groups
      .filter((grant) => grant.member)
      .map((grant) => grant.groupId),
    groupAdminIds: groups
      .filter((grant) => grant.admin)
      .map((grant) => grant.groupId),
    templeMemberships: temples,
  };
}
