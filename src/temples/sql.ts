import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { resolveLegacyId } from "../db/legacyIds";
import { user } from "../db/schema/auth";
import {
  templeInvites,
  templeMemberships,
  temples,
} from "../db/schema/memberships";
import { userAccess, userProfile } from "../db/schema/userProfile";
import { createUuidV7, isUuidV7 } from "../lib/ids";

type SelectDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">;
type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "delete"
>;
export interface TempleDatabase extends SelectDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

type RouteEntity = "temples" | "templeMemberships";

/** Accepts canonical UUIDv7 routes or an exact, collection-scoped legacy alias. */
export async function resolveTempleRouteId(
  database: SelectDatabase,
  entityType: RouteEntity,
  routeId: string,
): Promise<string | null> {
  const value: unknown = routeId;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.includes("\0") ||
    !value.isWellFormed()
  )
    return null;
  const valueIsUuidV7: boolean = isUuidV7(value);
  if (valueIsUuidV7) return value === value.toLowerCase() ? value : null;
  const objectId = /^[0-9a-f]{24}$/i.test(value);
  return resolveLegacyId(database, {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: objectId ? "objectid" : "string",
    legacyIdValue: objectId ? value.toLowerCase() : value,
  });
}

async function loadIdentity(database: SelectDatabase, actorId: string) {
  if (!isUuidV7(actorId) || actorId !== actorId.toLowerCase()) return null;
  const [identity] = await database
    .select({ userId: user.id, globalAdmin: userAccess.admin })
    .from(user)
    .leftJoin(userAccess, eq(userAccess.userId, user.id))
    .where(eq(user.id, actorId));
  return identity
    ? { userId: identity.userId, globalAdmin: identity.globalAdmin === true }
    : null;
}

export interface TempleListItem {
  id: string;
  name: string;
  slug: string;
  membership: { id: string; grade: number; admin: boolean };
}

export interface TempleAdminListItem {
  id: string;
  name: string;
  slug: string;
}

export interface TempleAdminMember {
  membershipId: string;
  userId: string;
  displayName: string;
  grade: number;
  admin: boolean;
  motto: string | null;
  addedAt: Date;
  memberSince: Date | null;
}

export interface TempleAdminView extends TempleAdminListItem {
  joinPass: string | null;
  members: TempleAdminMember[];
}

export interface TempleMembershipAdminView {
  temple: TempleAdminListItem;
  membership: TempleAdminMember;
}

/** SQL projections for temple pages; privileged columns are selected only after access checks. */
export function createSqlTempleReader(database: TempleDatabase) {
  return {
    async getMyTemples(actorId: string | null): Promise<TempleListItem[]> {
      if (!actorId || !(await loadIdentity(database, actorId))) return [];
      const rows = await database
        .select({
          id: temples.id,
          name: temples.name,
          slug: temples.slug,
          membershipId: templeMemberships.id,
          grade: templeMemberships.grade,
          admin: templeMemberships.admin,
        })
        .from(templeMemberships)
        .innerJoin(temples, eq(temples.id, templeMemberships.templeId))
        .where(eq(templeMemberships.userId, actorId))
        .orderBy(asc(temples.name), asc(temples.id));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        membership: {
          id: row.membershipId,
          grade: row.grade,
          admin: row.admin,
        },
      }));
    },

    async getManageableTemples(actorId: string | null): Promise<{
      globalAdmin: boolean;
      temples: TempleAdminListItem[];
    }> {
      if (!actorId) return { globalAdmin: false, temples: [] };
      const identity = await loadIdentity(database, actorId);
      if (!identity) return { globalAdmin: false, temples: [] };
      const rows = identity.globalAdmin
        ? await database
            .select({ id: temples.id, name: temples.name, slug: temples.slug })
            .from(temples)
            .orderBy(asc(temples.name), asc(temples.id))
        : await database
            .select({ id: temples.id, name: temples.name, slug: temples.slug })
            .from(templeMemberships)
            .innerJoin(temples, eq(temples.id, templeMemberships.templeId))
            .where(
              and(
                eq(templeMemberships.userId, actorId),
                eq(templeMemberships.admin, true),
              ),
            )
            .orderBy(asc(temples.name), asc(temples.id));
      return { globalAdmin: identity.globalAdmin, temples: rows };
    },

    async getAdminTemple(
      actorId: string | null,
      routeId: string,
    ): Promise<TempleAdminView | null> {
      if (!actorId) return null;
      return database.transaction(async (tx) => {
        const templeId = await resolveTempleRouteId(tx, "temples", routeId);
        if (!templeId) return null;
        try {
          await lockActorAndAuthorize(tx, actorId, templeId);
        } catch (error) {
          if (error instanceof TempleFailure) return null;
          throw error;
        }
        const [temple] = await tx
          .select({
            id: temples.id,
            name: temples.name,
            slug: temples.slug,
            joinPass: templeInvites.joinPass,
          })
          .from(temples)
          .leftJoin(templeInvites, eq(templeInvites.templeId, temples.id))
          .where(eq(temples.id, templeId));
        if (!temple) return null;
        const members = await tx
          .select({
            membershipId: templeMemberships.id,
            userId: user.id,
            accountName: user.name,
            profileName: userProfile.displayName,
            grade: templeMemberships.grade,
            admin: templeMemberships.admin,
            motto: templeMemberships.motto,
            addedAt: templeMemberships.addedAt,
            memberSince: templeMemberships.memberSince,
          })
          .from(templeMemberships)
          .innerJoin(user, eq(user.id, templeMemberships.userId))
          .leftJoin(userProfile, eq(userProfile.userId, user.id))
          .where(eq(templeMemberships.templeId, templeId))
          .orderBy(desc(templeMemberships.addedAt), asc(templeMemberships.id));
        return {
          ...temple,
          joinPass: temple.joinPass ?? null,
          members: members.map(
            ({ accountName, profileName, ...membership }) => ({
              ...membership,
              displayName: profileName?.trim() || accountName,
            }),
          ),
        };
      });
    },

    async getAdminMembership(
      actorId: string | null,
      templeRouteId: string,
      membershipRouteId: string,
    ): Promise<TempleMembershipAdminView | null> {
      if (!actorId) return null;
      return database.transaction(async (tx) => {
        const templeId = await resolveTempleRouteId(
          tx,
          "temples",
          templeRouteId,
        );
        const membershipId = await resolveTempleRouteId(
          tx,
          "templeMemberships",
          membershipRouteId,
        );
        if (!templeId || !membershipId) return null;
        try {
          await lockActorAndAuthorize(tx, actorId, templeId);
        } catch (error) {
          if (error instanceof TempleFailure) return null;
          throw error;
        }
        const [row] = await tx
          .select({
            templeId: temples.id,
            templeName: temples.name,
            templeSlug: temples.slug,
            membershipId: templeMemberships.id,
            userId: user.id,
            accountName: user.name,
            profileName: userProfile.displayName,
            grade: templeMemberships.grade,
            admin: templeMemberships.admin,
            motto: templeMemberships.motto,
            addedAt: templeMemberships.addedAt,
            memberSince: templeMemberships.memberSince,
          })
          .from(templeMemberships)
          .innerJoin(temples, eq(temples.id, templeMemberships.templeId))
          .innerJoin(user, eq(user.id, templeMemberships.userId))
          .leftJoin(userProfile, eq(userProfile.userId, user.id))
          .where(
            and(
              eq(templeMemberships.id, membershipId),
              eq(templeMemberships.templeId, templeId),
            ),
          );
        if (!row) return null;
        return {
          temple: {
            id: row.templeId,
            name: row.templeName,
            slug: row.templeSlug,
          },
          membership: {
            membershipId: row.membershipId,
            userId: row.userId,
            displayName: row.profileName?.trim() || row.accountName,
            grade: row.grade,
            admin: row.admin,
            motto: row.motto,
            addedAt: row.addedAt,
            memberSince: row.memberSince,
          },
        };
      });
    },

    async getJoinPreview(
      actorId: string | null,
      slug: string,
      joinPass: string,
    ): Promise<{
      temple: TempleAdminListItem;
      alreadyMember: boolean;
    } | null> {
      if (
        !actorId ||
        !(await loadIdentity(database, actorId)) ||
        !validJoinCredential(slug, joinPass)
      )
        return null;
      const [temple] = await database
        .select({ id: temples.id, name: temples.name, slug: temples.slug })
        .from(temples)
        .innerJoin(templeInvites, eq(templeInvites.templeId, temples.id))
        .where(
          and(
            sql`lower(btrim(${temples.slug})) = lower(btrim(${slug}))`,
            eq(templeInvites.joinPass, joinPass),
          ),
        );
      if (!temple) return null;
      const [membership] = await database
        .select({ id: templeMemberships.id })
        .from(templeMemberships)
        .where(
          and(
            eq(templeMemberships.templeId, temple.id),
            eq(templeMemberships.userId, actorId),
          ),
        );
      return { temple, alreadyMember: Boolean(membership) };
    },
  };
}

type FailureCode =
  | "INVALID_REQUEST"
  | "NOT_AUTHENTICATED"
  | "ACCOUNT_CHANGED"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INVITE"
  | "LAST_ADMIN"
  | "UNAVAILABLE";
const failureMessages: Record<FailureCode, string> = {
  INVALID_REQUEST: "Check the submitted values and try again.",
  NOT_AUTHENTICATED: "Sign in and try again.",
  ACCOUNT_CHANGED: "Your signed-in account changed. Switch back and try again.",
  NOT_AUTHORIZED: "You do not have permission to manage this temple.",
  NOT_FOUND: "The temple or membership was not found.",
  INVALID_INVITE: "No temple matches that slug and join code.",
  LAST_ADMIN: "Assign another administrator before removing the last one.",
  UNAVAILABLE: "The temple service is temporarily unavailable. Try again.",
};
export type TempleWriteResult =
  | {
      ok: true;
      templeId: string;
      membershipId?: string;
      alreadyMember?: boolean;
    }
  | { ok: false; code: FailureCode; message: string };

class TempleFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}
function reject(code: FailureCode): never {
  throw new TempleFailure(code);
}
function ownKeys(row: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(row).length === expected.length &&
    expected.every((key) => Object.hasOwn(row, key))
  );
}
function canonical(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isUuidV7(value) &&
    value === value.toLowerCase()
  );
}
function validText(value: unknown, max: number, allowEmpty = false) {
  return (
    typeof value === "string" &&
    value.length <= max &&
    (allowEmpty || value.length > 0) &&
    !value.includes("\0") &&
    value.isWellFormed()
  );
}
function validJoinCredential(slug: unknown, joinPass: unknown) {
  return (
    validText(slug, 200) &&
    validText(joinPass, 200) &&
    !(slug as string).includes("/") &&
    !(joinPass as string).includes("/")
  );
}
function writeFailure(error: unknown): TempleWriteResult {
  const code = error instanceof TempleFailure ? error.code : "UNAVAILABLE";
  return { ok: false, code, message: failureMessages[code] };
}

async function verifiedActor(
  getVerifiedActorId: () => Promise<string | null>,
  expectedActorId: unknown,
) {
  if (!canonical(expectedActorId)) reject("INVALID_REQUEST");
  const current = await getVerifiedActorId();
  if (!canonical(current)) reject("NOT_AUTHENTICATED");
  if (current !== expectedActorId) reject("ACCOUNT_CHANGED");
  return current;
}

async function lockActorAndAuthorize(
  tx: Transaction,
  actorId: string,
  templeId: string,
) {
  const [identity] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, actorId))
    .for("key share");
  if (!identity) reject("NOT_AUTHENTICATED");
  const [access] = await tx
    .select({ admin: userAccess.admin })
    .from(userAccess)
    .where(eq(userAccess.userId, actorId))
    .for("share");
  if (access?.admin === true) return;
  const [membership] = await tx
    .select({ admin: templeMemberships.admin })
    .from(templeMemberships)
    .where(
      and(
        eq(templeMemberships.userId, actorId),
        eq(templeMemberships.templeId, templeId),
      ),
    )
    .for("share");
  if (membership?.admin !== true) reject("NOT_AUTHORIZED");
}

/** Transactional temple joins and administrator edits with fresh SQL authorization. */
export function createSqlTempleWriter(
  database: TempleDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { now?: () => Date; generateId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? createUuidV7;

  return {
    async join(input: unknown): Promise<TempleWriteResult> {
      try {
        if (!input || typeof input !== "object" || Array.isArray(input))
          reject("INVALID_REQUEST");
        const request = input as Record<string, unknown>;
        if (
          !ownKeys(request, [
            "version",
            "expectedActorId",
            "slug",
            "joinPass",
          ]) ||
          request.version !== 1 ||
          !validJoinCredential(request.slug, request.joinPass)
        )
          reject("INVALID_REQUEST");
        const actorId = await verifiedActor(
          getVerifiedActorId,
          request.expectedActorId,
        );
        return await database.transaction(async (tx) => {
          const [candidate] = await tx
            .select({ id: temples.id })
            .from(temples)
            .innerJoin(templeInvites, eq(templeInvites.templeId, temples.id))
            .where(
              and(
                sql`lower(btrim(${temples.slug})) = lower(btrim(${request.slug as string}))`,
                eq(templeInvites.joinPass, request.joinPass as string),
              ),
            );
          if (!candidate) reject("INVALID_INVITE");
          const [temple] = await tx
            .select({ id: temples.id })
            .from(temples)
            .where(eq(temples.id, candidate.id))
            .for("update");
          if (!temple) reject("INVALID_INVITE");
          const [invite] = await tx
            .select({ templeId: templeInvites.templeId })
            .from(templeInvites)
            .where(
              and(
                eq(templeInvites.templeId, temple.id),
                eq(templeInvites.joinPass, request.joinPass as string),
              ),
            );
          if (!invite) reject("INVALID_INVITE");
          const [identity] = await tx
            .select({ id: user.id })
            .from(user)
            .where(eq(user.id, actorId))
            .for("key share");
          if (!identity) reject("NOT_AUTHENTICATED");
          const [existing] = await tx
            .select({ id: templeMemberships.id })
            .from(templeMemberships)
            .where(
              and(
                eq(templeMemberships.templeId, temple.id),
                eq(templeMemberships.userId, actorId),
              ),
            );
          if (existing)
            return {
              ok: true as const,
              templeId: temple.id,
              membershipId: existing.id,
              alreadyMember: true,
            };
          const membershipId = generateId();
          const createdAt = now();
          if (
            !canonical(membershipId) ||
            !(createdAt instanceof Date) ||
            !Number.isFinite(createdAt.getTime())
          )
            reject("UNAVAILABLE");
          const [inserted] = await tx
            .insert(templeMemberships)
            .values({
              id: membershipId,
              templeId: temple.id,
              userId: actorId,
              grade: 0,
              admin: false,
              addedAt: createdAt,
              createdAt,
              updatedAt: createdAt,
            })
            .onConflictDoNothing({
              target: [templeMemberships.userId, templeMemberships.templeId],
            })
            .returning({ id: templeMemberships.id });
          if (inserted)
            return {
              ok: true as const,
              templeId: temple.id,
              membershipId: inserted.id,
              alreadyMember: false,
            };
          const [concurrent] = await tx
            .select({ id: templeMemberships.id })
            .from(templeMemberships)
            .where(
              and(
                eq(templeMemberships.templeId, temple.id),
                eq(templeMemberships.userId, actorId),
              ),
            );
          if (!concurrent) reject("UNAVAILABLE");
          return {
            ok: true as const,
            templeId: temple.id,
            membershipId: concurrent.id,
            alreadyMember: true,
          };
        });
      } catch (error) {
        return writeFailure(error);
      }
    },

    async updateInvite(input: unknown): Promise<TempleWriteResult> {
      try {
        if (!input || typeof input !== "object" || Array.isArray(input))
          reject("INVALID_REQUEST");
        const request = input as Record<string, unknown>;
        if (
          !ownKeys(request, [
            "version",
            "expectedActorId",
            "templeId",
            "joinPass",
          ]) ||
          request.version !== 1 ||
          !validText(request.templeId, 200) ||
          !validText(request.joinPass, 200, true) ||
          (request.joinPass as string).includes("/")
        )
          reject("INVALID_REQUEST");
        const actorId = await verifiedActor(
          getVerifiedActorId,
          request.expectedActorId,
        );
        return await database.transaction(async (tx) => {
          const templeId = await resolveTempleRouteId(
            tx,
            "temples",
            request.templeId as string,
          );
          if (!templeId) reject("NOT_FOUND");
          const [temple] = await tx
            .select({ id: temples.id })
            .from(temples)
            .where(eq(temples.id, templeId))
            .for("update");
          if (!temple) reject("NOT_FOUND");
          await lockActorAndAuthorize(tx, actorId, templeId);
          const joinPass = request.joinPass as string;
          if (joinPass.length === 0) {
            await tx
              .delete(templeInvites)
              .where(eq(templeInvites.templeId, templeId));
          } else {
            await tx
              .insert(templeInvites)
              .values({ templeId, joinPass })
              .onConflictDoUpdate({
                target: templeInvites.templeId,
                set: { joinPass },
              });
          }
          return { ok: true as const, templeId };
        });
      } catch (error) {
        return writeFailure(error);
      }
    },

    async updateMembership(input: unknown): Promise<TempleWriteResult> {
      try {
        if (!input || typeof input !== "object" || Array.isArray(input))
          reject("INVALID_REQUEST");
        const request = input as Record<string, unknown>;
        if (
          !ownKeys(request, [
            "version",
            "expectedActorId",
            "templeId",
            "membershipId",
            "grade",
            "admin",
            "motto",
            "memberSince",
          ]) ||
          request.version !== 1 ||
          !validText(request.templeId, 200) ||
          !validText(request.membershipId, 200) ||
          typeof request.grade !== "number" ||
          !Number.isInteger(request.grade) ||
          request.grade < 0 ||
          request.grade > 6 ||
          typeof request.admin !== "boolean" ||
          !validText(request.motto, 10_000, true) ||
          !(
            request.memberSince === null ||
            (typeof request.memberSince === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(request.memberSince))
          )
        )
          reject("INVALID_REQUEST");
        let memberSince: Date | null = null;
        if (typeof request.memberSince === "string") {
          memberSince = new Date(`${request.memberSince}T00:00:00.000Z`);
          if (
            !Number.isFinite(memberSince.getTime()) ||
            memberSince.toISOString().slice(0, 10) !== request.memberSince
          )
            reject("INVALID_REQUEST");
        }
        const actorId = await verifiedActor(
          getVerifiedActorId,
          request.expectedActorId,
        );
        return await database.transaction(async (tx) => {
          const templeId = await resolveTempleRouteId(
            tx,
            "temples",
            request.templeId as string,
          );
          const membershipId = await resolveTempleRouteId(
            tx,
            "templeMemberships",
            request.membershipId as string,
          );
          if (!templeId || !membershipId) reject("NOT_FOUND");
          const [temple] = await tx
            .select({ id: temples.id })
            .from(temples)
            .where(eq(temples.id, templeId))
            .for("update");
          if (!temple) reject("NOT_FOUND");
          await lockActorAndAuthorize(tx, actorId, templeId);
          const [target] = await tx
            .select({
              id: templeMemberships.id,
              admin: templeMemberships.admin,
            })
            .from(templeMemberships)
            .where(
              and(
                eq(templeMemberships.id, membershipId),
                eq(templeMemberships.templeId, templeId),
              ),
            )
            .for("update");
          if (!target) reject("NOT_FOUND");
          if (target.admin && request.admin === false) {
            const admins = await tx
              .select({ id: templeMemberships.id })
              .from(templeMemberships)
              .where(
                and(
                  eq(templeMemberships.templeId, templeId),
                  eq(templeMemberships.admin, true),
                ),
              )
              .orderBy(asc(templeMemberships.id))
              .for("update");
            if (admins.length <= 1) reject("LAST_ADMIN");
          }
          const updatedAt = now();
          if (
            !(updatedAt instanceof Date) ||
            !Number.isFinite(updatedAt.getTime())
          )
            reject("UNAVAILABLE");
          await tx
            .update(templeMemberships)
            .set({
              grade: request.grade as number,
              admin: request.admin as boolean,
              motto: request.motto === "" ? null : (request.motto as string),
              memberSince,
              updatedAt,
            })
            .where(
              and(
                eq(templeMemberships.id, membershipId),
                eq(templeMemberships.templeId, templeId),
              ),
            );
          return {
            ok: true as const,
            templeId,
            membershipId,
          };
        });
      } catch (error) {
        return writeFailure(error);
      }
    },
  };
}
