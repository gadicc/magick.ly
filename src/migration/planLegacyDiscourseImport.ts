import type { LegacyAliasKey } from "../db/legacyIds";
import type { discourseUserLinks } from "../db/schema/discourse";
import { isUuidV7 } from "../lib/ids";

/** A deliberate application-field projection from each normalized legacy user. */
export interface LegacyDiscourseUser {
  source: LegacyAliasKey;
  discourseId?: unknown;
}

/** Pure insert plan and protected, value-minimal source disposition for the import ledger. */
export interface LegacyDiscourseImportPlan {
  sourceForumOrigin: string;
  links: (typeof discourseUserLinks.$inferInsert & { createdAt: Date })[];
  dispositions: {
    source: LegacyAliasKey;
    userId: string;
    disposition: "linked" | "missing" | "null";
  }[];
  counts: { users: number; linked: number; missing: number; null: number };
}

/** Aliases and the complete user set come from the reviewed auth import, never an email lookup. */
export interface LegacyDiscourseImportOptions {
  lookup: (source: LegacyAliasKey) => string | null;
  canonicalUserIds: readonly string[];
  /** Canonical HTTPS origin from the source system's reviewed configuration, not runtime env. */
  sourceForumOrigin: string;
  /** Local import bookkeeping only; no historical link timestamp is inferred. */
  importedAt: Date;
}

/** Safe categories and input positions only; no source identifiers or provider values in messages. */
export class LegacyDiscourseImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyDiscourseImportError";
  }
}

function fail(code: string, path: string): never {
  throw new LegacyDiscourseImportError(code, path);
}
function record(value: unknown, fields: readonly string[], path: string) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail("invalid-object", path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.entries(descriptors).some(
      ([key, descriptor]) =>
        !fields.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor),
    )
  )
    fail("unclassified-properties", path);
  return value as Record<string, unknown>;
}
function userSource(value: unknown, path: string): LegacyAliasKey {
  const source = record(
    value,
    ["sourceSystem", "entityType", "legacyIdType", "legacyIdValue"],
    path,
  );
  if (
    source.sourceSystem !== "mongodb" ||
    source.entityType !== "users" ||
    (source.legacyIdType !== "objectid" && source.legacyIdType !== "string") ||
    typeof source.legacyIdValue !== "string" ||
    !source.legacyIdValue.trim() ||
    !source.legacyIdValue.isWellFormed() ||
    source.legacyIdValue.includes("\0") ||
    (source.legacyIdType === "objectid" &&
      !/^[0-9a-f]{24}$/.test(source.legacyIdValue))
  )
    fail("invalid-user-source", path);
  return {
    sourceSystem: "mongodb",
    entityType: "users",
    legacyIdType: source.legacyIdType,
    legacyIdValue: source.legacyIdValue,
  };
}
function forumOrigin(value: unknown): string {
  const path = "options.sourceForumOrigin";
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(value)
  )
    fail("invalid-forum-origin", path);
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value || !parsed.hostname)
      fail("invalid-forum-origin", path);
  } catch {
    fail("invalid-forum-origin", path);
  }
  return value;
}

/**
 * Preserve only users.discourseId and exact typed user identity. Missing and null
 * are separate dispositions; malformed or colliding links stop the entire plan.
 * No ID allocation, database/provider access, current clock or mutation occurs.
 */
export function planLegacyDiscourseImport(
  input: readonly LegacyDiscourseUser[],
  options: LegacyDiscourseImportOptions,
): LegacyDiscourseImportPlan {
  if (!Array.isArray(input)) fail("invalid-input-array", "input");
  record(
    options,
    ["lookup", "canonicalUserIds", "sourceForumOrigin", "importedAt"],
    "options",
  );
  if (typeof options.lookup !== "function")
    fail("invalid-lookup", "options.lookup");
  const origin = forumOrigin(options.sourceForumOrigin);
  if (
    !(options.importedAt instanceof Date) ||
    !Number.isFinite(options.importedAt.getTime())
  )
    fail("invalid-import-time", "options.importedAt");
  const importedAt = options.importedAt.getTime();
  if (
    !Array.isArray(options.canonicalUserIds) ||
    options.canonicalUserIds.some((value) => !isUuidV7(value))
  )
    fail("invalid-user-set", "options.canonicalUserIds");
  const users = new Set(
    options.canonicalUserIds.map((value) => value.toLowerCase()),
  );
  if (users.size !== options.canonicalUserIds.length)
    fail("invalid-user-set", "options.canonicalUserIds");
  const plan: LegacyDiscourseImportPlan = {
    sourceForumOrigin: origin,
    links: [],
    dispositions: [],
    counts: { users: input.length, linked: 0, missing: 0, null: 0 },
  };
  const seenSources = new Set<string>(),
    seenUsers = new Set<string>(),
    seenForumIds = new Set<number>();
  for (const [index, value] of input.entries()) {
    const path = `users[${index}]`;
    const item = record(value, ["source", "discourseId"], path);
    const source = userSource(item.source, `${path}.source`);
    const key = JSON.stringify([
      source.sourceSystem,
      source.entityType,
      source.legacyIdType,
      source.legacyIdValue,
    ]);
    if (seenSources.has(key)) fail("duplicate-user-source", path);
    seenSources.add(key);
    let mapped: unknown;
    try {
      mapped = options.lookup({ ...source });
    } catch {
      fail("lookup-failed", `${path}.source`);
    }
    if (!isUuidV7(mapped)) fail("missing-canonical-alias", `${path}.source`);
    const userId = mapped.toLowerCase();
    if (!users.has(userId) || seenUsers.has(userId))
      fail("unknown-or-duplicate-user", path);
    seenUsers.add(userId);
    let disposition: "linked" | "missing" | "null";
    if (!Object.hasOwn(item, "discourseId")) disposition = "missing";
    else if (item.discourseId === null) disposition = "null";
    else {
      const externalId = item.discourseId;
      if (
        typeof externalId !== "number" ||
        !Number.isSafeInteger(externalId) ||
        externalId <= 0
      )
        fail("invalid-discourse-id", `${path}.discourseId`);
      if (seenForumIds.has(externalId))
        fail("conflicting-forum-account", `${path}.discourseId`);
      seenForumIds.add(externalId);
      plan.links.push({
        userId,
        forumOrigin: origin,
        discourseUserId: externalId,
        createdAt: new Date(importedAt),
      });
      disposition = "linked";
    }
    plan.counts[disposition]++;
    plan.dispositions.push({ source, userId, disposition });
  }
  if (seenUsers.size !== users.size)
    fail("incomplete-user-projection", "input");
  return plan;
}
