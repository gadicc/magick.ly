import type { LegacyAliasKey } from "../db/legacyIds";
import type * as schema from "../db/schema/memberships";
import { isUuidV7 } from "../lib/ids";

/** Only the protected membership projection of users, after auth normalization. */
export interface LegacyGroupUser {
  source: LegacyAliasKey;
  groupIds?: unknown;
  groupAdminIds?: unknown;
}

/** Decoded BSON domain documents; no sessions, provider profiles or user emails. */
export interface LegacyMembershipInput {
  users: readonly LegacyGroupUser[];
  groups: readonly unknown[];
  temples: readonly unknown[];
  memberships: readonly unknown[];
}

/** Import ledger material, not a browser projection or log-safe response. */
export interface MembershipSourceEvidence {
  source: LegacyAliasKey;
  presentFields: string[];
  references: { field: string; source: LegacyAliasKey; canonicalId: string }[];
}

type Identified<T> = T & { id: string };
/** Pure insert plan; aliases must already be allocated and writes belong to the caller's transaction. */
export interface LegacyMembershipImportPlan {
  groups: Identified<typeof schema.userGroups.$inferInsert>[];
  grants: (typeof schema.userGroupGrants.$inferInsert)[];
  grantEvidence: (typeof schema.legacyUserGroupGrants.$inferInsert)[];
  temples: Identified<typeof schema.temples.$inferInsert>[];
  invites: (typeof schema.templeInvites.$inferInsert)[];
  memberships: Identified<typeof schema.templeMemberships.$inferInsert>[];
  aliases: { source: LegacyAliasKey; canonicalId: string }[];
  /** Persist alongside the protected source fingerprint in the eventual import ledger. */
  evidence: MembershipSourceEvidence[];
}

/** Errors disclose only input positions and categories, never invite codes or identity values. */
export class LegacyMembershipImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyMembershipImportError";
  }
}

type Row = Record<string, unknown>;
type Lookup = (source: LegacyAliasKey) => string | null;
const hex = /^[0-9a-f]{24}$/i;
const historyFields = ["createdAt", "updatedAt", "__updatedAt"];
function fail(code: string, path: string): never {
  throw new LegacyMembershipImportError(code, path);
}
function row(value: unknown, path: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid-object", path);
  return value as Row;
}
function fields(value: Row, allowed: readonly string[], path: string) {
  // Unknown field names can also be private: report only the containing position.
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("unclassified-fields", path);
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail("invalid-text", path);
  return value;
}
function normalizedSlug(value: string): string {
  // Match PostgreSQL btrim(text): only ASCII spaces at the actual string ends.
  let start = 0;
  let end = value.length;
  while (value[start] === " ") start++;
  while (end > start && value[end - 1] === " ") end--;
  return value.slice(start, end).toLowerCase();
}
function date(value: unknown, path: string): Date | null {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    fail("invalid-date", path);
  return new Date(value.getTime());
}
function history(value: Row, path: string) {
  const sync = value.__updatedAt;
  if (
    sync !== undefined &&
    (typeof sync !== "number" || !Number.isSafeInteger(sync) || sync < 0)
  ) {
    fail("invalid-sync-timestamp", `${path}.__updatedAt`);
  }
  return {
    createdAt: date(value.createdAt, `${path}.createdAt`),
    updatedAt: date(value.updatedAt, `${path}.updatedAt`),
    legacySyncUpdatedAtMilliseconds:
      sync === undefined ? null : (sync as number),
  };
}
function reference(
  entityType: string,
  value: unknown,
  path: string,
): LegacyAliasKey {
  if (typeof value === "string") {
    if (!value) fail("invalid-source-id", path);
    return {
      sourceSystem: "mongodb",
      entityType,
      legacyIdType: "string",
      legacyIdValue: value,
    };
  }
  const id = row(value, path);
  if (id._bsontype !== "ObjectId" || typeof id.toHexString !== "function")
    fail("invalid-source-id", path);
  const valueHex: unknown = id.toHexString();
  if (typeof valueHex !== "string" || !hex.test(valueHex))
    fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: "objectid",
    legacyIdValue: valueHex.toLowerCase(),
  };
}
function sourceKey(source: LegacyAliasKey) {
  return JSON.stringify([
    source.sourceSystem,
    source.entityType,
    source.legacyIdType,
    source.legacyIdValue,
  ]);
}
function validateUserSource(source: LegacyAliasKey, path: string) {
  if (
    !source ||
    source.sourceSystem !== "mongodb" ||
    source.entityType !== "users" ||
    !["objectid", "string"].includes(source.legacyIdType) ||
    typeof source.legacyIdValue !== "string" ||
    !source.legacyIdValue ||
    (source.legacyIdType === "objectid" &&
      !/^[0-9a-f]{24}$/.test(source.legacyIdValue))
  ) {
    fail("invalid-user-source", path);
  }
}

/**
 * Preserves source grants independently. Only users.groupIds/groupAdminIds may
 * reconcile serialized ObjectIds; all other references require exact durable aliases.
 * No clock, ID generation, mutation, database or external service calls occur here.
 */
export function planLegacyMembershipImport(
  input: LegacyMembershipInput,
  options: {
    lookup: Lookup;
    /** Complete canonical user set from the reviewed auth import, including users with no grants. */
    canonicalUserIds: readonly string[];
    importedAt: Date;
  },
): LegacyMembershipImportPlan {
  const importedAt = date(options.importedAt, "options.importedAt");
  if (!importedAt) fail("missing-import-time", "options.importedAt");
  if (options.canonicalUserIds.some((id) => !isUuidV7(id))) {
    fail("invalid-user-set", "options.canonicalUserIds");
  }
  const users = new Set(options.canonicalUserIds.map((id) => id.toLowerCase()));
  if (users.size !== options.canonicalUserIds.length)
    fail("invalid-user-set", "options.canonicalUserIds");
  const occupied = new Set(users);
  const aliases = new Map<
    string,
    { source: LegacyAliasKey; canonicalId: string }
  >();
  const evidence: MembershipSourceEvidence[] = [];
  function canonical(source: LegacyAliasKey, path: string) {
    const id = options.lookup(source);
    if (!id || !isUuidV7(id)) fail("missing-canonical-alias", path);
    return id.toLowerCase();
  }
  function alias(source: LegacyAliasKey, canonicalId: string, path: string) {
    const key = sourceKey(source);
    const existing = options.lookup(source) ?? aliases.get(key)?.canonicalId;
    if (
      existing !== undefined &&
      existing !== null &&
      (!isUuidV7(existing) || existing.toLowerCase() !== canonicalId)
    ) {
      fail("alias-conflict", path);
    }
    aliases.set(key, { source: { ...source }, canonicalId });
  }
  function identities(
    values: readonly unknown[],
    entityType: string,
    path: string,
  ) {
    const bySource = new Map<string, string>();
    const entries = values.map((value, i) => {
      const location = `${path}[${i}]`;
      const document = row(value, location);
      const source = reference(entityType, document._id, `${location}._id`);
      const id = canonical(source, `${location}._id`);
      if (occupied.has(id) || bySource.has(sourceKey(source)))
        fail("duplicate-canonical-identity", location);
      occupied.add(id);
      bySource.set(sourceKey(source), id);
      alias(source, id, location);
      const item: MembershipSourceEvidence = {
        source,
        presentFields: Object.keys(document).sort(),
        references: [],
      };
      evidence.push(item);
      return { document, source, id, location, evidence: item };
    });
    return { entries, bySource };
  }
  const groups = identities(input.groups, "userGroups", "groups");
  const temples = identities(input.temples, "temples", "temples");
  const memberships = identities(
    input.memberships,
    "templeMemberships",
    "memberships",
  );
  const plan: LegacyMembershipImportPlan = {
    groups: [],
    grants: [],
    grantEvidence: [],
    temples: [],
    invites: [],
    memberships: [],
    aliases: [],
    evidence,
  };

  for (const { document, id, location } of groups.entries) {
    fields(document, ["_id", "name", ...historyFields], location);
    plan.groups.push({
      id,
      name: text(document.name, `${location}.name`),
      ...history(document, location),
    });
  }
  function userReference(value: unknown, path: string) {
    const source = reference("users", value, path);
    const id = canonical(source, path);
    if (!users.has(id)) fail("unresolved-user", path);
    return { source, canonicalId: id };
  }
  const normalizedSlugs = new Set<string>();
  for (const { document, id, location, evidence } of temples.entries) {
    fields(
      document,
      ["_id", "name", "slug", "joinPass", "createdBy", ...historyFields],
      location,
    );
    const slug = text(document.slug, `${location}.slug`);
    const normalized = normalizedSlug(slug);
    if (!normalized) fail("empty-slug", `${location}.slug`);
    if (normalizedSlugs.has(normalized))
      fail("duplicate-normalized-slug", `${location}.slug`);
    normalizedSlugs.add(normalized);
    let createdById: string | null = null;
    if (document.createdBy !== undefined && document.createdBy !== null) {
      const ref = userReference(document.createdBy, `${location}.createdBy`);
      createdById = ref.canonicalId;
      evidence.references.push({ field: "createdBy", ...ref });
    }
    plan.temples.push({
      id,
      name: text(document.name, `${location}.name`),
      slug,
      createdById,
      ...history(document, location),
    });
    if (document.joinPass !== undefined) {
      plan.invites.push({
        templeId: id,
        joinPass: text(document.joinPass, `${location}.joinPass`),
      });
    }
  }

  const seenUsers = new Set<string>();
  for (const [i, value] of input.users.entries()) {
    const location = `users[${i}]`;
    fields(
      row(value, location),
      ["source", "groupIds", "groupAdminIds"],
      location,
    );
    validateUserSource(value.source, `${location}.source`);
    const userId = canonical(value.source, `${location}.source`);
    if (!users.has(userId) || seenUsers.has(userId))
      fail("unknown-or-duplicate-user", location);
    seenUsers.add(userId);
    const grants = new Map<
      string,
      { userId: string; groupId: string; member: boolean; admin: boolean }
    >();
    function references(field: "groupIds" | "groupAdminIds") {
      const values = value[field];
      if (values === undefined) return [];
      if (!Array.isArray(values)) fail("invalid-array", `${location}.${field}`);
      return values.map((entry, index) => {
        const path = `${location}.${field}[${index}]`;
        const source = reference("userGroups", entry, path);
        const exact = groups.bySource.get(sourceKey(source));
        const objectSource: LegacyAliasKey = {
          ...source,
          legacyIdType: "objectid",
          legacyIdValue: source.legacyIdValue.toLowerCase(),
        };
        const objectTarget =
          source.legacyIdType === "string" && hex.test(source.legacyIdValue)
            ? groups.bySource.get(sourceKey(objectSource))
            : undefined;
        if (exact && objectTarget && exact !== objectTarget)
          fail("ambiguous-group-reference", path);
        const groupId = exact ?? objectTarget;
        if (!groupId) fail("unresolved-group", path);
        alias(source, groupId, path);
        const grant = grants.get(groupId) ?? {
          userId,
          groupId,
          member: false,
          admin: false,
        };
        grant[field === "groupIds" ? "member" : "admin"] = true;
        grants.set(groupId, grant);
        return source;
      });
    }
    const groupReferences = references("groupIds");
    const groupAdminReferences = references("groupAdminIds");
    plan.grants.push(...grants.values());
    plan.grantEvidence.push({
      userId,
      groupIdsPresent: Object.hasOwn(value, "groupIds"),
      groupAdminIdsPresent: Object.hasOwn(value, "groupAdminIds"),
      groupReferences,
      groupAdminReferences,
      importedAt: new Date(importedAt.getTime()),
    });
  }
  if (seenUsers.size !== users.size)
    fail("missing-user-grant-projection", "users");

  const membershipPairs = new Set<string>();
  for (const { document, id, location, evidence } of memberships.entries) {
    fields(
      document,
      [
        "_id",
        "userId",
        "templeId",
        "grade",
        "admin",
        "motto",
        "addedAt",
        "memberSince",
        ...historyFields,
      ],
      location,
    );
    const owner = userReference(document.userId, `${location}.userId`);
    const templeSource = reference(
      "temples",
      document.templeId,
      `${location}.templeId`,
    );
    const templeId = temples.bySource.get(sourceKey(templeSource));
    if (!templeId) fail("unresolved-temple", `${location}.templeId`);
    if (canonical(templeSource, `${location}.templeId`) !== templeId)
      fail("alias-conflict", `${location}.templeId`);
    evidence.references.push(
      { field: "userId", ...owner },
      { field: "templeId", source: templeSource, canonicalId: templeId },
    );
    const pair = JSON.stringify([owner.canonicalId, templeId]);
    if (membershipPairs.has(pair))
      fail("duplicate-temple-membership", location);
    membershipPairs.add(pair);
    const grade = document.grade;
    if (
      typeof grade !== "number" ||
      !Number.isInteger(grade) ||
      grade < 0 ||
      grade > 2_147_483_647
    )
      fail("invalid-grade", `${location}.grade`);
    if (document.admin !== undefined && typeof document.admin !== "boolean")
      fail("invalid-admin", `${location}.admin`);
    const addedAt = date(document.addedAt, `${location}.addedAt`);
    if (!addedAt) fail("missing-added-at", `${location}.addedAt`);
    plan.memberships.push({
      id,
      userId: owner.canonicalId,
      templeId,
      grade,
      admin: document.admin === true,
      motto:
        document.motto === undefined
          ? null
          : text(document.motto, `${location}.motto`),
      addedAt,
      memberSince: date(document.memberSince, `${location}.memberSince`),
      ...history(document, location),
    });
  }
  plan.aliases = [...aliases.values()];
  return plan;
}
