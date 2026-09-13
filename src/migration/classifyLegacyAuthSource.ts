/** Only counts cross into the checkpoint; no discarded token/profile values are retained. */
export interface LegacyAuthSourceDispositions {
  profile: "magickli-auth-source-dispositions-v1";
  counts: {
    sessionRowsDiscarded: number;
    strategyRowsExcluded: number;
    embeddedTokenFieldsDropped: number;
    providerProfileSubtreesDropped: number;
    modernOauthFieldsDropped: number;
  };
}

/** Safe source positions only; unknown field names can themselves contain private values. */
export class LegacyAuthSourceError extends Error {
  readonly code = "unsupported-auth-source";
  constructor(public readonly path: string) {
    super(`unsupported-auth-source at ${path}`);
    this.name = "LegacyAuthSourceError";
  }
}

type Row = Record<string, unknown>;
function fail(path: string): never {
  throw new LegacyAuthSourceError(path);
}
function row(value: unknown, allowed: readonly string[], path: string): Row {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(path);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.entries(Object.getOwnPropertyDescriptors(value)).some(
      ([key, descriptor]) =>
        !allowed.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor),
    )
  )
    fail(path);
  return value as Row;
}
function list(value: unknown, path: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getOwnPropertySymbols(value).length ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  )
    fail(path);
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (!item || !item.enumerable || !("value" in item)) fail(path);
  }
  return value;
}
function optionalList(value: unknown, path: string): unknown[] {
  return value === undefined ? [] : list(value, path);
}
function name(value: unknown, path: string) {
  if (value !== null && value !== undefined && typeof value !== "string")
    row(value, ["givenName", "familyName"], path);
}
function historicalText(value: unknown, path: string) {
  if (
    value !== null &&
    (typeof value !== "string" || !value.isWellFormed() || value.includes("\0"))
  )
    fail(path);
}
function profileFields(value: Row, path: string) {
  name(value.name, `${path}.name`);
  name(value.displayName, `${path}.displayName`);
  for (const [index, entry] of optionalList(
    value.emails,
    `${path}.emails`,
  ).entries())
    row(entry, ["value", "verified"], `${path}.emails[${index}]`);
  for (const [index, entry] of optionalList(
    value.photos,
    `${path}.photos`,
  ).entries()) {
    const at = `${path}.photos[${index}]`;
    const photo = row(entry, ["value", "provider"], at);
    if (Object.hasOwn(photo, "provider")) historicalText(photo.provider, at);
  }
}
const dates = ["createdAt", "updatedAt", "__updatedAt"];
const modernTokens = [
  "access_token",
  "id_token",
  "refresh_token",
  "token_type",
  "scope",
  "expires_at",
];

/**
 * Classifies supported auth containers before normalization. Explicit historical
 * profile subtrees and sessions are discarded without traversing their contents.
 * The existing normalizer remains responsible for identity/value semantics.
 */
export function classifyLegacyAuthSource(input: {
  users: readonly unknown[];
  accounts: readonly unknown[];
  sessions: readonly unknown[];
}): LegacyAuthSourceDispositions {
  row(input, ["users", "accounts", "sessions"], "auth");
  const users = list(input.users, "users"),
    accounts = list(input.accounts, "accounts"),
    sessions = list(input.sessions, "sessions");
  const result: LegacyAuthSourceDispositions = {
    profile: "magickli-auth-source-dispositions-v1",
    counts: {
      sessionRowsDiscarded: sessions.length,
      strategyRowsExcluded: 0,
      embeddedTokenFieldsDropped: 0,
      providerProfileSubtreesDropped: 0,
      modernOauthFieldsDropped: 0,
    },
  };
  for (const [index, item] of users.entries()) {
    const path = `users[${index}]`;
    const user = row(
      item,
      [
        "_id",
        "id",
        "name",
        "displayName",
        "email",
        "emailVerified",
        "emails",
        "photos",
        "image",
        "services",
        ...dates,
        "admin",
        "groupIds",
        "groupAdminIds",
        "discourseId",
        "locale",
        "gender",
      ],
      path,
    );
    // Historical top-level provider profile data is preserved separately in
    // the protected import ledger, with no new authentication/UI meaning.
    for (const field of ["locale", "gender"])
      if (Object.hasOwn(user, field)) historicalText(user[field], path);
    profileFields(user, path);
    for (const [serviceIndex, item] of optionalList(
      user.services,
      `${path}.services`,
    ).entries()) {
      const at = `${path}.services[${serviceIndex}]`;
      const service = row(
        item,
        ["service", "id", "profile", "accessToken", "refreshToken"],
        at,
      );
      for (const key of ["accessToken", "refreshToken"])
        if (Object.hasOwn(service, key))
          result.counts.embeddedTokenFieldsDropped++;
      if (service.profile === undefined) continue;
      const profile = row(
        service.profile,
        [
          "id",
          "provider",
          "displayName",
          "name",
          "emails",
          "photos",
          "_raw",
          "_json",
        ],
        `${at}.profile`,
      );
      profileFields(profile, `${at}.profile`);
      for (const key of ["_raw", "_json"])
        if (Object.hasOwn(profile, key))
          result.counts.providerProfileSubtreesDropped++;
    }
  }
  for (const [index, item] of accounts.entries()) {
    const path = `accounts[${index}]`;
    // First validate descriptors before inspecting the discriminator.
    const account = row(
      item,
      [
        "_id",
        "userId",
        "type",
        "provider",
        "providerAccountId",
        "name",
        "oauth2",
        ...dates,
        ...modernTokens,
      ],
      path,
    );
    if (
      account.userId === undefined &&
      account.type === "oauth2" &&
      typeof account._id === "string" &&
      account.provider === undefined &&
      account.providerAccountId === undefined
    ) {
      row(account, ["_id", "name", "type", "oauth2", ...dates], path);
      result.counts.strategyRowsExcluded++;
    } else {
      row(
        account,
        [
          "_id",
          "userId",
          "type",
          "provider",
          "providerAccountId",
          ...dates,
          ...modernTokens,
        ],
        path,
      );
      for (const key of modernTokens)
        if (Object.hasOwn(account, key))
          result.counts.modernOauthFieldsDropped++;
    }
  }
  return result;
}
