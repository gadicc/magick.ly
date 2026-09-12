/** Source identity for the durable UUID alias map; string IDs retain their type. */
export interface LegacyAuthReference {
  sourceSystem: "mongodb";
  entityType: "users" | "accounts";
  legacyIdType: "objectid" | "string";
  legacyIdValue: string;
}

/** Historical instants use ISO strings; absent dates never become the import time. */
export interface HistoricalAuthTimestamps {
  createdAt: string | null;
  updatedAt: string | null;
  /** Gongo synchronization bookkeeping is not a historical profile update date. */
  syncUpdatedAtMilliseconds: number | null;
}

/** Each address retains the source of boolean or dated verification evidence. */
export interface NormalizedLegacyEmail {
  value: string;
  verified: boolean;
  evidence: {
    /** Path within this user's source document, without raw profile/token data. */
    field: string;
    verified: boolean | null;
    verifiedAt: string | null;
  }[];
}

/** Authentication profile only; application grants must be imported separately. */
export interface NormalizedLegacyAuthUser {
  source: LegacyAuthReference;
  /** An agreeing redundant user.id is an explicit string alias, not a new user. */
  adapterIdReference: LegacyAuthReference | null;
  name: string | null;
  displayName: string | null;
  image: string | null;
  primaryEmail: string | null;
  emails: NormalizedLegacyEmail[];
  timestamps: HistoricalAuthTimestamps;
}

/** One provider pair belongs to one source user; modern type beats embedded oauth. */
export interface NormalizedLegacyAuthAccount {
  user: LegacyAuthReference;
  provider: string;
  providerAccountId: string;
  type: "oauth" | "oidc";
  modernSources: {
    source: LegacyAuthReference;
    timestamps: HistoricalAuthTimestamps;
  }[];
  embeddedSources: {
    user: LegacyAuthReference;
    serviceIndex: number;
  }[];
}

/** Protected import DTOs, not browser projections or safe-to-log report payloads. */
export interface NormalizedLegacyAuth {
  users: NormalizedLegacyAuthUser[];
  accounts: NormalizedLegacyAuthAccount[];
  excluded: {
    source: LegacyAuthReference;
    reason: "legacy-strategy-configuration";
  }[];
  /** Even legacy session IDs may be bearer material; retain only this count. */
  discardedSessionCount: number;
  /** These require adapter policy; normalization never merges users by email. */
  sharedEmails: { value: string; users: LegacyAuthReference[] }[];
}

/** Errors include only a stable category and source array/field path, never values. */
export class LegacyAuthNormalizationError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyAuthNormalizationError";
  }
}

type Row = Record<string, unknown>;

function fail(code: string, path: string): never {
  throw new LegacyAuthNormalizationError(code, path);
}

function object(value: unknown, path: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-object", path);
  }
  return value as Row;
}

function list(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("invalid-array", path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) fail("invalid-text", path);
  return value;
}

function optionalText(value: unknown, path: string): string | null {
  return value === undefined || value === null ? null : text(value, path);
}

function instant(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail("invalid-date", path);
  }
  return value.toISOString();
}

function timestamps(row: Row, path: string): HistoricalAuthTimestamps {
  const sync = row.__updatedAt;
  if (
    sync !== undefined &&
    (typeof sync !== "number" || !Number.isFinite(sync))
  ) {
    fail("invalid-sync-timestamp", `${path}.__updatedAt`);
  }
  return {
    createdAt: instant(row.createdAt, `${path}.createdAt`),
    updatedAt: instant(row.updatedAt, `${path}.updatedAt`),
    syncUpdatedAtMilliseconds: (sync as number | undefined) ?? null,
  };
}

function reference(
  entityType: LegacyAuthReference["entityType"],
  value: unknown,
  path: string,
): LegacyAuthReference {
  if (typeof value === "string") {
    return {
      sourceSystem: "mongodb",
      entityType,
      legacyIdType: "string",
      legacyIdValue: value,
    };
  }
  const candidate = object(value, path);
  if (
    candidate._bsontype !== "ObjectId" ||
    typeof candidate.toHexString !== "function"
  ) {
    fail("invalid-source-id", path);
  }
  const hex: unknown = candidate.toHexString();
  if (typeof hex !== "string" || !/^[a-f0-9]{24}$/i.test(hex))
    fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: "objectid",
    legacyIdValue: hex.toLowerCase(),
  };
}

function referenceKey(ref: LegacyAuthReference): string {
  return JSON.stringify([ref.entityType, ref.legacyIdType, ref.legacyIdValue]);
}

function displayName(value: unknown, path: string): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value === undefined || value === null) return null;
  const name = object(value, path);
  const part = (value: unknown, field: string) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") fail("invalid-name", `${path}.${field}`);
    return value.trim();
  };
  return (
    [part(name.givenName, "givenName"), part(name.familyName, "familyName")]
      .filter(Boolean)
      .join(" ")
      .trim() || null
  );
}

function photo(value: unknown, path: string): string | null {
  return (
    list(value, path).map((entry, index) => {
      return text(
        object(entry, `${path}[${index}]`).value,
        `${path}[${index}].value`,
      );
    })[0] ?? null
  );
}

function normalizeUser(
  row: Row,
  source: LegacyAuthReference,
  path: string,
): NormalizedLegacyAuthUser {
  let adapterIdReference: LegacyAuthReference | null = null;
  if (row.id !== undefined) {
    const id = text(row.id, `${path}.id`);
    if (id !== source.legacyIdValue)
      fail("adapter-user-id-mismatch", `${path}.id`);
    adapterIdReference = reference("users", id, `${path}.id`);
  }
  const emails = new Map<string, NormalizedLegacyEmail>();
  const addEmail = (value: unknown, verified: unknown, field: string) => {
    const address = text(value, `${path}.${field}`);
    if (
      verified !== undefined &&
      verified !== null &&
      typeof verified !== "boolean" &&
      !(verified instanceof Date)
    ) {
      fail("invalid-email-verification", `${path}.${field}`);
    }
    const verifiedAt =
      verified instanceof Date ? instant(verified, `${path}.${field}`) : null;
    const status = verifiedAt
      ? true
      : typeof verified === "boolean"
        ? verified
        : null;
    const email = emails.get(address) ?? {
      value: address,
      verified: false,
      evidence: [],
    };
    email.verified ||= status === true;
    email.evidence.push({ field, verified: status, verifiedAt });
    emails.set(address, email);
  };
  if (row.email !== undefined && row.email !== null)
    addEmail(row.email, row.emailVerified, "email");
  list(row.emails, `${path}.emails`).forEach((value, index) => {
    const email = object(value, `${path}.emails[${index}]`);
    addEmail(email.value, email.verified, `emails[${index}]`);
  });
  let profileName: string | null = null;
  let profileImage: string | null = null;
  list(row.services, `${path}.services`).forEach((value, serviceIndex) => {
    const service = object(value, `${path}.services[${serviceIndex}]`);
    if (service.profile === undefined) return;
    const profile = object(
      service.profile,
      `${path}.services[${serviceIndex}].profile`,
    );
    const prefix = `services[${serviceIndex}].profile`;
    profileName ??=
      displayName(profile.displayName, `${path}.${prefix}.displayName`) ??
      displayName(profile.name, `${path}.${prefix}.name`);
    profileImage ??= photo(profile.photos, `${path}.${prefix}.photos`);
    list(profile.emails, `${path}.${prefix}.emails`).forEach((value, index) => {
      const email = object(value, `${path}.${prefix}.emails[${index}]`);
      addEmail(email.value, email.verified, `${prefix}.emails[${index}]`);
    });
  });
  const name = displayName(row.name, `${path}.name`);
  const display = displayName(row.displayName, `${path}.displayName`);
  return {
    source,
    adapterIdReference,
    name: name ?? display ?? profileName,
    displayName: display ?? name ?? profileName,
    image:
      optionalText(row.image, `${path}.image`) ??
      photo(row.photos, `${path}.photos`) ??
      profileImage,
    primaryEmail: emails.keys().next().value ?? null,
    emails: [...emails.values()],
    timestamps: timestamps(row, path),
  };
}

/**
 * Projects decoded BSON auth records into secret-free import DTOs without writes,
 * UUID allocation, clock access, user merging, or auth-adapter assumptions.
 * The caller must resolve typed references and shared-email policy before import.
 */
export function normalizeLegacyAuth(input: {
  users: readonly unknown[];
  accounts: readonly unknown[];
  sessions: readonly unknown[];
}): NormalizedLegacyAuth {
  const result: NormalizedLegacyAuth = {
    users: [],
    accounts: [],
    excluded: [],
    discardedSessionCount: input.sessions.length,
    sharedEmails: [],
  };
  const users = new Map<string, NormalizedLegacyAuthUser>();
  const accounts = new Map<string, NormalizedLegacyAuthAccount>();
  const seen = new Set<string>();
  const sourceOf = (
    collection: LegacyAuthReference["entityType"],
    row: Row,
    path: string,
  ) => {
    const source = reference(collection, row._id, `${path}._id`);
    const key = referenceKey(source);
    if (seen.has(key)) fail("duplicate-source-id", `${path}._id`);
    seen.add(key);
    return source;
  };
  input.users.forEach((value, index) => {
    const path = `users[${index}]`;
    const row = object(value, path);
    const source = sourceOf("users", row, path);
    const user = normalizeUser(row, source, path);
    users.set(referenceKey(source), user);
    result.users.push(user);
  });
  const aliasOwners = new Map(users);
  result.users.forEach((user, index) => {
    if (!user.adapterIdReference) return;
    const key = referenceKey(user.adapterIdReference);
    const owner = aliasOwners.get(key);
    if (owner && referenceKey(owner.source) !== referenceKey(user.source)) {
      fail("adapter-user-id-collision", `users[${index}].id`);
    }
    aliasOwners.set(key, user);
  });
  const accountFor = (
    user: LegacyAuthReference,
    provider: string,
    providerAccountId: string,
    path: string,
  ) => {
    const key = JSON.stringify([provider, providerAccountId]);
    let account = accounts.get(key);
    if (account && referenceKey(account.user) !== referenceKey(user))
      fail("provider-identity-collision", path);
    if (!account) {
      account = {
        user,
        provider,
        providerAccountId,
        type: "oauth",
        modernSources: [],
        embeddedSources: [],
      };
      accounts.set(key, account);
    }
    return account;
  };
  input.accounts.forEach((value, index) => {
    const path = `accounts[${index}]`;
    const row = object(value, path);
    const source = sourceOf("accounts", row, path);
    if (
      row.userId === undefined &&
      row.type === "oauth2" &&
      typeof row._id === "string" &&
      row.provider === undefined &&
      row.providerAccountId === undefined
    ) {
      text(row.name, `${path}.name`);
      object(row.oauth2, `${path}.oauth2`);
      result.excluded.push({ source, reason: "legacy-strategy-configuration" });
      return;
    }
    if (row.type !== "oauth" && row.type !== "oidc")
      fail("unsupported-account-shape", path);
    const userReference = reference("users", row.userId, `${path}.userId`);
    // A string reference may use an explicitly declared adapter alias, but
    // matching ObjectId text alone never establishes that identity.
    const user = aliasOwners.get(referenceKey(userReference));
    if (!user) fail("unresolved-account-user", `${path}.userId`);
    const account = accountFor(
      user.source,
      text(row.provider, `${path}.provider`),
      text(row.providerAccountId, `${path}.providerAccountId`),
      path,
    );
    if (account.modernSources.length && account.type !== row.type)
      fail("modern-account-type-conflict", `${path}.type`);
    account.type = row.type;
    account.modernSources.push({ source, timestamps: timestamps(row, path) });
  });
  input.users.forEach((value, index) => {
    const path = `users[${index}]`;
    const row = object(value, path);
    const user = result.users[index];
    list(row.services, `${path}.services`).forEach((value, serviceIndex) => {
      const servicePath = `${path}.services[${serviceIndex}]`;
      const service = object(value, servicePath);
      const provider = text(service.service, `${servicePath}.service`);
      const providerAccountId = text(service.id, `${servicePath}.id`);
      if (service.profile !== undefined) {
        const profile = object(service.profile, `${servicePath}.profile`);
        if (
          (profile.id !== undefined && profile.id !== providerAccountId) ||
          (profile.provider !== undefined && profile.provider !== provider)
        ) {
          fail("embedded-profile-identity-mismatch", `${servicePath}.profile`);
        }
      }
      accountFor(
        user.source,
        provider,
        providerAccountId,
        servicePath,
      ).embeddedSources.push({ user: user.source, serviceIndex });
    });
  });
  result.accounts = [...accounts.values()];
  const linkedUsers = new Set(
    result.accounts.map((account) => referenceKey(account.user)),
  );
  result.users.forEach((user, index) => {
    if (!linkedUsers.has(referenceKey(user.source)))
      fail("user-without-provider-identity", `users[${index}]`);
  });
  const emailOwners = new Map<string, LegacyAuthReference[]>();
  for (const user of result.users) {
    for (const email of user.emails) {
      const owners = emailOwners.get(email.value) ?? [];
      owners.push(user.source);
      emailOwners.set(email.value, owners);
    }
  }
  result.sharedEmails = [...emailOwners]
    .filter(([, owners]) => owners.length > 1)
    .map(([value, users]) => ({ value, users }));
  return result;
}
