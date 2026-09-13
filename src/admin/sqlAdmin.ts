import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import { userGroupGrants, userGroups } from "../db/schema/memberships";
import { userAccess, userProfile } from "../db/schema/userProfile";
import { isUuidV7 } from "../lib/ids";

type Reader = Pick<PgDatabase<PgQueryResultHKT>, "select">;
type Transaction = Reader &
  Pick<PgDatabase<PgQueryResultHKT>, "insert" | "update" | "delete">;
interface Database extends Reader {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
const canonical = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

/** Public failure codes contain no personal data, SQL text or provider errors. */
export class SqlAdminError extends Error {
  constructor(
    readonly code: "NOT_AUTHENTICATED" | "FORBIDDEN" | "INVALID" | "CHANGED",
  ) {
    super(code);
  }
}

/** Membership and administrator grants are independent; removing one keeps the other. */
export type GroupGrantOperation =
  | "add-member"
  | "remove-member"
  | "add-admin"
  | "remove-admin";

/** The browser supplies only a stale-account precondition, never its authority. */
export interface GroupGrantRequest {
  expectedActorId: string;
  groupId: string;
  userIds: string[];
  operation: GroupGrantOperation;
}

/** SQL-backed global user/group administration; private auth/provenance rows stay server-side. */
export function createSqlAdminService(
  db: Database,
  getActorId: () => Promise<string | null>,
) {
  async function authorize(reader: Reader, expected?: string, lock = false) {
    const actorId = await getActorId();
    if (!canonical(actorId)) throw new SqlAdminError("NOT_AUTHENTICATED");
    if (expected !== undefined && actorId !== expected)
      throw new SqlAdminError("CHANGED");
    const query = reader
      .select({ admin: userAccess.admin })
      .from(userAccess)
      .innerJoin(user, eq(user.id, userAccess.userId))
      .where(eq(userAccess.userId, actorId));
    const [access] = lock ? await query.for("share") : await query;
    if (access?.admin !== true) throw new SqlAdminError("FORBIDDEN");
    return actorId;
  }

  return {
    async read() {
      const actorId = await authorize(db);
      const [users, groups, grants] = await Promise.all([
        db
          .select({
            id: user.id,
            name: user.name,
            displayName: userProfile.displayName,
            email: user.email,
          })
          .from(user)
          .leftJoin(userProfile, eq(userProfile.userId, user.id))
          .orderBy(asc(user.name), asc(user.id)),
        db.select().from(userGroups).orderBy(asc(userGroups.name)),
        db
          .select({
            userId: userGroupGrants.userId,
            groupId: userGroupGrants.groupId,
            member: userGroupGrants.member,
            admin: userGroupGrants.admin,
          })
          .from(userGroupGrants),
      ]);
      await authorize(db, actorId);
      return {
        actorId,
        users,
        groups: groups.map(({ id, name }) => ({ id, name })),
        grants,
      };
    },

    /** The supplied UUID makes a repeated form submission create the same group. */
    async createGroup(input: {
      expectedActorId: string;
      id: string;
      name: string;
    }) {
      if (
        !canonical(input.expectedActorId) ||
        !canonical(input.id) ||
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.trim().length > 200
      )
        throw new SqlAdminError("INVALID");
      const name = input.name.trim();
      await db.transaction(async (tx) => {
        await authorize(tx, input.expectedActorId, true);
        await tx
          .insert(userGroups)
          .values({ id: input.id, name, createdAt: new Date() })
          .onConflictDoNothing({ target: userGroups.id });
        const [existing] = await tx
          .select({ name: userGroups.name })
          .from(userGroups)
          .where(eq(userGroups.id, input.id));
        if (existing?.name !== name) throw new SqlAdminError("CHANGED");
      });
    },

    async setGrants(input: GroupGrantRequest) {
      if (
        !canonical(input.expectedActorId) ||
        !canonical(input.groupId) ||
        !Array.isArray(input.userIds) ||
        input.userIds.length < 1 ||
        input.userIds.length > 500 ||
        !input.userIds.every(canonical) ||
        !["add-member", "remove-member", "add-admin", "remove-admin"].includes(
          input.operation,
        )
      )
        throw new SqlAdminError("INVALID");
      const userIds = [...new Set(input.userIds)].sort();
      const field = input.operation.endsWith("member") ? "member" : "admin";
      const enabled = input.operation.startsWith("add-");
      await db.transaction(async (tx) => {
        await authorize(tx, input.expectedActorId, true);
        // Serialize edits to one group's edges, including currently absent rows.
        const [group] = await tx
          .select({ id: userGroups.id })
          .from(userGroups)
          .where(eq(userGroups.id, input.groupId))
          .for("update");
        if (!group) throw new SqlAdminError("INVALID");
        const targets = await tx
          .select({ id: user.id })
          .from(user)
          .where(inArray(user.id, userIds))
          .orderBy(asc(user.id))
          .for("key share");
        if (targets.length !== userIds.length)
          throw new SqlAdminError("INVALID");
        for (const userId of userIds) {
          const where = and(
            eq(userGroupGrants.groupId, input.groupId),
            eq(userGroupGrants.userId, userId),
          );
          if (enabled) {
            await tx
              .insert(userGroupGrants)
              .values({ userId, groupId: input.groupId, [field]: true })
              .onConflictDoUpdate({
                target: [userGroupGrants.userId, userGroupGrants.groupId],
                set: { [field]: true },
              });
          } else {
            const [grant] = await tx
              .select()
              .from(userGroupGrants)
              .where(where);
            if (!grant) continue;
            const other = field === "member" ? "admin" : "member";
            if (!grant[other]) await tx.delete(userGroupGrants).where(where);
            else
              await tx
                .update(userGroupGrants)
                .set({ [field]: false })
                .where(where);
          }
        }
      });
    },
  };
}
