import { ObjectId } from "bson";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegacyAuthNormalizationError,
  normalizeLegacyAuth,
} from "./normalizeLegacyAuth";

const id = (value: number) =>
  new ObjectId(value.toString(16).padStart(24, "0"));
const creation = new Date("2020-01-02T03:04:05.000Z");
const secret = "SYNTHETIC_TOKEN_MUST_NOT_SURVIVE";

function user(index = 1): Record<string, unknown> {
  const address = `reader${index}@example.test`;
  return {
    _id: id(index),
    displayName: `Reader ${index}`,
    name: { givenName: "Reader", familyName: `${index}` },
    emails: [{ value: address, verified: true }],
    services: [
      {
        service: "google",
        id: `provider-${index}`,
        accessToken: secret,
        refreshToken: secret,
        profile: {
          id: `provider-${index}`,
          provider: "google",
          displayName: `Profile Reader ${index}`,
          name: { givenName: "Profile Reader", familyName: `${index}` },
          emails: [{ value: address, verified: true }],
          photos: [{ value: `https://example.test/profile-${index}.png` }],
          _raw: secret,
          _json: { access_token: secret, privateProfileField: secret },
        },
      },
    ],
    photos: [{ value: `https://example.test/reader-${index}.png` }],
    admin: true,
    groupIds: [id(900)],
    groupAdminIds: [id(900)],
    discourseId: 456,
    __updatedAt: 1_600_000_000_000,
  };
}

function account(index = 1): Record<string, unknown> {
  return {
    _id: id(100 + index),
    userId: id(index),
    type: "oidc",
    provider: "google",
    providerAccountId: `provider-${index}`,
    access_token: secret,
    id_token: secret,
    refresh_token: secret,
    token_type: "bearer",
    scope: "openid email profile",
    expires_at: 1_600_000_000,
  };
}

function services(row: Record<string, unknown>) {
  return row.services as {
    service: string;
    id: string;
    profile: Record<string, unknown>;
  }[];
}

function input(
  users = [user()],
  accounts = [account()],
  sessions: Record<string, unknown>[] = [],
) {
  return { users, accounts, sessions };
}

function expectFailure(
  source: Parameters<typeof normalizeLegacyAuth>[0],
  code: string,
) {
  try {
    normalizeLegacyAuth(source);
    throw new Error("Expected normalization to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyAuthNormalizationError);
    expect((error as LegacyAuthNormalizationError).code).toBe(code);
    expect(String(error)).not.toContain(secret);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("normalizeLegacyAuth", () => {
  it("matches the audited aggregate shape with entirely synthetic records", () => {
    const users = Array.from({ length: 12 }, (_, index) => {
      const row = user(index + 1);
      if (index < 7)
        Object.assign(row, {
          name: `String Reader ${index + 1}`,
          email: `reader${index + 1}@example.test`,
          emailVerified: null,
          image: `https://example.test/modern-${index + 1}.png`,
          createdAt: creation,
        });
      if (index < 4) row.id = id(index + 1).toHexString();
      if (index >= 10) delete row.__updatedAt;
      return row;
    });
    (users[0].emails as unknown[]).push(
      { value: "reader1@example.test", verified: true },
      { value: "secondary@example.test" },
    );
    for (const index of [1, 2])
      (users[index].emails as unknown[]).push({
        value: `reader${index + 1}@example.test`,
        verified: true,
      });
    const accounts = Array.from({ length: 9 }, (_, index) => ({
      ...account(index + 1),
      type: index < 7 ? "oidc" : "oauth",
    }));
    const strategy = {
      _id: "old-strategy-record",
      name: "Legacy strategy",
      type: "oauth2",
      oauth2: {
        authorize_url: "https://example.test/oauth",
        client_id: secret,
        client_secret: secret,
      },
    };
    const sessions = Array.from({ length: 36 }, (_, index) =>
      index < 23
        ? {
            _id: id(500 + index),
            userId: id(1),
            expires: creation,
            sessionToken: secret,
          }
        : { _id: `legacy-session-${index}`, token: secret },
    );
    const normalized = normalizeLegacyAuth(
      input(users, [...accounts, strategy], sessions),
    );
    expect(normalized.users).toHaveLength(12);
    expect(normalized.accounts).toHaveLength(12);
    expect(
      normalized.accounts.filter((row) => row.modernSources.length),
    ).toHaveLength(9);
    expect(
      normalized.accounts.flatMap((row) => row.embeddedSources),
    ).toHaveLength(12);
    expect(
      normalized.accounts.filter((row) => !row.modernSources.length),
    ).toHaveLength(3);
    expect(
      normalized.users.filter((row) => row.timestamps.createdAt === null),
    ).toHaveLength(5);
    expect(
      normalized.users.filter((row) => row.adapterIdReference !== null),
    ).toHaveLength(4);
    expect(normalized.users.flatMap((row) => row.emails)).toHaveLength(13);
    expect(
      normalized.users.every(
        (row) =>
          row.emails.find((email) => email.value === row.primaryEmail)
            ?.verified,
      ),
    ).toBe(true);
    expect(normalized.discardedSessionCount).toBe(36);
    expect(
      normalized.excluded.filter(
        (row) => row.reason === "legacy-strategy-configuration",
      ),
    ).toHaveLength(1);
    expect(normalized.sharedEmails).toEqual([]);
  });

  it("preserves verified and secondary email provenance despite modern null verification", () => {
    const row = user();
    row.email = "reader1@example.test";
    row.emailVerified = null;
    row.emails = [
      { value: "reader1@example.test", verified: true },
      { value: "secondary@example.test", verified: false },
    ];
    const normalized = normalizeLegacyAuth(input([row])).users[0];
    expect(normalized.primaryEmail).toBe("reader1@example.test");
    expect(normalized.emails).toEqual([
      {
        value: "reader1@example.test",
        verified: true,
        evidence: [
          { field: "email", verified: null, verifiedAt: null },
          { field: "emails[0]", verified: true, verifiedAt: null },
          {
            field: "services[0].profile.emails[0]",
            verified: true,
            verifiedAt: null,
          },
        ],
      },
      {
        value: "secondary@example.test",
        verified: false,
        evidence: [{ field: "emails[1]", verified: false, verifiedAt: null }],
      },
    ]);
  });

  it("retains exact email spelling and dated or conflicting verification evidence", () => {
    const row = user();
    row.email = "Reader1@example.test";
    row.emailVerified = creation;
    row.emails = [
      { value: "Reader1@example.test", verified: false },
      { value: "reader1@example.test" },
    ];
    const [primary, secondary] = normalizeLegacyAuth(input([row])).users[0]
      .emails;
    expect(primary.verified).toBe(true);
    expect(primary.evidence).toEqual([
      { field: "email", verified: true, verifiedAt: creation.toISOString() },
      { field: "emails[0]", verified: false, verifiedAt: null },
    ]);
    expect(secondary.value).toBe("reader1@example.test");
    expect(secondary.evidence[0].verified).toBeNull();
  });

  it("normalizes object and string names while retaining distinct display names", () => {
    const first = user();
    first.name = { givenName: "  Ada ", familyName: " Reader  " };
    const second = user(2);
    second.name = "  Bo Reader  ";
    const third = user(3);
    delete third.displayName;
    third.name = { givenName: "Cy", familyName: "" };
    const output = normalizeLegacyAuth(input([first, second, third], []));
    expect(output.users.map((row) => row.name)).toEqual([
      "Ada Reader",
      "Bo Reader",
      "Cy",
    ]);
    expect(output.users.map((row) => row.displayName)).toEqual([
      "Reader 1",
      "Reader 2",
      "Cy",
    ]);
    expect(output.users[0].image).toBe("https://example.test/reader-1.png");
  });

  it("uses embedded profile fallback when the user profile has no display fields", () => {
    const row = user();
    for (const key of ["name", "displayName", "emails", "photos"])
      delete row[key];
    const normalized = normalizeLegacyAuth(input([row])).users[0];
    expect(normalized.name).toBe("Profile Reader 1");
    expect(normalized.displayName).toBe("Profile Reader 1");
    expect(normalized.image).toBe("https://example.test/profile-1.png");
    expect(normalized.primaryEmail).toBe("reader1@example.test");
  });

  it("preserves modern oidc type and merges modern duplicates only within one user", () => {
    const duplicate = { ...account(), _id: id(999), createdAt: creation };
    const [result] = normalizeLegacyAuth(
      input([user()], [account(), duplicate]),
    ).accounts;
    expect(result.type).toBe("oidc");
    expect(result.modernSources).toHaveLength(2);
    expect(result.embeddedSources).toHaveLength(1);
    expect(
      result.modernSources.map((source) => source.timestamps.createdAt),
    ).toEqual([null, creation.toISOString()]);
  });

  it("never merges users by a shared email; reports the adapter conflict", () => {
    const first = user();
    const second = user(2);
    second.emails = [{ value: "reader1@example.test", verified: true }];
    const result = normalizeLegacyAuth(input([first, second], []));
    expect(result.users).toHaveLength(2);
    expect(result.accounts).toHaveLength(2);
    expect(result.sharedEmails).toEqual([
      {
        value: "reader1@example.test",
        users: result.users.map((row) => row.source),
      },
    ]);
  });

  it("preserves ObjectId and string primary keys with identical characters", () => {
    const first = user();
    const second = user(2);
    second._id = id(1).toHexString();
    const result = normalizeLegacyAuth(input([first, second], []));
    expect(result.users.map((row) => row.source.legacyIdType)).toEqual([
      "objectid",
      "string",
    ]);
    expect(
      new Set(result.users.map((row) => row.source.legacyIdValue)).size,
    ).toBe(1);
    expect(result.accounts).toHaveLength(2);
  });

  it("records an agreeing redundant adapter ID with explicit string type", () => {
    const row = user();
    row.id = id(1).toHexString();
    const result = normalizeLegacyAuth(input([row])).users[0];
    expect(result.source.legacyIdType).toBe("objectid");
    expect(result.adapterIdReference).toEqual({
      ...result.source,
      legacyIdType: "string",
    });
  });

  it("rejects a redundant adapter ID that would alias another typed user identity", () => {
    const first = user();
    first.id = id(1).toHexString();
    const second = user(2);
    second._id = id(1).toHexString();
    expectFailure(input([first, second], []), "adapter-user-id-collision");
  });

  it("resolves an account through an explicitly declared adapter alias", () => {
    const row = user();
    row.id = id(1).toHexString();
    const linked = account();
    linked.userId = row.id;
    const result = normalizeLegacyAuth(input([row], [linked]));
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].user).toEqual(result.users[0].source);
    expect(result.accounts[0].user.legacyIdType).toBe("objectid");
    expect(result.accounts[0].modernSources).toHaveLength(1);
    expect(result.accounts[0].embeddedSources).toHaveLength(1);
  });

  it("discards all session shapes and tokens through allowlisted projections", () => {
    const sessions = [
      { _id: id(500), sessionToken: secret, expires: new Date("2099-01-01") },
      { _id: secret, token: secret, user: { private: secret } },
    ];
    const result = normalizeLegacyAuth(input([user()], [account()], sessions));
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      secret,
      "access_token",
      "refreshToken",
      "sessionToken",
      "_json",
      "admin",
      "groupIds",
      "discourseId",
      "scope",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(result.discardedSessionCount).toBe(2);
    expect(result.excluded).toEqual([]);
  });

  it("does not mutate input, read the clock, infer ObjectId time, or reuse token expiry as history", () => {
    const source = input();
    const before = JSON.stringify(source);
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Clock is forbidden");
    });
    const first = normalizeLegacyAuth(source);
    expect(normalizeLegacyAuth(source)).toEqual(first);
    expect(JSON.stringify(source)).toBe(before);
    expect(first.users[0].timestamps).toEqual({
      createdAt: null,
      updatedAt: null,
      syncUpdatedAtMilliseconds: 1_600_000_000_000,
    });
    expect(first.accounts[0].modernSources[0].timestamps).toEqual({
      createdAt: null,
      updatedAt: null,
      syncUpdatedAtMilliseconds: null,
    });
  });

  it.each(["modern", "embedded"])(
    "rejects a cross-user provider collision from %s identities",
    (shape) => {
      const second = user(2);
      const accounts = [account()];
      if (shape === "modern")
        accounts.push({ ...account(2), providerAccountId: "provider-1" });
      else services(second)[0] = { ...services(user())[0] };
      expectFailure(
        input([user(), second], accounts),
        "provider-identity-collision",
      );
    },
  );

  it("rejects an unresolved or cross-type account user reference", () => {
    expectFailure(
      input([user()], [{ ...account(), userId: id(999) }]),
      "unresolved-account-user",
    );
    expectFailure(
      input([user()], [{ ...account(), userId: id(1).toHexString() }]),
      "unresolved-account-user",
    );
  });

  it("does not confuse a malformed account with an excluded strategy record", () => {
    expectFailure(
      input(
        [user()],
        [
          {
            _id: id(5),
            type: "oauth2",
            oauth2: {},
            name: "Not an audited strategy",
          },
        ],
      ),
      "unsupported-account-shape",
    );
    expectFailure(
      input([user()], [{ ...account(), type: "oauth2", oauth2: {} }]),
      "unsupported-account-shape",
    );
  });

  it("rejects mismatched redundant IDs, provider profile identities, and account types", () => {
    expectFailure(
      input([{ ...user(), id: id(2).toHexString() }]),
      "adapter-user-id-mismatch",
    );
    const row = user();
    services(row)[0].profile.id = secret;
    expectFailure(input([row]), "embedded-profile-identity-mismatch");
    expectFailure(
      input(
        [user()],
        [account(), { ...account(), _id: id(999), type: "oauth" }],
      ),
      "modern-account-type-conflict",
    );
  });

  it("rejects duplicate primary IDs and users without a provider identity", () => {
    expectFailure(input([user(), user()]), "duplicate-source-id");
    expectFailure(
      input([user()], [account(), account()]),
      "duplicate-source-id",
    );
    expectFailure(
      input([{ ...user(), services: [] }], []),
      "user-without-provider-identity",
    );
  });

  it.each([new Date(Number.NaN), "2020-01-01", 123])(
    "rejects invalid historical date %s instead of inventing a fallback",
    (createdAt) => {
      expectFailure(input([{ ...user(), createdAt }]), "invalid-date");
    },
  );

  it("rejects malformed verification and synchronization timestamps without leaking values", () => {
    expectFailure(
      input([
        { ...user(), email: "reader1@example.test", emailVerified: secret },
      ]),
      "invalid-email-verification",
    );
    expectFailure(
      input([{ ...user(), __updatedAt: Number.NaN }]),
      "invalid-sync-timestamp",
    );
  });
});
