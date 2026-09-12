import { createHash } from "node:crypto";
import { ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { fixture, source, sourceKey } from "../../tests/ritualFixtures";
import {
  getRitualAccess,
  type RitualPolicy,
  type RitualPrincipal,
} from "../doc/access";
import { createUuidV7 } from "../lib/ids";
import {
  LegacyRitualImportError,
  planLegacyRitualImport,
} from "./planLegacyRitualImport";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("legacy ritual import planning", () => {
  it("preserves every exact source/date and original compiled field without claiming parity", () => {
    const test = fixture();
    const plan = planLegacyRitualImport(test.input, test.options());
    expect(plan.revisions).toHaveLength(6);
    plan.revisions.forEach((revision, i) => {
      expect(revision.source).toBe(test.input.revisions[i].text);
      expect(revision.sourceSha256).toBe(hash(revision.source));
      expect(revision.createdAt).toEqual(test.input.revisions[i].createdAt);
      expect(revision.createdAt).not.toBe(test.input.revisions[i].createdAt);
      expect(revision.sourceFormatVersion).toBe("legacy-unversioned");
      expect(revision).not.toHaveProperty("compiled");
    });
    plan.archives.forEach((archive, i) => {
      expect(archive.contentJson).toBe(
        JSON.stringify(test.input.rituals[i].doc),
      );
      expect(archive.contentSha256).toBe(hash(archive.contentJson));
      expect(archive.contentJson).toContain('"forMe":true');
      expect(archive.contentJson).toContain('"forMe":false');
    });
    expect(plan.parityRequired).toEqual(
      plan.rituals.map((ritual) => ritual.id),
    );
    expect(
      plan.rituals.every(
        (ritual) => ritual.currentRevisionId === null && ritual.version === 0,
      ),
    ).toBe(true);
    expect(plan.currentRevisions).toHaveLength(3);
    expect(plan.rituals[0].updatedAt?.getTime()).toBe(
      plan.revisions[1].updatedAt!.getTime() + 2,
    );
  });

  it("keeps the known orphan null with exact typed evidence and preserves all authors", () => {
    const test = fixture();
    const plan = planLegacyRitualImport(test.input, test.options());
    expect(plan.rituals[2].creatorId).toBeNull();
    expect(plan.evidence[2].references).toContainEqual({
      field: "userId",
      source: source("users", test.orphan),
      canonicalId: null,
    });
    expect(plan.evidence[2].transformations).toContain(
      "known-orphan-creator-retained-as-null-v1",
    );
    expect(
      plan.revisions.every((revision) =>
        test.options().canonicalUserIds.includes(revision.authorId!),
      ),
    ).toBe(true);
    expect(
      plan.aliases.some(
        (alias) =>
          sourceKey(alias.source) === sourceKey(source("users", test.orphan)),
      ),
    ).toBe(false);
  });

  it("records public/group irrelevant grades and missing temple grade without changing effective access", () => {
    const test = fixture();
    delete test.input.rituals[2].minGrade;
    const plan = planLegacyRitualImport(test.input, test.options());
    expect(plan.evidence[0].ignoredMinGradeJson).toBe("0");
    expect(plan.rituals[0]).toMatchObject({ scope: "public", minGrade: null });
    expect(plan.rituals[2]).toMatchObject({ scope: "temple", minGrade: 0 });
    expect(plan.evidence[2].transformations).toContain(
      "absent-temple-grade-defaulted-zero-v1",
    );
    const policy: RitualPolicy = {
      id: plan.rituals[2].id,
      creatorId: null,
      scope: {
        kind: "temple",
        templeId: plan.rituals[2].templeId!,
        minGrade: 0,
      },
    };
    const member: RitualPrincipal = {
      userId: test.options().canonicalUserIds[0],
      globalAdmin: false,
      groupIds: [],
      groupAdminIds: [],
      templeMemberships: [
        {
          templeId: policy.scope.kind === "temple" ? policy.scope.templeId : "",
          grade: 0,
          admin: false,
        },
      ],
    };
    expect(getRitualAccess(policy, member)).toEqual({
      read: true,
      edit: false,
      readSourceHistory: false,
    });
    expect(getRitualAccess(policy, null).read).toBe(false);
  });

  it("reuses canonical aliases including the declared current-revision conversion", () => {
    const test = fixture();
    for (const [key, id] of test.ids) test.ids.set(key, id.toUpperCase());
    const first = planLegacyRitualImport(test.input, test.options());
    for (const alias of first.aliases)
      test.ids.set(sourceKey(alias.source), alias.canonicalId);
    expect(planLegacyRitualImport(test.input, test.options())).toEqual(first);
    const currentAlias = first.aliases.find(
      (alias) =>
        sourceKey(alias.source) ===
        sourceKey(source("docRevisions", test.revisionIds[1].toHexString())),
    )!;
    expect(currentAlias.canonicalId).toBe(first.revisions[1].id);
    expect(
      first.aliases.every(
        (alias) => alias.canonicalId === alias.canonicalId.toLowerCase(),
      ),
    ).toBe(true);
  });

  it("accepts explicitly preallocated author aliases without globally equating string/ObjectId text", () => {
    const test = fixture();
    test.input.revisions[0].userId = test.users[0].toHexString();
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /unresolved-reference/,
    );
    test.ids.set(
      sourceKey(source("users", test.users[0].toHexString())),
      test.options().canonicalUserIds[0],
    );
    expect(
      planLegacyRitualImport(test.input, test.options()).revisions[0].authorId,
    ).toBe(test.options().canonicalUserIds[0]);
  });

  it("refuses competing typed current-revision entities instead of choosing by equal text", () => {
    const test = fixture();
    const current = test.revisionIds[1].toHexString();
    test.input.revisions.push({ ...test.input.revisions[1], _id: current });
    test.ids.set(sourceKey(source("docRevisions", current)), createUuidV7());
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /ambiguous-revision-reference/,
    );
  });

  it("keeps absent historical creator and timestamps explicit without a clock fallback", () => {
    const test = fixture();
    delete test.input.rituals[0].userId;
    delete test.input.rituals[0].createdAt;
    test.input.rituals[0].updatedAt = null;
    const plan = planLegacyRitualImport(test.input, test.options());
    expect(plan.rituals[0]).toMatchObject({
      creatorId: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(plan.evidence[0].presentFields).not.toContain("userId");
  });

  it.each([
    [
      "unknown field",
      (t: ReturnType<typeof fixture>) => {
        t.input.rituals[0].privateUnknownField = "private";
      },
      "unclassified-fields",
    ],
    [
      "deleted marker",
      (t) => {
        t.input.revisions[0].__deleted = false;
      },
      "unclassified-fields",
    ],
    [
      "unknown author",
      (t) => {
        t.input.revisions[0].userId = new ObjectId();
      },
      "unresolved-reference",
    ],
    [
      "unknown parent",
      (t) => {
        t.input.revisions[0].docId = new ObjectId();
      },
      "unresolved-reference",
    ],
    [
      "wrong current parent",
      (t) => {
        t.input.rituals[0].docRevisionId = t.revisionIds[3].toHexString();
      },
      "invalid-current-revision",
    ],
    [
      "missing current",
      (t) => {
        delete t.input.rituals[0].docRevisionId;
      },
      "invalid-object",
    ],
    [
      "older current",
      (t) => {
        t.input.rituals[0].docRevisionId = t.revisionIds[0].toHexString();
      },
      "current-revision-not-latest",
    ],
    [
      "combined scope",
      (t) => {
        t.input.rituals[1].templeId = t.temple;
      },
      "combined-scope",
    ],
    [
      "null scope",
      (t) => {
        t.input.rituals[1].groupId = null;
      },
      "invalid-object",
    ],
    [
      "missing scope target",
      (t) => {
        t.input.rituals[1].groupId = new ObjectId();
      },
      "unresolved-reference",
    ],
    [
      "negative grade",
      (t) => {
        t.input.rituals[2].minGrade = -1;
      },
      "invalid-grade",
    ],
    [
      "fractional grade",
      (t) => {
        t.input.rituals[2].minGrade = 0.5;
      },
      "invalid-grade",
    ],
    [
      "null grade",
      (t) => {
        t.input.rituals[2].minGrade = null;
      },
      "invalid-grade",
    ],
    [
      "missing author date",
      (t) => {
        delete t.input.revisions[0].createdAt;
      },
      "missing-date",
    ],
    [
      "invalid date",
      (t) => {
        t.input.revisions[0].updatedAt = new Date(NaN);
      },
      "invalid-date",
    ],
    [
      "string date",
      (t) => {
        t.input.rituals[0].createdAt = "2020-01-01";
      },
      "invalid-date",
    ],
    [
      "null sync",
      (t) => {
        t.input.revisions[0].__updatedAt = null;
      },
      "invalid-sync-timestamp",
    ],
    [
      "NUL source",
      (t) => {
        t.input.revisions[0].text = "p\0secret";
      },
      "unrepresentable-text",
    ],
    [
      "lone surrogate source",
      (t) => {
        t.input.revisions[0].text = "p\uD800";
      },
      "unrepresentable-text",
    ],
    [
      "nonstring source",
      (t) => {
        t.input.revisions[0].text = {};
      },
      "invalid-text",
    ],
    [
      "nonstring title",
      (t) => {
        t.input.rituals[0].title = 1;
      },
      "invalid-text",
    ],
    [
      "Date content",
      (t) => {
        t.input.rituals[0].doc = { typed: new Date() };
      },
      "non-json-content",
    ],
    [
      "undefined content",
      (t) => {
        t.input.rituals[0].doc = { dropped: undefined };
      },
      "non-json-content",
    ],
    [
      "negative zero",
      (t) => {
        t.input.rituals[0].doc = { lost: -0 };
      },
      "non-json-content",
    ],
    [
      "sparse array",
      (t) => {
        t.input.rituals[0].doc = { children: new Array(1) };
      },
      "non-json-content",
    ],
    [
      "cyclic content",
      (t) => {
        const cycle = { children: [] as unknown[] };
        cycle.children.push(cycle);
        t.input.rituals[0].doc = cycle;
      },
      "non-json-content",
    ],
    [
      "absent compiled",
      (t) => {
        delete t.input.rituals[0].doc;
      },
      "invalid-object",
    ],
  ] satisfies [string, (test: ReturnType<typeof fixture>) => void, string][])(
    "rejects %s without leaking raw input",
    (_name, mutate, code) => {
      const test = fixture();
      mutate(test);
      try {
        planLegacyRitualImport(test.input, test.options());
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(LegacyRitualImportError);
        expect((error as LegacyRitualImportError).code).toBe(code);
        expect((error as Error).message).not.toMatch(
          /Synthetic|private|secret/,
        );
      }
    },
  );

  it("rejects malformed import envelopes, canonical maps and declaration shapes", () => {
    const test = fixture();
    expect(() =>
      planLegacyRitualImport(
        { rituals: null, revisions: [] } as never,
        test.options(),
      ),
    ).toThrow(/invalid-input-arrays/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        canonicalUserIds: null,
      } as never),
    ).toThrow(/invalid-options/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        canonicalGroupIds: ["not-uuid"],
      }),
    ).toThrow(/invalid-canonical-set/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        importedAt: new Date(NaN),
      }),
    ).toThrow(/invalid-date/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        unresolvedCreators: [
          {
            ritual: source("temples", test.temple),
            creator: source("users", test.orphan),
          },
        ],
      }),
    ).toThrow(/invalid-declared-reference/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        unresolvedCreators: [
          ...test.options().unresolvedCreators,
          ...test.options().unresolvedCreators,
        ],
      }),
    ).toThrow(/duplicate-orphan-declaration/);
    test.ids.delete(sourceKey(source("docs", test.ritualIds[0])));
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /missing-canonical-alias/,
    );
    test.ids.set(
      sourceKey(source("docs", test.ritualIds[0])),
      "invalid UUID alias",
    );
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /invalid-canonical-alias/,
    );
  });

  it("refuses malformed typed IDs and lossy JSON payloads", () => {
    for (const id of [
      { fake: true },
      { _bsontype: "ObjectId", toHexString: () => "invalid" },
      {
        _bsontype: "ObjectId",
        toHexString: () => {
          throw new Error("private underlying failure");
        },
      },
      "bad\0id",
    ]) {
      const test = fixture();
      test.input.revisions[0]._id = id;
      expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
        LegacyRitualImportError,
      );
    }
    const test = fixture();
    test.input.rituals[0].doc = { [Symbol("private key")]: true };
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /non-json-content/,
    );
    test.input.rituals[0].doc = {
      children: Object.assign(new Array(1), { other: true }),
    };
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /non-json-content/,
    );
    test.input.rituals[0].doc = { children: [{ numeric: 1, empty: null }] };
    expect(
      JSON.parse(
        planLegacyRitualImport(test.input, test.options()).archives[0]
          .contentJson!,
      ),
    ).toEqual(test.input.rituals[0].doc);
  });

  it("refuses missing, unexpected, resolved and unused orphan declarations", () => {
    const test = fixture();
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        unresolvedCreators: [],
      }),
    ).toThrow(/unapproved-orphan/);
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...test.options(),
        unresolvedCreators: [
          {
            ritual: source("docs", test.ritualIds[0]),
            creator: source("users", test.orphan),
          },
        ],
      }),
    ).toThrow(/resolved-orphan/);
    test.ids.set(
      sourceKey(source("users", test.orphan)),
      test.options().canonicalUserIds[0],
    );
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /resolved-orphan/,
    );
    test.ids.delete(sourceKey(source("users", test.orphan)));
    delete test.input.rituals[2].userId;
    expect(() => planLegacyRitualImport(test.input, test.options())).toThrow(
      /unused-orphan/,
    );
  });

  it("rejects case-variant duplicate IDs and conflicting current-reference remaps", () => {
    const test = fixture();
    const options = test.options();
    expect(() =>
      planLegacyRitualImport(test.input, {
        ...options,
        canonicalUserIds: [
          ...options.canonicalUserIds,
          options.canonicalUserIds[0].toUpperCase(),
        ],
      }),
    ).toThrow(/duplicate-canonical/);
    const first = test.lookup(source("docs", test.ritualIds[0]))!;
    test.ids.set(
      sourceKey(source("docs", test.ritualIds[1])),
      first.toUpperCase(),
    );
    expect(() => planLegacyRitualImport(test.input, options)).toThrow(
      /duplicate-canonical/,
    );
    const other = fixture();
    other.ids.set(
      sourceKey(source("docRevisions", other.revisionIds[1].toHexString())),
      createUuidV7(),
    );
    expect(() => planLegacyRitualImport(other.input, other.options())).toThrow(
      /alias-conflict/,
    );
  });
});
