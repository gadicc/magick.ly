import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { LegacyAliasKey } from "../db/legacyIds";
import { user } from "../db/schema/auth";
import { discourseUserLinks } from "../db/schema/discourse";
import { createUuidV7 } from "../lib/ids";
import {
  LegacyDiscourseImportError,
  type LegacyDiscourseImportOptions,
  type LegacyDiscourseUser,
  planLegacyDiscourseImport,
} from "./planLegacyDiscourseImport";

const origin = "https://forums.example.test";
const importedAt = new Date("2026-09-13T12:00:00.123Z");
const source = (number: number): LegacyAliasKey => ({
  sourceSystem: "mongodb",
  entityType: "users",
  legacyIdType: "objectid",
  legacyIdValue: number.toString(16).padStart(24, "0"),
});
const key = (value: LegacyAliasKey) =>
  JSON.stringify([
    value.sourceSystem,
    value.entityType,
    value.legacyIdType,
    value.legacyIdValue,
  ]);
function fixture(count = 3) {
  const ids = Array.from({ length: count }, () => createUuidV7());
  const input: LegacyDiscourseUser[] = ids.map((_, index) => ({
    source: source(index + 1),
    discourseId: index + 1,
  }));
  const aliases = new Map(
    input.map((row, index) => [key(row.source), ids[index]]),
  );
  const options: LegacyDiscourseImportOptions = {
    lookup: vi.fn((source) => aliases.get(key(source)) ?? null),
    canonicalUserIds: ids,
    sourceForumOrigin: origin,
    importedAt: new Date(importedAt),
  };
  return {
    ids,
    input,
    aliases,
    options,
    plan: () => planLegacyDiscourseImport(input, options),
  };
}
function failure(work: () => unknown, code: string, path?: string) {
  let error: unknown;
  try {
    work();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(LegacyDiscourseImportError);
  expect(error).toMatchObject({ code, ...(path ? { path } : {}) });
  return error as LegacyDiscourseImportError;
}

describe("legacy Discourse identity projection", () => {
  it("preserves seven numeric links and separate missing/null dispositions for the complete user set", () => {
    const t = fixture(9);
    t.input[6].discourseId = Number.MAX_SAFE_INTEGER;
    delete t.input[7].discourseId;
    t.input[8].discourseId = null;
    const plan = t.plan();
    expect(plan.sourceForumOrigin).toBe(origin);
    expect(plan.counts).toEqual({ users: 9, linked: 7, missing: 1, null: 1 });
    expect(plan.links).toEqual(
      t.ids.slice(0, 7).map((userId, index) => ({
        userId,
        forumOrigin: origin,
        discourseUserId: index === 6 ? Number.MAX_SAFE_INTEGER : index + 1,
        createdAt: importedAt,
      })),
    );
    expect(plan.dispositions).toEqual(
      t.input.map((row, index) => ({
        source: row.source,
        userId: t.ids[index],
        disposition: index === 7 ? "missing" : index === 8 ? "null" : "linked",
      })),
    );
    expect(t.options.lookup).toHaveBeenCalledTimes(9);
  });
  it("is deterministic, preserves exact source type, and owns independent output snapshots", () => {
    const t = fixture(2);
    t.input[1].source = { ...t.input[0].source, legacyIdType: "string" };
    t.aliases.clear();
    for (const [index, row] of t.input.entries())
      t.aliases.set(key(row.source), t.ids[index]);
    t.options.canonicalUserIds = t.ids.map((id) => id.toUpperCase());
    t.aliases.set(key(t.input[0].source), t.ids[0].toUpperCase());
    for (const row of t.input) {
      Object.freeze(row.source);
      Object.freeze(row);
    }
    Object.freeze(t.input);
    const before = structuredClone(t.input);
    const plan = t.plan(),
      second = t.plan();
    expect(plan).toEqual(second);
    expect(t.input).toEqual(before);
    expect(plan.links.map((row) => row.userId)).toEqual(t.ids);
    plan.dispositions[0].source.legacyIdValue = "replacement";
    plan.links[0].createdAt.setTime(0);
    expect(second.links[0].createdAt).toEqual(importedAt);
    expect(plan.links[1].createdAt).toEqual(importedAt);
    expect(t.options.importedAt).toEqual(importedAt);
    expect(t.input).toEqual(before);
    expect(second.dispositions[0].source.legacyIdValue).toBe(
      before[0].source.legacyIdValue,
    );
  });
  it("does not let a lookup mutate the retained source identity", () => {
    const t = fixture(1),
      expected = structuredClone(t.input[0].source);
    t.options.lookup = (alias) => {
      alias.legacyIdValue = "changed";
      return t.ids[0];
    };
    expect(t.plan().dispositions[0].source).toEqual(expected);
  });
  it("preserves opaque nonhex string IDs through the exact existing alias lookup", () => {
    const t = fixture(1);
    t.input[0].source = {
      ...source(1),
      legacyIdType: "string",
      legacyIdValue: "  legacy:user/A  ",
    };
    t.aliases.clear();
    t.aliases.set(key(t.input[0].source), t.ids[0]);
    expect(t.plan().dispositions[0].source).toEqual(t.input[0].source);
  });
  it("accepts an explicitly different canonical HTTPS forum origin without changing external IDs", () => {
    const t = fixture(1);
    const first = t.plan();
    t.options.sourceForumOrigin = "https://other-forum.example.test:8443";
    const other = t.plan();
    expect(other.links[0]).toEqual({
      ...first.links[0],
      forumOrigin: t.options.sourceForumOrigin,
    });
    expect(first.links[0].forumOrigin).toBe(origin);
  });
  it("can account for an empty canonical import without inventing links", () => {
    expect(fixture(0).plan()).toEqual({
      sourceForumOrigin: origin,
      links: [],
      dispositions: [],
      counts: { users: 0, linked: 0, missing: 0, null: 0 },
    });
  });
  it("rejects incomplete canonical coverage even when the only omitted user had no link", () => {
    const t = fixture();
    t.input.pop();
    failure(t.plan, "incomplete-user-projection", "input");
  });
  it.each([
    undefined,
    "1",
    BigInt(1),
    0,
    -0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    {},
    true,
  ])("does not coerce malformed discourseId (%s)", (value) => {
    const t = fixture(1);
    t.input[0].discourseId = value;
    failure(t.plan, "invalid-discourse-id", "users[0].discourseId");
  });
  it("rejects two users linked to the same account without merging either user", () => {
    const t = fixture(2);
    t.input[1].discourseId = t.input[0].discourseId;
    failure(t.plan, "conflicting-forum-account", "users[1].discourseId");
    expect(t.input[0].source).not.toEqual(t.input[1].source);
  });
  it("rejects a repeated source projection even when its link agrees", () => {
    const t = fixture(2);
    t.input[1] = structuredClone(t.input[0]);
    failure(t.plan, "duplicate-user-source", "users[1]");
  });
  it("rejects different source records resolving to one canonical user", () => {
    const t = fixture(2);
    t.aliases.set(key(t.input[1].source), t.ids[0]);
    failure(t.plan, "unknown-or-duplicate-user", "users[1]");
  });
  it("rejects an alias outside the complete imported canonical user set", () => {
    const t = fixture(1);
    t.aliases.set(key(t.input[0].source), createUuidV7());
    failure(t.plan, "unknown-or-duplicate-user");
  });
  it.each([null, "bad", "550e8400-e29b-41d4-a716-446655440000"])(
    "refuses absent/non-v7 user aliases (%s)",
    (mapped) => {
      const t = fixture(1);
      t.options.lookup = () => mapped;
      failure(t.plan, "missing-canonical-alias", "users[0].source");
    },
  );
  it("reports a failed lookup without copying its error or source identity", () => {
    const t = fixture(1);
    t.options.lookup = () => {
      throw new Error("synthetic private provider/token detail");
    };
    const error = failure(t.plan, "lookup-failed", "users[0].source");
    expect(error.message).toBe("lookup-failed at users[0].source");
    expect(JSON.stringify(error)).not.toContain(
      t.input[0].source.legacyIdValue,
    );
    expect(JSON.stringify(error)).not.toContain("token");
    expect(error.cause).toBeUndefined();
  });
  it.each([
    { sourceSystem: "other" },
    { entityType: "accounts" },
    { legacyIdType: "number" },
    { legacyIdValue: "" },
    { legacyIdValue: 1 },
    { legacyIdValue: "00000000000000000000000G" },
    { legacyIdValue: "ABCDEF000000000000000001" },
    { legacyIdType: "string", legacyIdValue: "  " },
    { legacyIdType: "string", legacyIdValue: "\0" },
    { legacyIdType: "string", legacyIdValue: "\ud800" },
  ])("rejects malformed or non-normalized source reference (%j)", (change) => {
    const t = fixture(1);
    Object.assign(t.input[0].source, change);
    failure(t.plan, "invalid-user-source", "users[0].source");
    expect(t.options.lookup).not.toHaveBeenCalled();
  });
  it.each([null, [], "serialized-user", Object.create({ source: source(1) })])(
    "rejects a non-plain user projection (%s)",
    (value) => {
      failure(
        () =>
          planLegacyDiscourseImport(
            [value as LegacyDiscourseUser],
            fixture(1).options,
          ),
        "invalid-object",
        "users[0]",
      );
    },
  );
  it.each(["user", "source", "options"])(
    "does not read unknown/accessor/private properties in %s",
    (location) => {
      const t = fixture(1);
      const object =
        location === "user"
          ? t.input[0]
          : location === "source"
            ? t.input[0].source
            : t.options;
      const getter = vi.fn(() => {
        throw new Error("must never read token");
      });
      Object.defineProperty(object, "syntheticPrivateField", {
        enumerable: true,
        get: getter,
      });
      const error = failure(t.plan, "unclassified-properties");
      expect(getter).not.toHaveBeenCalled();
      expect(error.message).not.toContain("syntheticPrivateField");
    },
  );
  it.each(["extra", "symbol", "nonenumerable"])(
    "rejects %s projection fields instead of retaining whole user data",
    (kind) => {
      const t = fixture(1);
      if (kind === "extra")
        Object.assign(t.input[0], {
          services: [{ accessToken: "synthetic-private" }],
        });
      if (kind === "symbol")
        Object.assign(t.input[0], { [Symbol("private")]: 1 });
      if (kind === "nonenumerable")
        Object.defineProperty(t.input[0], "discourseId", {
          value: 1,
          enumerable: false,
        });
      failure(t.plan, "unclassified-properties", "users[0]");
    },
  );
  it.each([null, [], "options"])("rejects malformed options (%s)", (value) => {
    failure(
      () =>
        planLegacyDiscourseImport(
          [],
          value as unknown as LegacyDiscourseImportOptions,
        ),
      "invalid-object",
      "options",
    );
  });
  it.each([null, {}, "input"])(
    "rejects a malformed input collection (%s)",
    (value) => {
      failure(
        () =>
          planLegacyDiscourseImport(
            value as unknown as LegacyDiscourseUser[],
            fixture(0).options,
          ),
        "invalid-input-array",
        "input",
      );
    },
  );
  it("rejects a missing source rather than relying on an email/profile fallback", () => {
    failure(
      () =>
        planLegacyDiscourseImport(
          [{} as LegacyDiscourseUser],
          fixture(1).options,
        ),
      "invalid-object",
      "users[0].source",
    );
  });
  it.each([null, "2026-09-13", new Date(NaN)])(
    "rejects invalid bookkeeping time (%s)",
    (value) => {
      const t = fixture(0);
      t.options.importedAt = value as Date;
      failure(t.plan, "invalid-import-time", "options.importedAt");
    },
  );
  it("requires a synchronous alias lookup", () => {
    const t = fixture(0);
    t.options.lookup = null!;
    failure(t.plan, "invalid-lookup", "options.lookup");
  });
  it.each([null, "ids", ["bad"], ["550e8400-e29b-41d4-a716-446655440000"]])(
    "rejects malformed canonical user set (%s)",
    (value) => {
      const t = fixture(0);
      t.options.canonicalUserIds = value as string[];
      failure(t.plan, "invalid-user-set", "options.canonicalUserIds");
    },
  );
  it("rejects duplicate canonical identities even with differing UUID case", () => {
    const t = fixture(1);
    t.options.canonicalUserIds = [t.ids[0], t.ids[0].toUpperCase()];
    failure(t.plan, "invalid-user-set");
  });
  it.each([
    undefined,
    null,
    "",
    "https://forums.example.test/",
    "HTTPS://forums.example.test",
    "https://Forums.example.test",
    "http://forums.example.test",
    "https://user:password@forums.example.test",
    "https://forums.example.test/path",
    "https://forums.example.test?api_key=synthetic",
    "https://forums.example.test#fragment",
    "https://forums.example.test:443",
    "https://forums.example.test:999999",
    `https://${"a".repeat(249)}`,
    "https://127.000.000.001",
    "https://%66orums.example.test",
  ])("requires an explicit canonical source origin (%s)", (value) => {
    const t = fixture(0);
    t.options.sourceForumOrigin = value as string;
    const error = failure(
      t.plan,
      "invalid-forum-origin",
      "options.sourceForumOrigin",
    );
    expect(error.message).toBe(
      "invalid-forum-origin at options.sourceForumOrigin",
    );
  });
});

describe("Discourse SQL identity constraints", () => {
  let harness: Awaited<
    ReturnType<
      typeof createMemoryPgliteHarness<{
        user: typeof user;
        discourseUserLinks: typeof discourseUserLinks;
      }>
    >
  >;
  let t: ReturnType<typeof fixture>;
  beforeAll(async () => {
    harness = await createMemoryPgliteHarness({
      schema: { user, discourseUserLinks },
    });
  });
  beforeEach(async () => {
    await harness.db.delete(discourseUserLinks);
    await harness.db.delete(user);
    t = fixture(2);
    await harness.db.insert(user).values(
      t.ids.map((id, index) => ({
        id,
        name: `Synthetic ${index}`,
        email: `synthetic${index}@example.test`,
      })),
    );
  });
  afterAll(async () => {
    await harness?.client.close();
  });
  it("stores the prepared links with exact safe integers and selects by user plus origin", async () => {
    t.input[1].discourseId = Number.MAX_SAFE_INTEGER;
    const plan = t.plan();
    await harness.db.insert(discourseUserLinks).values(plan.links);
    const secondOrigin = "https://other-forum.example.test";
    await harness.db.insert(discourseUserLinks).values({
      ...plan.links[0],
      forumOrigin: secondOrigin,
      discourseUserId: Number.MAX_SAFE_INTEGER,
    });
    const rows = await harness.db
      .select()
      .from(discourseUserLinks)
      .where(
        and(
          eq(discourseUserLinks.userId, t.ids[0]),
          eq(discourseUserLinks.forumOrigin, origin),
        ),
      );
    expect(rows).toEqual([plan.links[0]]);
    const other = await harness.db
      .select()
      .from(discourseUserLinks)
      .where(eq(discourseUserLinks.forumOrigin, secondOrigin));
    expect(other[0].discourseUserId).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      (await harness.db.select().from(discourseUserLinks)).find(
        (row) => row.userId === t.ids[1],
      )?.discourseUserId,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects both directions of conflicting links without overwriting the first", async () => {
    const first = t.plan().links[0];
    await harness.db.insert(discourseUserLinks).values(first);
    await expect(
      harness.db
        .insert(discourseUserLinks)
        .values({ ...first, discourseUserId: 99 }),
    ).rejects.toThrow();
    await expect(
      harness.db
        .insert(discourseUserLinks)
        .values({ ...first, userId: t.ids[1] }),
    ).rejects.toThrow();
    expect(await harness.db.select().from(discourseUserLinks)).toEqual([first]);
  });
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "SQL rejects out-of-range external ID %s",
    async (value) => {
      await expect(
        harness.db
          .insert(discourseUserLinks)
          .values({ ...t.plan().links[0], discourseUserId: value }),
      ).rejects.toThrow();
      expect(await harness.db.select().from(discourseUserLinks)).toEqual([]);
    },
  );
  it.each([
    "",
    "https://forums.example.test/path",
    "https://user:password@forums.example.test",
    "http://forums.example.test",
    `https://${"a".repeat(249)}`,
  ])("SQL rejects unscoped or malformed origin %s", async (value) => {
    await expect(
      harness.db
        .insert(discourseUserLinks)
        .values({ ...t.plan().links[0], forumOrigin: value }),
    ).rejects.toThrow();
  });
  it("requires an existing canonical owner and removes only that owner's links on deletion", async () => {
    const plan = t.plan();
    await expect(
      harness.db
        .insert(discourseUserLinks)
        .values({ ...plan.links[0], userId: createUuidV7() }),
    ).rejects.toThrow();
    await harness.db.insert(discourseUserLinks).values(plan.links);
    await harness.db.delete(user).where(eq(user.id, t.ids[0]));
    expect(await harness.db.select().from(discourseUserLinks)).toEqual([
      plan.links[1],
    ]);
  });
});
