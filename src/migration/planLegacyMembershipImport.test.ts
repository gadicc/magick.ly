import { ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { fixture, source, sourceKey } from "../../tests/membershipFixtures";
import { getRitualAccess, type RitualPrincipal } from "../doc/access";
import { createUuidV7 } from "../lib/ids";
import { planLegacyMembershipImport } from "./planLegacyMembershipImport";

describe("legacy membership planning", () => {
  it.each([
    [null, "missing-import-time"],
    [new Date(NaN), "invalid-date"],
  ])(
    "refuses missing or invalid import bookkeeping (%s)",
    (importedAt, code) => {
      const test = fixture();
      expect(() =>
        planLegacyMembershipImport(test.input, {
          ...test.options(),
          importedAt: importedAt as Date,
        }),
      ).toThrow(code);
    },
  );

  it("refuses a noncanonical auth user set instead of inventing membership identities", () => {
    const test = fixture();
    expect(() =>
      planLegacyMembershipImport(test.input, {
        ...test.options(),
        canonicalUserIds: ["550e8400-e29b-41d4-a716-446655440000"],
      }),
    ).toThrow("invalid-user-set");
  });

  it.each([null, [], "unexpected serialized row"])(
    "rejects malformed domain records before allocating relationships (%s)",
    (value) => {
      const test = fixture();
      test.input.groups = [value];
      expect(() =>
        planLegacyMembershipImport(test.input, test.options()),
      ).toThrow("invalid-object at groups[0]");
    },
  );

  it.each(["", {}, { _bsontype: "ObjectId", toHexString: () => "bad" }])(
    "rejects empty or malformed BSON source identities (%s)",
    (value) => {
      const test = fixture();
      (test.input.groups[0] as Record<string, unknown>)._id = value;
      expect(() =>
        planLegacyMembershipImport(test.input, test.options()),
      ).toThrow("invalid-source-id");
    },
  );

  it("rejects a user projection claiming a group source or repeating an authenticated identity", () => {
    const test = fixture();
    const original = test.input.users[0];
    test.input.users = [
      { ...original, source: source("userGroups", test.group) },
      ...test.input.users.slice(1),
    ];
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("invalid-user-source");
    test.input.users = [original, original, ...test.input.users.slice(1)];
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("unknown-or-duplicate-user");
  });

  it.each([null, "group-id"])(
    "does not coerce a malformed group grant array (%s)",
    (value) => {
      const test = fixture();
      test.input.users[0].groupIds = value;
      expect(() =>
        planLegacyMembershipImport(test.input, test.options()),
      ).toThrow("invalid-array");
    },
  );

  it("rejects an invalid label, empty URL slug or fractional synchronization timestamp", () => {
    const test = fixture();
    const group = test.input.groups[0] as Record<string, unknown>;
    group.name = null;
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("invalid-text");
    group.name = "Synthetic group";
    group.__updatedAt = 1.5;
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("invalid-sync-timestamp");
    group.__updatedAt = 100;
    (test.input.temples[0] as Record<string, unknown>).slug = "   ";
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("empty-slug");
  });

  it("canonicalizes UUID spelling from both auth and durable aliases without mutating either", () => {
    const test = fixture();
    const expected = planLegacyMembershipImport(test.input, test.options());
    const groupId = test.lookup(source("userGroups", test.group))!;
    test.ids.set(
      sourceKey(source("userGroups", test.group.toHexString())),
      groupId.toUpperCase(),
    );
    const actual = planLegacyMembershipImport(test.input, {
      ...test.options(),
      canonicalUserIds: test
        .options()
        .canonicalUserIds.map((id) => id.toUpperCase()),
      lookup: (ref) => test.lookup(ref)?.toUpperCase() ?? null,
    });
    expect(actual).toEqual(expected);
    expect(test.lookup(source("userGroups", test.group.toHexString()))).toBe(
      groupId.toUpperCase(),
    );
  });

  it("does not let UUID case variants evade duplicate auth or entity identity checks", () => {
    const test = fixture();
    const duplicate = "0198bcde-aaaa-7bbb-8ccc-ddddeeeeefff";
    expect(() =>
      planLegacyMembershipImport(test.input, {
        ...test.options(),
        canonicalUserIds: [duplicate, duplicate.toUpperCase()],
      }),
    ).toThrow("invalid-user-set");
    test.ids.set(sourceKey(source("userGroups", test.group)), duplicate);
    const extra = new ObjectId("100000000000000000000002");
    test.input.groups = [
      ...test.input.groups,
      { _id: extra, name: "Another group" },
    ];
    test.ids.set(
      sourceKey(source("userGroups", extra)),
      duplicate.toUpperCase(),
    );
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("duplicate-canonical-identity");
  });

  it("preserves independent flags, typed duplicate evidence, metadata and private invite separation", () => {
    const test = fixture();
    const original = JSON.stringify(test.input);
    const plan = planLegacyMembershipImport(test.input, test.options());
    expect(plan.grants.map(({ member, admin }) => ({ member, admin }))).toEqual(
      [
        { member: true, admin: false },
        { member: false, admin: true },
      ],
    );
    expect(
      plan.grantEvidence[0].groupReferences.map((ref) => ref.legacyIdType),
    ).toEqual(["string", "objectid"]);
    expect(plan.grantEvidence[1]).toMatchObject({
      groupIdsPresent: false,
      groupAdminIdsPresent: true,
    });
    expect(plan.grantEvidence[2].groupReferences).toEqual([]);
    expect(
      plan.aliases.filter(({ source: ref }) => ref.entityType === "userGroups"),
    ).toHaveLength(2);
    expect(plan.temples[0]).toMatchObject({
      slug: "Temple-Example",
      createdById: null,
      createdAt: null,
    });
    expect(JSON.stringify(plan.temples)).not.toContain(
      "synthetic-invitation-only",
    );
    expect(plan.invites).toEqual([
      { templeId: plan.temples[0].id, joinPass: "synthetic-invitation-only" },
    ]);
    expect(plan.groups[0].legacySyncUpdatedAtMilliseconds).toBe(
      1_700_000_000_000,
    );
    expect(plan.memberships[0]).toMatchObject({
      grade: 0,
      admin: false,
      motto: "",
      memberSince: null,
    });
    expect(plan.memberships[1].memberSince).toEqual(
      new Date("2019-06-07T08:09:10.111Z"),
    );
    expect(plan.memberships[0].addedAt).toEqual(
      new Date("2020-01-02T03:04:05.678Z"),
    );
    expect(
      plan.evidence.find((entry) => entry.source.entityType === "temples")
        ?.presentFields,
    ).not.toContain("createdBy");
    expect(planLegacyMembershipImport(test.input, test.options())).toEqual(
      plan,
    );
    expect(JSON.stringify(test.input)).toBe(original);
    expect(plan.memberships[0].addedAt).not.toBe(
      (test.input.memberships[0] as Record<string, unknown>).addedAt,
    );
  });

  it("projects the accepted admin-only grant without inventing membership or grade access", () => {
    const test = fixture();
    const plan = planLegacyMembershipImport(test.input, test.options());
    const userId = test.options().canonicalUserIds[1];
    const grants = plan.grants.filter((grant) => grant.userId === userId);
    const principal: RitualPrincipal = {
      userId,
      globalAdmin: false,
      groupIds: grants
        .filter((grant) => grant.member)
        .map((grant) => grant.groupId),
      groupAdminIds: grants
        .filter((grant) => grant.admin)
        .map((grant) => grant.groupId),
      templeMemberships: [],
    };
    expect(principal.groupIds).toEqual([]);
    expect(
      getRitualAccess(
        {
          id: "synthetic-ritual",
          creatorId: null,
          scope: { kind: "group", groupId: plan.groups[0].id },
        },
        principal,
      ),
    ).toEqual({ read: true, edit: true, readSourceHistory: true });
    expect(
      getRitualAccess(
        {
          id: "synthetic-ritual",
          creatorId: null,
          scope: { kind: "temple", templeId: plan.temples[0].id, minGrade: 1 },
        },
        {
          ...principal,
          templeMemberships: [
            { templeId: plan.temples[0].id, grade: 0, admin: false },
          ],
        },
      ).read,
    ).toBe(false);
  });

  it("rejects ambiguous string/ObjectId group entities and preexisting conflicting aliases", () => {
    const test = fixture();
    const collision = test.group.toHexString();
    test.input.groups = [
      ...test.input.groups,
      { _id: collision, name: "Different synthetic group" },
    ];
    test.ids.set(sourceKey(source("userGroups", collision)), createUuidV7());
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("ambiguous-group-reference");
    test.input.groups = test.input.groups.slice(0, 1);
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("alias-conflict");
  });

  it("accepts declared user aliases but never guesses unclaimed cross-type user references", () => {
    const test = fixture();
    const membership = test.input.memberships[0] as Record<string, unknown>;
    membership.userId = test.users[0].toHexString();
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("missing-canonical-alias");
    test.ids.set(
      sourceKey(source("users", membership.userId as string)),
      test.options().canonicalUserIds[0],
    );
    expect(
      planLegacyMembershipImport(test.input, test.options()).memberships[0]
        .userId,
    ).toBe(test.options().canonicalUserIds[0]);
  });

  it("refuses duplicate user/temple records rather than choosing a grade or admin flag", () => {
    const test = fixture();
    (test.input.memberships[1] as Record<string, unknown>).userId =
      test.users[0];
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("duplicate-temple-membership");
  });

  it.each([
    ["grade", -1, "invalid-grade"],
    ["grade", 0.5, "invalid-grade"],
    ["grade", "0", "invalid-grade"],
    ["admin", "true", "invalid-admin"],
    ["addedAt", undefined, "missing-added-at"],
    ["memberSince", "2020-01-01", "invalid-date"],
    ["memberSince", new Date(NaN), "invalid-date"],
  ])("rejects invalid %s without coercion", (field, value, error) => {
    const test = fixture();
    (test.input.memberships[0] as Record<string, unknown>)[field] = value;
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow(error);
  });

  it("requires every auth user, even when their grant arrays are absent", () => {
    const test = fixture();
    test.input.users = [];
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("missing-user-grant-projection");
  });

  it("rejects unresolved membership references and a supplied unknown creator", () => {
    const test = fixture();
    (test.input.memberships[0] as Record<string, unknown>).templeId =
      new ObjectId("300000000000000000000009");
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("unresolved-temple");
    (test.input.memberships[0] as Record<string, unknown>).templeId =
      test.temple;
    (test.input.temples[0] as Record<string, unknown>).createdBy = new ObjectId(
      "200000000000000000000009",
    );
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("missing-canonical-alias");
  });

  it("detects normalized slug collisions while preserving old URL spelling", () => {
    const test = fixture();
    const extra = new ObjectId("300000000000000000000002");
    test.ids.set(sourceKey(source("temples", extra)), createUuidV7());
    test.input.temples = [
      ...test.input.temples,
      { _id: extra, name: "Another", slug: " temple-example " },
    ];
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("duplicate-normalized-slug");
  });

  it("matches PostgreSQL btrim for tabs, nonbreaking spaces and spaces before newlines", () => {
    const test = fixture();
    const slugs = [
      "\tTemple-Example\t",
      "\u00a0Temple-Example\u00a0",
      "Temple-Example \n",
      "Temple-Example\n",
    ];
    for (const [i, slug] of slugs.entries()) {
      const id = new ObjectId(`30000000000000000000000${i + 2}`);
      test.ids.set(sourceKey(source("temples", id)), createUuidV7());
      test.input.temples = [
        ...test.input.temples,
        {
          _id: id,
          name: "Exact legacy spelling",
          slug,
        },
      ];
    }
    const plan = planLegacyMembershipImport(test.input, test.options());
    expect(plan.temples.map((temple) => temple.slug)).toEqual([
      "Temple-Example",
      ...slugs,
    ]);
  });

  it("refuses unknown fields and reports no private values in errors", () => {
    const test = fixture();
    (test.input.temples[0] as Record<string, unknown>)[
      "synthetic-private-field"
    ] = "synthetic-invitation-only";
    expect(() =>
      planLegacyMembershipImport(test.input, test.options()),
    ).toThrow("unclassified-fields at temples[0]");
    try {
      planLegacyMembershipImport(test.input, test.options());
    } catch (error) {
      expect(String(error)).not.toMatch(
        /synthetic-private-field|synthetic-invitation-only/,
      );
    }
  });

  it("does not collapse string primary IDs into similarly written ObjectIds", () => {
    const test = fixture();
    const extra = test.group.toHexString();
    test.ids.set(sourceKey(source("userGroups", extra)), createUuidV7());
    test.input.groups = [
      ...test.input.groups,
      { _id: extra, name: "Same label allowed" },
    ];
    test.input.users = test.input.users.map((entry) => ({
      source: entry.source,
    }));
    const plan = planLegacyMembershipImport(test.input, test.options());
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0].id).not.toBe(plan.groups[1].id);
  });
});
