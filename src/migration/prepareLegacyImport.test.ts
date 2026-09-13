import { isDeepStrictEqual } from "node:util";
import { EJSON, ObjectId } from "bson";
import { describe, expect, it, vi } from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import { isUuidV7 } from "../lib/ids";
import { serializeLegacyImportValue } from "./legacyImportValue";
import {
  LEGACY_IMPORT_COLLECTIONS,
  type LegacyImportCollections,
  prepareLegacyImport,
} from "./prepareLegacyImport";

type Fixture = ReturnType<typeof legacyImportFixture>;
type Row = Record<string, unknown>;
function failure(change: (fixture: Fixture) => void) {
  const f = legacyImportFixture();
  change(f);
  expect(() => prepareLegacyImport(f.input, f.options)).toThrow();
}
describe("complete protected import preparation", () => {
  it("retains unused historical profile fields and photo-provider labels exactly", () => {
    const f = legacyImportFixture();
    const user = f.users[0] as Row;
    user.locale = "\uFEFF en_GB ";
    user.gender = null;
    (user.photos as Row[])[0].provider = "legacy-label";
    (
      (user.services as Row[])[0].profile as { photos: Row[] }
    ).photos[0].provider = "google";
    const p = prepareLegacyImport(f.input, f.options);
    expect(p.sourceDispositions.legacyUserFields).toEqual([
      {
        source: {
          sourceSystem: "mongodb",
          entityType: "users",
          legacyIdType: "objectid",
          legacyIdValue: f.users[0]._id.toHexString(),
        },
        fields: [
          { path: "locale", value: "\uFEFF en_GB " },
          { path: "gender", value: null },
          { path: "photos[0].provider", value: "legacy-label" },
          { path: "services[0].profile.photos[0].provider", value: "google" },
        ],
      },
    ]);
    expect(p.auth.users[0]).not.toHaveProperty("gender");
  });
  it("joins real domain planners without losing source, ownership or archive evidence", () => {
    const f = legacyImportFixture();
    const source = EJSON.stringify(f.input, { relaxed: false });
    const p = prepareLegacyImport(f.input, f.options);
    expect(p.auth.users).toHaveLength(2);
    expect(p.auth.accounts).toHaveLength(2);
    expect(p.auth.emails).toHaveLength(4);
    expect(p.access).toEqual(
      p.auth.users.map((u, i) => ({ userId: u.id, admin: i === 0 })),
    );
    expect(p.discourse.links[0]).toMatchObject({
      userId: p.auth.users[0].id,
      discourseUserId: Number.MAX_SAFE_INTEGER,
    });
    expect(p.memberships.grants).toEqual([
      {
        userId: p.auth.users[0].id,
        groupId: p.memberships.groups[0].id,
        member: true,
        admin: false,
      },
      {
        userId: p.auth.users[1].id,
        groupId: p.memberships.groups[0].id,
        member: false,
        admin: true,
      },
    ]);
    expect(p.memberships.invites[0].joinPass).toBe(
      "preserved-private-invitation",
    );
    expect(p.memberships.memberships[0].grade).toBe(0);
    expect(p.rituals.rituals).toHaveLength(3);
    expect(p.rituals.revisions).toHaveLength(6);
    expect(p.rituals.archives).toHaveLength(3);
    expect(p.rituals.rituals[2].creatorId).toBeNull();
    expect(p.rituals.revisions.map((r) => r.source)).toEqual(
      f.input.docRevisions.map((r) => (r as Row).text),
    );
    expect(
      p.rituals.rituals.every(
        (r) => r.currentRevisionId === null && r.version === 0,
      ),
    ).toBe(true);
    expect(p.rituals.currentRevisions).toHaveLength(3);
    expect(p.study.progress).toHaveLength(2);
    expect(p.study.snapshots).toHaveLength(3);
    expect(p.study.cards).toHaveLength(5);
    const studyAliases = p.aliases.filter(
      (a) => a.source.entityType === "studySet",
    );
    expect(studyAliases).toHaveLength(3);
    expect(new Set(studyAliases.map((a) => a.canonicalId)).size).toBe(2);
    expect(p.files.files[0]).toMatchObject({
      ownerId: null,
      ownerType: null,
      visibility: "public",
      originalFilename: "\uFEFF exact image.svg",
    });
    expect(p.files.snapshots[0].sourceObjectKey).toBe(
      `synthetic-legacy/${"a".repeat(64)}`,
    );
    expect(p.sourceDispositions.ritualWriteReceipts).toBe("absent-reviewed");
    expect(p.sourceDispositions.auth.counts).toEqual({
      sessionRowsDiscarded: 1,
      strategyRowsExcluded: 1,
      embeddedTokenFieldsDropped: 4,
      providerProfileSubtreesDropped: 4,
      modernOauthFieldsDropped: 12,
    });
    expect(p.sourceDispositions.excludedAccounts).toHaveLength(1);
    const encoded = serializeLegacyImportValue(p);
    expect(encoded).not.toContain(importSecret);
    expect(EJSON.stringify(f.input, { relaxed: false })).toBe(source);
    expect(
      isDeepStrictEqual(
        p,
        prepareLegacyImport(
          legacyImportFixture().input,
          legacyImportFixture().options,
        ),
      ),
    ).toBe(true);
  });
  it("allocates every canonical and provenance ID exactly once, with only approved alias sharing", () => {
    const f = legacyImportFixture(),
      p = prepareLegacyImport(f.input, f.options);
    const entityIds = [
      ...p.auth.users,
      ...p.auth.accounts,
      ...p.memberships.groups,
      ...p.memberships.temples,
      ...p.memberships.memberships,
      ...p.rituals.rituals,
      ...p.rituals.revisions,
      ...p.study.progress,
      ...p.files.files,
    ].map((row) => row.id);
    const allIds = [
      ...entityIds,
      ...p.auth.emails.map((row) => row.id),
      ...p.aliases.map((row) => row.id),
    ];
    expect(allIds.every(isUuidV7)).toBe(true);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(p.aliases.every((a) => entityIds.includes(a.canonicalId))).toBe(
      true,
    );
    expect(
      p.aliases.every(
        (a) => a.createdAt.getTime() === f.options.importedAt.getTime(),
      ),
    ).toBe(true);
    for (const group of [p.auth, p.memberships, p.rituals, p.study, p.files])
      expect(group).not.toHaveProperty("aliases");
  });
  it("copies config, dates, BSON IDs and application state before allocator callbacks", () => {
    const f = legacyImportFixture(),
      expected = prepareLegacyImport(
        legacyImportFixture().input,
        legacyImportFixture().options,
      );
    const allocator = f.options.generateId;
    f.options.generateId = () => {
      f.users[0].admin = false;
      (f.input.docs[0] as Row).title = "changed";
      (f.input.docRevisions[0] as Row).text = "changed";
      f.users[0]._id.id.fill(99);
      f.options.config.files.sourceBucket = "changed";
      f.options.importedAt.setTime(0);
      return allocator();
    };
    const actual = prepareLegacyImport(f.input, f.options);
    expect(isDeepStrictEqual(actual, expected)).toBe(true);
  });
  it("accepts a present empty receipt collection and rejects nonempty or unreviewed absence", () => {
    const f = legacyImportFixture();
    f.input.ritualWriteReceipts = [];
    f.options.config.receiptPolicy = "require-empty-collection";
    expect(
      prepareLegacyImport(f.input, f.options).sourceDispositions
        .ritualWriteReceipts,
    ).toBe("present-empty");
    failure((f) => {
      f.options.config.receiptPolicy = "require-empty-collection";
    });
    failure((f) => {
      f.input.ritualWriteReceipts = [{ _id: "not-v2" }];
    });
    failure((f) => {
      f.input.ritualWriteReceipts = undefined;
    });
  });
  it("supports fully empty reviewed source without inventing identities", () => {
    const f = legacyImportFixture();
    const empty = Object.fromEntries(
      LEGACY_IMPORT_COLLECTIONS.map((key) => [key, []]),
    ) as unknown as LegacyImportCollections;
    f.options.config.emptyStudyDuplicates = [];
    f.options.config.unresolvedCreators = [];
    const generateId = vi.fn();
    const plan = prepareLegacyImport(empty, { ...f.options, generateId });
    expect(plan.aliases).toEqual([]);
    expect(generateId).not.toHaveBeenCalled();
  });
  it("uses native UUIDv7 generation when no allocator is supplied", () => {
    const f = legacyImportFixture();
    const { generateId: _, ...options } = f.options;
    expect(
      prepareLegacyImport(f.input, options).aliases.every((a) =>
        isUuidV7(a.id),
      ),
    ).toBe(true);
  });
  it("keeps distinct string and ObjectId primary identities", () => {
    const f = legacyImportFixture();
    const same = (f.input.files[0] as Row)._id as ObjectId;
    (f.input.files as Row[]).push({
      ...(f.input.files[0] as Row),
      _id: same.toHexString(),
      sha256: "b".repeat(64),
    });
    const p = prepareLegacyImport(f.input, f.options);
    expect(new Set(p.files.files.map((row) => row.id)).size).toBe(2);
  });
  it.each(LEGACY_IMPORT_COLLECTIONS)("requires the %s collection", (name) => {
    failure((f) => {
      delete (f.input as unknown as Row)[name];
    });
  });
  it.each([
    (f: Fixture) => {
      (f.input as unknown as Row).unknown = [];
    },
    (f: Fixture) => {
      (f.options as unknown as Row).unknown = true;
    },
    (f: Fixture) => {
      (f.options.config as unknown as Row).unknown = true;
    },
    (f: Fixture) => {
      f.options.importedAt = new Date("invalid");
    },
    (f: Fixture) => {
      f.options.config.profile = "wrong" as never;
    },
    (f: Fixture) => {
      f.options.config.receiptPolicy = "ignore" as never;
    },
    (f: Fixture) => {
      f.options.config.sourceForumOrigin = "https://forum.example.test/";
    },
    (f: Fixture) => {
      f.options.config.files.sourceBucket = "";
    },
    (f: Fixture) => {
      f.options.config.files.sourceObjectKeyPrefix = "no-slash";
    },
    (f: Fixture) => {
      f.options.config.emptyStudyDuplicates = [];
    },
    (f: Fixture) => {
      f.options.config.unresolvedCreators = [];
    },
    (f: Fixture) => {
      f.options.config.emptyStudyDuplicates[0].expectedArchiveSha256 =
        "0".repeat(64);
    },
    (f: Fixture) => {
      f.options.config.emptyStudyDuplicates[0].expectedArchiveSha256 =
        "invalid";
    },
    (f: Fixture) => {
      f.options.config.emptyStudyDuplicates[0].archive.entityType = "users";
    },
    (f: Fixture) => {
      f.options.config.unresolvedCreators![0].creator.legacyIdValue = "NO";
    },
    (f: Fixture) => {
      f.options.config.files.sourceBucket = "bad\0value";
    },
    (f: Fixture) => {
      f.options.generateId = () => "invalid";
    },
    (f: Fixture) => {
      f.options.generateId = () => "01993000-0000-7000-8000-000000000001";
    },
    (f: Fixture) => {
      f.options.generateId = () => {
        throw new Error(importSecret);
      };
    },
    (f: Fixture) => {
      f.options.generateId = false as never;
    },
    (f: Fixture) => {
      f.users[0].admin = "true" as never;
    },
    (f: Fixture) => {
      f.users[0].discourseId = 1.5;
    },
    (f: Fixture) => {
      (f.users[0] as Row).password = importSecret;
    },
    (f: Fixture) => {
      (f.input.docs[0] as Row).unexpected = "private";
    },
    (f: Fixture) => {
      (f.input.files[0] as Row)._id = 1;
    },
    (f: Fixture) => {
      (f.input.files[0] as Row)._id = "";
    },
    (f: Fixture) => {
      (f.input.files as unknown[]).push(f.input.files[0]);
    },
    (f: Fixture) => {
      const row = f.input.docs[0] as Row;
      row.doc = row;
    },
    (f: Fixture) => {
      (f.input.files[0] as Row).image = new Map();
    },
    (f: Fixture) => {
      (f.input.files[0] as Row).image = () => null;
    },
    (f: Fixture) => {
      (f.input.files[0] as Row).image = { [Symbol("hidden")]: 1 };
    },
    (f: Fixture) => {
      Object.defineProperty(f.input.files[0], "hidden", { value: 1 });
    },
    (f: Fixture) => {
      Object.defineProperty(f.input.files[0], "image", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
    (f: Fixture) => {
      (f.input.files as unknown[]).length = 3;
    },
    (f: Fixture) => {
      Object.defineProperty(f.input.files, "0", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
    (f: Fixture) => {
      (f.input.files as unknown as Row).extra = true;
    },
    (f: Fixture) => {
      f.input.files = null as never;
    },
    (f: Fixture) => {
      f.options.config.emptyStudyDuplicates = null as never;
    },
  ])("refuses inconsistent source/config/allocation %#", (change) =>
    failure(change),
  );
});
