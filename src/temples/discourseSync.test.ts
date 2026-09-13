import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import { discourseUserLinks } from "../db/schema/discourse";
import { templeMemberships, temples } from "../db/schema/memberships";
import {
  legacyUserEmails,
  userAccess,
  userProfile,
} from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import {
  createSqlDiscourseSync,
  type DiscourseSyncTransport,
  forumGroupSeed,
  MAGICKLY_DISCOURSE_ORIGIN,
} from "./discourseSync";

vi.mock("server-only", () => ({}));

const schema = {
  user,
  userAccess,
  userProfile,
  legacyUserEmails,
  temples,
  templeMemberships,
  discourseUserLinks,
};
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());

const ids = {
  admin: createUuidV7(),
  scopedAdmin: createUuidV7(),
  member: createUuidV7(),
  otherMember: createUuidV7(),
  temple: createUuidV7(),
  membership: createUuidV7(),
};
const when = new Date("2026-09-13T12:00:00.000Z");

function transport(
  overrides: Partial<DiscourseSyncTransport> = {},
): DiscourseSyncTransport {
  const groups = forumGroupSeed.map((seed, index) => ({
    id: index + 100,
    name: seed.name,
    title: seed.title,
  }));
  return {
    listGroupsPage: vi.fn(async (page) => ({
      groups: page === 0 ? groups : [],
    })),
    createGroup: vi.fn(async (seed) => ({
      id: 200 + seed.grade,
      name: seed.name,
      title: seed.title,
    })),
    configureGroup: vi.fn(async () => {}),
    listGroupMemberPage: vi.fn(async (_groupName, offset) => ({
      memberIds: [],
      total: 0,
      limit: 50,
      offset,
    })),
    getUser: vi.fn(async (userId) => ({
      id: userId,
      username: `member${userId}`,
      title: null,
      primaryGroupId: null,
    })),
    findUsersByEmail: vi.fn(async () => []),
    createUser: vi.fn(async () => ({ success: true, userId: 900 })),
    updateUsername: vi.fn(async () => {}),
    addGroupMember: vi.fn(async () => {}),
    removeGroupMember: vi.fn(async () => {}),
    setPrimaryGroup: vi.fn(async () => {}),
    setTitle: vi.fn(async () => {}),
    ...overrides,
  };
}

async function run(
  provider: DiscourseSyncTransport,
  actor: () => Promise<string | null> = async () => ids.admin,
) {
  return createSqlDiscourseSync(db, {
    getCurrentActorId: actor,
    transport: provider,
    createPassword: () => "test-password",
  })({ expectedActorId: ids.admin, templeId: ids.temple });
}

async function linkFor(userId: string, origin = MAGICKLY_DISCOURSE_ORIGIN) {
  const [link] = await db
    .select()
    .from(discourseUserLinks)
    .where(
      and(
        eq(discourseUserLinks.userId, userId),
        eq(discourseUserLinks.forumOrigin, origin),
      ),
    );
  return link ?? null;
}

beforeEach(async () => {
  await db.delete(discourseUserLinks);
  await db.delete(legacyUserEmails);
  await db.delete(templeMemberships);
  await db.delete(temples);
  await db.delete(userProfile);
  await db.delete(userAccess);
  await db.delete(user);
  await db.insert(user).values([
    {
      id: ids.admin,
      name: "Global administrator",
      email: "admin@example.test",
      emailVerified: true,
    },
    {
      id: ids.scopedAdmin,
      name: "Temple administrator",
      email: "scoped@example.test",
      emailVerified: true,
    },
    {
      id: ids.member,
      name: "Member account",
      email: "member@example.test",
      emailVerified: true,
    },
    {
      id: ids.otherMember,
      name: "Other member",
      email: "other@example.test",
      emailVerified: true,
    },
  ]);
  await db.insert(userAccess).values([
    { userId: ids.admin, admin: true },
    { userId: ids.scopedAdmin, admin: false },
  ]);
  await db.insert(userProfile).values({
    userId: ids.member,
    displayName: "Member profile",
  });
  await db.insert(temples).values({
    id: ids.temple,
    name: "Alpha",
    slug: "alpha",
    createdById: ids.scopedAdmin,
    createdAt: when,
    updatedAt: when,
  });
  await db.insert(templeMemberships).values({
    id: ids.membership,
    userId: ids.member,
    templeId: ids.temple,
    grade: 2,
    admin: false,
    motto: "Sub Rosa",
    addedAt: when,
    createdAt: when,
    updatedAt: when,
  });
});

describe("SQL Discourse synchronization", () => {
  it("requires a fresh session backed by the SQL global-admin grant", async () => {
    const provider = transport();
    const result = await run(provider, async () => ids.scopedAdmin);
    expect(result).toMatchObject({ status: "error", completed: 0 });
    expect(provider.listGroupsPage).not.toHaveBeenCalled();
  });

  it("uses only the established link for this forum origin", async () => {
    await db.insert(discourseUserLinks).values([
      {
        userId: ids.member,
        forumOrigin: MAGICKLY_DISCOURSE_ORIGIN,
        discourseUserId: 41,
      },
      {
        userId: ids.member,
        forumOrigin: "https://community.example.test",
        discourseUserId: 99,
      },
    ]);
    const provider = transport({
      listGroupMemberPage: vi.fn(async (groupName, offset) => ({
        memberIds: groupName === "neophytes" ? [41] : [],
        total: groupName === "neophytes" ? 1 : 0,
        limit: 50,
        offset,
      })),
    });
    const result = await run(provider);
    expect(result).toMatchObject({
      status: "success",
      completed: 1,
      skipped: 0,
    });
    expect(provider.getUser).toHaveBeenCalledWith(41);
    expect(provider.getUser).not.toHaveBeenCalledWith(99);
    expect(provider.findUsersByEmail).not.toHaveBeenCalled();
    expect(provider.createUser).not.toHaveBeenCalled();
    expect(provider.removeGroupMember).toHaveBeenCalledWith(100, "Sub_Rosa");
    expect(provider.addGroupMember).toHaveBeenCalledWith(102, "Sub_Rosa");
    expect(provider.setPrimaryGroup).toHaveBeenCalledWith(41, 102);
    expect(provider.setTitle).toHaveBeenCalledWith("Sub_Rosa", "Theoricus");
  });

  it("loads all group-member pages before deciding whether to add a member", async () => {
    await db.insert(discourseUserLinks).values({
      userId: ids.member,
      forumOrigin: MAGICKLY_DISCOURSE_ORIGIN,
      discourseUserId: 900,
    });
    const listGroupMemberPage = vi.fn(async (groupName, offset) => {
      if (groupName !== "theorici")
        return { memberIds: [], total: 0, limit: 50, offset };
      return offset === 0
        ? {
            memberIds: Array.from({ length: 50 }, (_, index) => index + 1),
            total: 51,
            limit: 50,
            offset,
          }
        : { memberIds: [900], total: 51, limit: 50, offset };
    });
    const provider = transport({ listGroupMemberPage });

    const result = await run(provider);

    expect(result).toMatchObject({ status: "success", completed: 1 });
    expect(listGroupMemberPage).toHaveBeenCalledWith("theorici", 0);
    expect(listGroupMemberPage).toHaveBeenCalledWith("theorici", 50);
    expect(provider.addGroupMember).not.toHaveBeenCalledWith(102, "Sub_Rosa");
  });

  it("finds configured groups on later bounded list pages", async () => {
    const listGroupsPage = vi.fn(async (page) => ({
      groups:
        page === 0
          ? [{ id: 10, name: "unrelated", title: null }]
          : page === 1
            ? forumGroupSeed.map((seed, index) => ({
                id: index + 100,
                name: seed.name,
                title: seed.title,
              }))
            : [],
    }));
    const provider = transport({ listGroupsPage });

    const result = await run(provider);

    expect(result).toMatchObject({ status: "success", completed: 1 });
    expect(listGroupsPage).toHaveBeenNthCalledWith(1, 0);
    expect(listGroupsPage).toHaveBeenNthCalledWith(2, 1);
    expect(provider.createGroup).not.toHaveBeenCalled();
  });

  it("retains a link whose external account is missing and never rematches it", async () => {
    await db.insert(discourseUserLinks).values({
      userId: ids.member,
      forumOrigin: MAGICKLY_DISCOURSE_ORIGIN,
      discourseUserId: 42,
    });
    const provider = transport({ getUser: vi.fn(async () => null) });
    const result = await run(provider);
    expect(result).toMatchObject({
      status: "warning",
      completed: 0,
      skipped: 1,
    });
    expect(provider.findUsersByEmail).not.toHaveBeenCalled();
    expect(provider.createUser).not.toHaveBeenCalled();
    expect((await linkFor(ids.member))?.discourseUserId).toBe(42);
  });

  it("skips ambiguous email matches without linking or changing that forum user", async () => {
    const provider = transport({
      findUsersByEmail: vi.fn(async () => [{ id: 51 }, { id: 52 }]),
    });
    const result = await run(provider);
    expect(result).toMatchObject({
      status: "warning",
      completed: 0,
      skipped: 1,
    });
    expect(provider.createUser).not.toHaveBeenCalled();
    expect(provider.addGroupMember).not.toHaveBeenCalled();
    expect(await linkFor(ids.member)).toBeNull();
    expect(JSON.stringify(result)).not.toContain("member@example.test");
  });

  it("reconciles one unique account from verified addresses and ignores unverified history", async () => {
    await db.insert(legacyUserEmails).values([
      {
        id: createUuidV7(),
        userId: ids.member,
        value: "old@example.test",
        normalizedValue: "old@example.test",
        verified: true,
        evidence: [],
      },
      {
        id: createUuidV7(),
        userId: ids.member,
        value: "unverified@example.test",
        normalizedValue: "unverified@example.test",
        verified: false,
        evidence: [],
      },
    ]);
    const findUsersByEmail = vi.fn(async (email: string) =>
      email === "unverified@example.test" ? [{ id: 77 }] : [{ id: 61 }],
    );
    const provider = transport({ findUsersByEmail });
    const result = await run(provider);
    expect(result).toMatchObject({ status: "success", completed: 1 });
    expect(findUsersByEmail).toHaveBeenCalledWith("member@example.test");
    expect(findUsersByEmail).toHaveBeenCalledWith("old@example.test");
    expect(findUsersByEmail).not.toHaveBeenCalledWith(
      "unverified@example.test",
    );
    expect(provider.createUser).not.toHaveBeenCalled();
    expect((await linkFor(ids.member))?.discourseUserId).toBe(61);
  });

  it("creates and links a forum user only after verified-email reconciliation finds none", async () => {
    const provider = transport();
    const result = await run(provider);
    expect(result).toMatchObject({
      status: "success",
      completed: 1,
      skipped: 0,
    });
    expect(provider.findUsersByEmail).toHaveBeenCalledWith(
      "member@example.test",
    );
    expect(provider.createUser).toHaveBeenCalledOnce();
    expect(provider.createUser).toHaveBeenCalledWith({
      name: "Member profile",
      email: "member@example.test",
      password: "test-password",
      username: "Sub_Rosa",
    });
    expect((await linkFor(ids.member))?.discourseUserId).toBe(900);
  });

  it("never overwrites a forum identity link owned by another local user", async () => {
    await db.insert(discourseUserLinks).values({
      userId: ids.otherMember,
      forumOrigin: MAGICKLY_DISCOURSE_ORIGIN,
      discourseUserId: 71,
    });
    const provider = transport({
      findUsersByEmail: vi.fn(async () => [{ id: 71 }]),
    });
    const result = await run(provider);
    expect(result).toMatchObject({ status: "error", completed: 0 });
    expect(await linkFor(ids.member)).toBeNull();
    expect((await linkFor(ids.otherMember))?.discourseUserId).toBe(71);
    expect(provider.addGroupMember).not.toHaveBeenCalled();
  });

  it("rechecks authorization after each awaited provider step", async () => {
    let actor: string | null = ids.admin;
    const configureGroup = vi.fn(async () => {});
    const provider = transport({
      listGroupsPage: vi.fn(async () => {
        actor = null;
        return {
          groups: forumGroupSeed.map((seed, index) => ({
            id: index + 100,
            name: seed.name,
            title: seed.title,
          })),
        };
      }),
      configureGroup,
    });
    const result = await run(provider, async () => actor);
    expect(result).toMatchObject({ status: "error", completed: 0 });
    expect(configureGroup).not.toHaveBeenCalled();
  });

  it("rechecks authorization before each group-member page", async () => {
    let actor: string | null = ids.admin;
    const listGroupMemberPage = vi.fn(async (groupName, offset) => {
      if (groupName === "neophytes" && offset === 0) {
        actor = null;
        return {
          memberIds: Array.from({ length: 50 }, (_, index) => index + 1),
          total: 51,
          limit: 50,
          offset,
        };
      }
      return { memberIds: [], total: 0, limit: 50, offset };
    });
    const provider = transport({ listGroupMemberPage });

    const result = await run(provider, async () => actor);

    expect(result).toMatchObject({ status: "error", completed: 0 });
    expect(listGroupMemberPage).toHaveBeenCalledTimes(1);
  });

  it("stops before a user mutation when the temple membership changes", async () => {
    const createUser = vi.fn(async () => ({ success: true, userId: 81 }));
    const provider = transport({
      findUsersByEmail: vi.fn(async () => {
        await db
          .delete(templeMemberships)
          .where(eq(templeMemberships.id, ids.membership));
        return [];
      }),
      createUser,
    });
    const result = await run(provider);
    expect(result).toMatchObject({ status: "error", completed: 0 });
    expect(createUser).not.toHaveBeenCalled();
    expect(provider.addGroupMember).not.toHaveBeenCalled();
  });

  it("reports an uncertain account creation once without immediate retry", async () => {
    const createUser = vi.fn(async () => {
      throw new Error("timeout after request");
    });
    const provider = transport({ createUser });
    const result = await run(provider);
    expect(result).toMatchObject({
      status: "warning",
      completed: 0,
      skipped: 1,
    });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(provider.getUser).not.toHaveBeenCalled();
    expect(await linkFor(ids.member)).toBeNull();
    expect(JSON.stringify(result)).not.toContain("timeout after request");
  });
});
