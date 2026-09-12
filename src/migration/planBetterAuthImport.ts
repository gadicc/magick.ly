import type { LegacyAliasKey } from "../db/legacyIds";
import type { account, user } from "../db/schema/auth";
import type {
  legacyAuthAccounts,
  legacyAuthUsers,
  legacyUserEmails,
  userAccess,
  userProfile,
} from "../db/schema/userProfile";
import { isUuidV7 } from "../lib/ids";
import type {
  LegacyAuthReference,
  NormalizedLegacyAuth,
  NormalizedLegacyAuthAccount,
} from "./normalizeLegacyAuth";

/** Protected rows for a transactional importer; never log or expose this plan. */
export interface BetterAuthImportPlan {
  users: (typeof user.$inferInsert & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  })[];
  accounts: (Pick<
    typeof account.$inferInsert,
    "id" | "userId" | "providerId" | "accountId" | "createdAt" | "updatedAt"
  > & { id: string; createdAt: Date; updatedAt: Date })[];
  profiles: (typeof userProfile.$inferInsert)[];
  legacyUsers: (typeof legacyAuthUsers.$inferInsert)[];
  legacyAccounts: (typeof legacyAuthAccounts.$inferInsert)[];
  emails: (typeof legacyUserEmails.$inferInsert)[];
  aliases: { source: LegacyAliasKey; canonicalId: string }[];
  discardedSessionCount: number;
}

/** The caller allocates durable UUID aliases before planning, in the same transaction. */
export type CanonicalAuthIdLookup = (source: LegacyAliasKey) => string | null;

/** Errors expose only a category and input position, never a source ID or address. */
export class BetterAuthImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "BetterAuthImportError";
  }
}
function fail(code: string, path: string): never {
  throw new BetterAuthImportError(code, path);
}

const key = (source: LegacyAliasKey) =>
  JSON.stringify([
    source.sourceSystem,
    source.entityType,
    source.legacyIdType,
    source.legacyIdValue,
  ]);

/** Stable derived alias for embedded-only identities; Google subjects remain exact text. */
export function legacyProviderAlias(
  account: Pick<NormalizedLegacyAuthAccount, "provider" | "providerAccountId">,
): LegacyAliasKey {
  return {
    sourceSystem: "mongodb",
    entityType: "auth-provider-identities",
    legacyIdType: "string",
    legacyIdValue: JSON.stringify([
      account.provider,
      account.providerAccountId,
    ]),
  };
}

function emailKey(value: string, path: string) {
  // Match Better Auth's case-insensitive email identity without rewriting dots,
  // plus suffixes, domains or historical spellings in the provenance rows.
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) fail("invalid-email", path);
  return value.toLowerCase();
}
function historicalDate(value: string | null, path: string) {
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail("invalid-historical-date", path);
  return parsed;
}
function canonicalId(
  lookup: CanonicalAuthIdLookup,
  source: LegacyAliasKey,
  path: string,
) {
  const id = lookup(source);
  if (!isUuidV7(id)) fail("missing-or-invalid-canonical-id", path);
  return id.toLowerCase();
}

/**
 * Maps normalized profiles and preallocated aliases without writes, clock access,
 * token transfer or email-based user merging. Auth grants are deliberately absent.
 * importedAt is an explicit, persisted import-run timestamp for required adapter
 * dates whose historical values are missing; provenance keeps those dates null.
 */
export function planBetterAuthImport(
  input: NormalizedLegacyAuth,
  options: { importedAt: Date; lookup: CanonicalAuthIdLookup },
): BetterAuthImportPlan {
  if (!Number.isFinite(options.importedAt.getTime()))
    fail("invalid-import-time", "importedAt");
  const importedAt = new Date(options.importedAt);
  const plan: BetterAuthImportPlan = {
    users: [],
    accounts: [],
    profiles: [],
    legacyUsers: [],
    legacyAccounts: [],
    emails: [],
    aliases: [],
    discardedSessionCount: input.discardedSessionCount,
  };
  const users = new Map<string, string>();
  const usedIds = new Set<string>();
  const emailOwners = new Map<string, string>();
  const aliasOwners = new Map<string, string>();
  const addAlias = (source: LegacyAliasKey, id: string, path: string) => {
    const existing = options.lookup(source);
    if (
      existing !== null &&
      (!isUuidV7(existing) || existing.toLowerCase() !== id)
    )
      fail("conflicting-alias", path);
    const existingPlan = aliasOwners.get(key(source));
    if (existingPlan && existingPlan !== id) fail("conflicting-alias", path);
    if (!existingPlan)
      plan.aliases.push({ source: { ...source }, canonicalId: id });
    aliasOwners.set(key(source), id);
  };
  const reserveId = (id: string, path: string) => {
    if (usedIds.has(id)) fail("canonical-id-reused", path);
    usedIds.add(id);
  };
  for (const [index, row] of input.users.entries()) {
    const path = `users[${index}]`;
    if (users.has(key(row.source))) fail("duplicate-user", path);
    const id = canonicalId(options.lookup, row.source, path);
    reserveId(id, path);
    users.set(key(row.source), id);
    addAlias(row.source, id, path);
    if (row.adapterIdReference)
      addAlias(row.adapterIdReference, id, `${path}.adapterIdReference`);
    const name = row.name ?? row.displayName;
    if (!name?.trim()) fail("missing-name", path);
    if (!row.primaryEmail) fail("missing-primary-email", path);
    const primary = emailKey(row.primaryEmail, path);
    const primaryEvidence = row.emails.filter(
      (email) => emailKey(email.value, path) === primary,
    );
    if (!primaryEvidence.length) fail("missing-primary-email-evidence", path);
    const values = new Set<string>();
    for (const email of row.emails) {
      if (values.has(email.value)) fail("duplicate-email-provenance", path);
      values.add(email.value);
      const normalizedValue = emailKey(email.value, path);
      const owner = emailOwners.get(normalizedValue);
      if (owner && owner !== id) fail("email-owned-by-multiple-users", path);
      emailOwners.set(normalizedValue, id);
      plan.emails.push({
        userId: id,
        value: email.value,
        normalizedValue,
        verified: email.verified,
        evidence: email.evidence.map(({ field, verified, verifiedAt }) => ({
          field,
          verified,
          verifiedAt,
        })),
      });
    }
    const createdAt = historicalDate(row.timestamps.createdAt, path);
    const updatedAt = historicalDate(row.timestamps.updatedAt, path);
    plan.users.push({
      id,
      name,
      email: primary,
      emailVerified: primaryEvidence.some((e) => e.verified),
      image: row.image,
      createdAt: createdAt ?? importedAt,
      updatedAt: updatedAt ?? importedAt,
    });
    plan.profiles.push({ userId: id, displayName: row.displayName });
    plan.legacyUsers.push({
      userId: id,
      createdAt,
      updatedAt,
      importedAt,
      syncUpdatedAtMilliseconds: row.timestamps.syncUpdatedAtMilliseconds,
    });
  }
  const pairs = new Set<string>();
  for (const [index, row] of input.accounts.entries()) {
    const path = `accounts[${index}]`;
    if (row.provider !== "google") fail("unreviewed-provider", path);
    if (!row.providerAccountId) fail("missing-provider-subject", path);
    const userId = users.get(key(row.user)) ?? aliasOwners.get(key(row.user));
    if (!userId || !plan.users.some((u) => u.id === userId))
      fail("unknown-account-user", path);
    const source = legacyProviderAlias(row);
    if (pairs.has(key(source))) fail("duplicate-provider-identity", path);
    pairs.add(key(source));
    const id = canonicalId(options.lookup, source, path);
    reserveId(id, path);
    addAlias(source, id, path);
    for (const modern of row.modernSources) addAlias(modern.source, id, path);
    const modernSources = row.modernSources.map(({ source, timestamps }) => ({
      source: { ...source },
      timestamps: { ...timestamps },
    }));
    const embeddedSources = row.embeddedSources.map(
      ({ user, serviceIndex }) => ({ user: { ...user }, serviceIndex }),
    );
    const created = modernSources
      .map((s) => historicalDate(s.timestamps.createdAt, path))
      .filter((d): d is Date => d !== null);
    const updated = modernSources
      .map((s) => historicalDate(s.timestamps.updatedAt, path))
      .filter((d): d is Date => d !== null);
    plan.accounts.push({
      id,
      userId,
      providerId: row.provider,
      accountId: row.providerAccountId,
      createdAt: created.length
        ? new Date(Math.min(...created.map(Number)))
        : importedAt,
      updatedAt: updated.length
        ? new Date(Math.max(...updated.map(Number)))
        : importedAt,
    });
    plan.legacyAccounts.push({
      accountId: id,
      legacyType: row.type,
      modernSources,
      embeddedSources,
      importedAt,
    });
  }
  for (const [index, row] of plan.users.entries()) {
    if (!plan.accounts.some((account) => account.userId === row.id))
      fail("user-without-provider", `users[${index}]`);
  }
  return plan;
}

/** Server-only projection from source users; this is separate from OAuth profile data. */
export function planLegacyUserAccess(
  rows: readonly { source: LegacyAuthReference; admin?: boolean }[],
  plan: BetterAuthImportPlan,
  lookup: CanonicalAuthIdLookup,
): (typeof userAccess.$inferInsert)[] {
  const expected = new Set(plan.users.map((user) => user.id));
  const access = rows.map((row, index) => {
    const path = `access[${index}]`;
    if (row.admin !== undefined && typeof row.admin !== "boolean")
      fail("invalid-admin-flag", path);
    const userId = canonicalId(lookup, row.source, path);
    if (!expected.delete(userId))
      fail("unknown-or-duplicate-access-user", path);
    return { userId, admin: row.admin ?? false };
  });
  if (expected.size) fail("missing-access-user", "access");
  return access;
}
