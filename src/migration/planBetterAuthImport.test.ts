import { describe, expect, it, vi } from "vitest";
import { fixture, importedAt, sourceKey } from "../../tests/authFixtures";
import { createUuidV7 } from "../lib/ids";
import {
  legacyProviderAlias,
  planBetterAuthImport,
  planLegacyUserAccess,
} from "./planBetterAuthImport";

function prepared() {
  const test = fixture();
  const plan = () =>
    planBetterAuthImport(test.normalized, { importedAt, lookup: test.lookup });
  return { ...test, plan };
}

describe("Better Auth import plan", () => {
  it("preserves provider subjects, explicit adapter aliases and secondary verification evidence", () => {
    const test = prepared();
    const before = structuredClone(test.normalized);
    const plan = test.plan();
    expect(plan.users[0]).toMatchObject({
      name: "Synthetic Editor",
      email: "editor@example.test",
      emailVerified: true,
    });
    expect(plan.accounts.map((row) => row.accountId)).toEqual([
      "subject-editor",
      "subject-reader",
    ]);
    expect(plan.accounts.every((row) => row.providerId === "google")).toBe(
      true,
    );
    expect(plan.emails).toHaveLength(3);
    expect(plan.emails[0]).toMatchObject({
      value: "Editor@Example.test",
      normalizedValue: "editor@example.test",
      verified: true,
    });
    expect(plan.emails[0].evidence).toContainEqual({
      field: "email",
      verified: null,
      verifiedAt: null,
    });
    expect(
      plan.aliases.filter((row) => row.canonicalId === plan.users[0].id),
    ).toHaveLength(2);
    expect(
      plan.aliases.filter((row) => row.canonicalId === plan.accounts[0].id),
    ).toHaveLength(2);
    expect(plan.discardedSessionCount).toBe(1);
    expect(JSON.stringify(plan)).not.toContain("obsolete-");
    expect(JSON.stringify(plan)).not.toContain('"admin"');
    expect(test.normalized).toEqual(before);
    expect(test.plan()).toEqual(plan);
  });

  it("uses explicit bookkeeping fallback while retaining null historical dates", () => {
    const plan = prepared().plan();
    expect(plan.users[0].createdAt).toEqual(new Date("2020-01-02T03:04:05Z"));
    expect(plan.users[1]).toMatchObject({
      createdAt: importedAt,
      updatedAt: importedAt,
    });
    expect(plan.legacyUsers[1]).toMatchObject({
      createdAt: null,
      updatedAt: null,
      importedAt,
    });
    expect(plan.accounts[1]).toMatchObject({
      createdAt: importedAt,
      updatedAt: importedAt,
    });
    expect(plan.legacyAccounts[1]).toMatchObject({
      modernSources: [],
      importedAt,
    });
  });

  it("rejects an invalid import timestamp before consulting durable identities", () => {
    const test = prepared();
    const lookup = vi.fn(test.lookup);
    expect(() =>
      planBetterAuthImport(test.normalized, {
        importedAt: new Date("invalid"),
        lookup,
      }),
    ).toThrow("invalid-import-time at importedAt");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses the earliest creation and latest update across linked account records", () => {
    const test = prepared();
    const account = test.normalized.accounts[0];
    account.modernSources[0].timestamps.createdAt = "2020-01-01T00:00:00Z";
    account.modernSources[0].timestamps.updatedAt = "2024-01-01T00:00:00Z";
    account.modernSources.push({
      source: {
        ...account.modernSources[0].source,
        legacyIdType: "string",
        legacyIdValue: "older-linked-account",
      },
      timestamps: {
        createdAt: "2018-01-01T00:00:00Z",
        updatedAt: "2021-01-01T00:00:00Z",
        syncUpdatedAtMilliseconds: null,
      },
    });
    const plan = test.plan();
    expect(plan.accounts[0]).toMatchObject({
      createdAt: new Date("2018-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    });
    expect(plan.legacyAccounts[0].modernSources).toEqual(account.modernSources);
  });

  it.each(["user", "account"])(
    "rejects malformed historical dates on a %s instead of substituting import time",
    (kind) => {
      const test = prepared();
      if (kind === "user") {
        test.normalized.users[0].timestamps.createdAt = "invalid-user-date";
      } else {
        test.normalized.accounts[0].modernSources[0].timestamps.updatedAt =
          "invalid-account-date";
      }
      expect(test.plan).toThrow(
        `invalid-historical-date at ${kind === "user" ? "users" : "accounts"}[0]`,
      );
    },
  );

  it("does not make an unverified primary address verified because a secondary is verified", () => {
    const test = prepared();
    test.normalized.users[0].emails[0].verified = false;
    expect(test.plan().users[0].emailVerified).toBe(false);
  });

  it("retains case variants within one user but rejects cross-user address collisions", () => {
    const test = prepared();
    test.normalized.users[0].emails.push({
      value: "editor@example.test",
      verified: true,
      evidence: [],
    });
    expect(test.plan().emails).toHaveLength(4);
    test.normalized.users[1].emails.push({
      value: "EDITOR@example.test",
      verified: true,
      evidence: [],
    });
    expect(test.plan).toThrow("email-owned-by-multiple-users at users[1]");
  });

  it("rejects a provider subject assigned to a second user", () => {
    const test = prepared();
    test.normalized.accounts[1].providerAccountId =
      test.normalized.accounts[0].providerAccountId;
    expect(test.plan).toThrow("duplicate-provider-identity");
  });

  it("rejects a repeated source user before creating a second profile", () => {
    const test = prepared();
    test.normalized.users.push(structuredClone(test.normalized.users[0]));
    expect(test.plan).toThrow("duplicate-user at users[2]");
  });

  it.each(["unmapped-user", "account-alias"])(
    "rejects a provider account whose user reference is %s",
    (kind) => {
      const test = prepared();
      test.normalized.accounts[1].user =
        kind === "unmapped-user"
          ? {
              ...test.normalized.users[1].source,
              legacyIdValue: "not-an-imported-user",
            }
          : { ...test.normalized.accounts[0].modernSources[0].source };
      expect(test.plan).toThrow("unknown-account-user at accounts[1]");
    },
  );

  it("rejects a user left without an imported provider rather than inferring a login", () => {
    const test = prepared();
    test.normalized.accounts.pop();
    expect(test.plan).toThrow("user-without-provider at users[1]");
  });

  it("rejects an empty provider subject before allocating its account identity", () => {
    const test = prepared();
    test.normalized.accounts[0].providerAccountId = "";
    expect(test.plan).toThrow("missing-provider-subject at accounts[0]");
  });

  it("rejects conflicting durable aliases and duplicate canonical identities", () => {
    const test = prepared();
    test.ids.set(
      sourceKey(test.normalized.users[0].adapterIdReference!),
      createUuidV7(),
    );
    expect(test.plan).toThrow("conflicting-alias");
    test.ids.delete(sourceKey(test.normalized.users[0].adapterIdReference!));
    test.ids.set(
      sourceKey(test.normalized.users[1].source),
      test.lookup(test.normalized.users[0].source)!,
    );
    expect(test.plan).toThrow("canonical-id-reused");
  });

  it("rejects two provider identities claiming the same previously unmapped account alias", () => {
    const test = prepared();
    const source = test.normalized.accounts[0].modernSources[0];
    expect(test.lookup(source.source)).toBeNull();
    test.normalized.accounts[1].modernSources.push(structuredClone(source));
    expect(test.plan).toThrow("conflicting-alias at accounts[1]");
  });

  it("deduplicates agreeing aliases and accepts uppercase durable UUID spellings", () => {
    const test = prepared();
    for (const [source, id] of test.ids) test.ids.set(source, id.toUpperCase());
    const first = test.normalized.users[0];
    test.ids.set(
      sourceKey(first.adapterIdReference!),
      test.lookup(first.source)!,
    );
    const source = test.normalized.accounts[0].modernSources[0];
    test.normalized.accounts[0].modernSources.push(structuredClone(source));
    const plan = test.plan();
    expect(
      plan.aliases.filter(
        (alias) => sourceKey(alias.source) === sourceKey(source.source),
      ),
    ).toHaveLength(1);
    expect(plan.users[0].id).toBe(test.lookup(first.source)!.toLowerCase());
    expect(
      plan.aliases.every(
        (alias) => alias.canonicalId === alias.canonicalId.toLowerCase(),
      ),
    ).toBe(true);
  });

  it("rejects a provider account reusing a user UUID", () => {
    const test = prepared();
    test.ids.set(
      sourceKey(legacyProviderAlias(test.normalized.accounts[0])),
      test.lookup(test.normalized.users[0].source)!,
    );
    expect(test.plan).toThrow("canonical-id-reused at accounts[0]");
  });

  it.each(["source", "adapter"])(
    "rejects a malformed durable UUID for a %s alias",
    (kind) => {
      const test = prepared();
      const user = test.normalized.users[0];
      test.ids.set(
        sourceKey(kind === "source" ? user.source : user.adapterIdReference!),
        "not-a-canonical-uuid",
      );
      expect(test.plan).toThrow(
        kind === "source"
          ? "missing-or-invalid-canonical-id at users[0]"
          : "conflicting-alias at users[0].adapterIdReference",
      );
    },
  );

  it("never guesses an unmapped source or provider identity", () => {
    const test = prepared();
    test.ids.delete(
      sourceKey(legacyProviderAlias(test.normalized.accounts[1])),
    );
    expect(test.plan).toThrow("missing-or-invalid-canonical-id");
  });

  it("rejects unreviewed providers and incomplete required user data", () => {
    const test = prepared();
    test.normalized.accounts[0].provider = "github";
    expect(test.plan).toThrow("unreviewed-provider");
    test.normalized.accounts[0].provider = "google";
    test.normalized.users[1].primaryEmail = null;
    expect(test.plan).toThrow("missing-primary-email");
    test.normalized.users[1].primaryEmail = "reader@example.test";
    test.normalized.users[1].name = null;
    test.normalized.users[1].displayName = null;
    expect(test.plan).toThrow("missing-name");
  });

  it.each([
    ["malformed", "invalid-email"],
    ["missing-primary-evidence", "missing-primary-email-evidence"],
    ["duplicate-provenance", "duplicate-email-provenance"],
  ])("rejects %s email evidence", (kind, error) => {
    const test = prepared();
    const user = test.normalized.users[0];
    if (kind === "malformed") user.primaryEmail = "not an email@example.test";
    if (kind === "missing-primary-evidence")
      user.primaryEmail = "unrecorded@example.test";
    if (kind === "duplicate-provenance")
      user.emails.push(structuredClone(user.emails[0]));
    expect(test.plan).toThrow(`${error} at users[0]`);
  });

  it("requires a complete separate app-access projection and never coerces flags", () => {
    const test = prepared();
    const rows = test.normalized.users.map((user, index) => ({
      source: user.source,
      admin: index === 0 ? true : undefined,
    }));
    const plan = test.plan();
    expect(planLegacyUserAccess(rows, plan, test.lookup)).toEqual([
      { userId: plan.users[0].id, admin: true },
      { userId: plan.users[1].id, admin: false },
    ]);
    expect(() => planLegacyUserAccess([], plan, test.lookup)).toThrow(
      "missing-access-user",
    );
    expect(() =>
      planLegacyUserAccess([rows[0], rows[0]], plan, test.lookup),
    ).toThrow("unknown-or-duplicate-access-user");
    expect(() =>
      planLegacyUserAccess(
        [{ source: rows[0].source, admin: "true" as unknown as boolean }],
        plan,
        test.lookup,
      ),
    ).toThrow("invalid-admin-flag");
  });
});
