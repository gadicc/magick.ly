import { ObjectId } from "bson";
import { ObjectId as DriverObjectId } from "mongodb";
import type {
  RitualPolicy,
  RitualPrincipal,
  RitualRevisionIdentity,
  RitualScope,
} from "./access";

const objectIdHex = /^[0-9a-f]{24}$/i;

/**
 * Only call on explicitly known Mongo identity/reference fields. This bridges the
 * existing ObjectId-vs-string bug; it does not merge arbitrary typed alias keys or
 * stringify arbitrary objects. UUID-backed services pass their canonical IDs directly.
 */
export function legacyRitualId(value: unknown): string | null {
  // The ESM bson export and MongoDB's CJS bson export can differ by constructor.
  if (value instanceof ObjectId || value instanceof DriverObjectId)
    return value.toHexString();
  if (typeof value === "string" && objectIdHex.test(value))
    return value.toLowerCase();
  return null;
}

function grade(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Missing minGrade means zero. Irrelevant legacy minGrade on public/group records
 * is ignored for reads (the existing creator UI wrote it); new writes use strict
 * parseRitualScope. Present-but-invalid scope IDs and combined scopes fail closed.
 */
export function legacyRitualPolicy(
  row: Record<string, unknown>,
  options: { knownOrphanCreator?: boolean } = {},
): RitualPolicy | null {
  const id = legacyRitualId(row._id);
  const missingCreator = row.userId === undefined || row.userId === null;
  const normalizedCreator = missingCreator ? null : legacyRitualId(row.userId);
  if (!id || (!missingCreator && normalizedCreator === null)) return null;
  // Keep the original unresolved reference in migration provenance, not as an
  // invented user/creator grant. The caller must establish knownOrphanCreator.
  const creatorId = options.knownOrphanCreator ? null : normalizedCreator;
  const hasGroup = row.groupId !== undefined;
  const hasTemple = row.templeId !== undefined;
  if (hasGroup && hasTemple) return null;
  let scope: RitualScope;
  if (hasGroup) {
    const groupId = legacyRitualId(row.groupId);
    if (!groupId) return null;
    scope = { kind: "group", groupId };
  } else if (hasTemple) {
    const templeId = legacyRitualId(row.templeId);
    const minGrade = row.minGrade === undefined ? 0 : grade(row.minGrade);
    if (!templeId || minGrade === null) return null;
    scope = { kind: "temple", templeId, minGrade };
  } else {
    scope = { kind: "public" };
  }
  return { id, creatorId, scope };
}

function idList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(legacyRitualId).filter((id): id is string => id !== null)
    : [];
}

/** Joins only this authenticated user's freshly loaded memberships. */
export function legacyRitualPrincipal(
  authenticatedUserId: unknown,
  user: Record<string, unknown> | null,
  memberships: readonly Record<string, unknown>[],
): RitualPrincipal | null {
  const userId = legacyRitualId(authenticatedUserId);
  if (!user || !userId || legacyRitualId(user._id) !== userId) return null;
  return {
    userId,
    globalAdmin: user.admin === true,
    groupIds: idList(user.groupIds),
    groupAdminIds: idList(user.groupAdminIds),
    templeMemberships: memberships.flatMap((row) => {
      const templeId = legacyRitualId(row.templeId);
      if (!templeId || legacyRitualId(row.userId) !== userId) return [];
      return [{ templeId, grade: grade(row.grade), admin: row.admin === true }];
    }),
  };
}

/** Converts only the revision identity fields needed by parent/author guards. */
export function legacyRitualRevision(
  row: Record<string, unknown>,
): RitualRevisionIdentity | null {
  const id = legacyRitualId(row._id);
  const ritualId = legacyRitualId(row.docId);
  const authorId = legacyRitualId(row.userId);
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.getTime() : NaN;
  if (!id || !ritualId || !authorId || !Number.isFinite(createdAt)) return null;
  return { id, ritualId, authorId, createdAt };
}
