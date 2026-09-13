import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLegacyId } from "../db/legacyIds";
import { user } from "../db/schema/auth";
import { legacyIdAliases, legacyIdType } from "../db/schema/legacyIds";
import {
  templeInvites,
  templeMemberships,
  temples,
} from "../db/schema/memberships";
import { userAccess, userProfile } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import {
  createSqlTempleReader,
  createSqlTempleWriter,
  resolveTempleRouteId,
} from "./sql";

vi.mock("server-only", () => ({}));

const schema = {
  user,
  userAccess,
  userProfile,
  legacyIdType,
  legacyIdAliases,
  temples,
  templeInvites,
  templeMemberships,
};
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());

const ids = {
  scopedAdmin: createUuidV7(),
  member: createUuidV7(),
  globalAdmin: createUuidV7(),
  outsider: createUuidV7(),
  temple: createUuidV7(),
  otherTemple: createUuidV7(),
  adminMembership: createUuidV7(),
  memberMembership: createUuidV7(),
  globalMembership: createUuidV7(),
};
const when = new Date("2026-09-13T10:00:00.000Z");

async function membership(
  values: Partial<typeof templeMemberships.$inferInsert> & {
    id: string;
    userId: string;
    templeId: string;
  },
) {
  await db.insert(templeMemberships).values({
    grade: 0,
    admin: false,
    addedAt: when,
    createdAt: when,
    updatedAt: when,
    ...values,
  });
}

beforeEach(async () => {
  await db.delete(templeMemberships);
  await db.delete(templeInvites);
  await db.delete(temples);
  await db.delete(legacyIdAliases);
  await db.delete(userProfile);
  await db.delete(userAccess);
  await db.delete(user);
  await db.insert(user).values([
    {
      id: ids.scopedAdmin,
      name: "Scoped account name",
      email: "scoped@example.test",
    },
    {
      id: ids.member,
      name: "Member account name",
      email: "member@example.test",
    },
    {
      id: ids.globalAdmin,
      name: "Global administrator",
      email: "global@example.test",
    },
    {
      id: ids.outsider,
      name: "Outsider",
      email: "outsider@example.test",
    },
  ]);
  await db.insert(userAccess).values({
    userId: ids.globalAdmin,
    admin: true,
  });
  await db.insert(userProfile).values({
    userId: ids.member,
    displayName: "Public member name",
  });
  await db.insert(temples).values([
    {
      id: ids.temple,
      name: "Alpha",
      slug: "alpha",
      createdById: ids.scopedAdmin,
      createdAt: when,
      updatedAt: when,
    },
    {
      id: ids.otherTemple,
      name: "Beta",
      slug: "beta",
      createdById: ids.globalAdmin,
      createdAt: when,
      updatedAt: when,
    },
  ]);
  await db.insert(templeInvites).values([
    { templeId: ids.temple, joinPass: "alpha-secret" },
    { templeId: ids.otherTemple, joinPass: "beta-secret" },
  ]);
  await membership({
    id: ids.adminMembership,
    userId: ids.scopedAdmin,
    templeId: ids.temple,
    admin: true,
  });
  await membership({
    id: ids.memberMembership,
    userId: ids.member,
    templeId: ids.temple,
    grade: 2,
    motto: "Sub Rosa",
  });
  await membership({
    id: ids.globalMembership,
    userId: ids.globalAdmin,
    templeId: ids.otherTemple,
    admin: false,
  });
});

describe("SQL temple reads", () => {
  it("returns only the caller's public memberships to an ordinary member", async () => {
    const result = await createSqlTempleReader(db).getMyTemples(ids.member);
    expect(result).toEqual([
      {
        id: ids.temple,
        name: "Alpha",
        slug: "alpha",
        membership: { id: ids.memberMembership, grade: 2, admin: false },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("example.test");
    expect(
      await createSqlTempleReader(db).getAdminTemple(ids.member, ids.temple),
    ).toBeNull();
  });

  it("exposes invitation and member profile data only to scoped or global admins", async () => {
    const scoped = await createSqlTempleReader(db).getAdminTemple(
      ids.scopedAdmin,
      ids.temple,
    );
    expect(scoped?.joinPass).toBe("alpha-secret");
    expect(scoped?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipId: ids.memberMembership,
          displayName: "Public member name",
          motto: "Sub Rosa",
        }),
      ]),
    );
    const global = await createSqlTempleReader(db).getManageableTemples(
      ids.globalAdmin,
    );
    expect(global.globalAdmin).toBe(true);
    expect(global.temples.map((temple) => temple.id).sort()).toEqual(
      [ids.temple, ids.otherTemple].sort(),
    );
    expect(
      await createSqlTempleReader(db).getAdminTemple(
        ids.globalAdmin,
        ids.temple,
      ),
    ).not.toBeNull();
  });

  it("resolves old URLs only through the matching collection alias", async () => {
    const oldTempleId = "507f1f77bcf86cd799439011";
    const oldMembershipId = "507f1f77bcf86cd799439012";
    await ensureLegacyId(
      db,
      {
        sourceSystem: "mongodb",
        entityType: "temples",
        legacyIdType: "objectid",
        legacyIdValue: oldTempleId,
      },
      ids.temple,
    );
    await ensureLegacyId(
      db,
      {
        sourceSystem: "mongodb",
        entityType: "templeMemberships",
        legacyIdType: "objectid",
        legacyIdValue: oldMembershipId,
      },
      ids.memberMembership,
    );
    expect(
      await resolveTempleRouteId(db, "temples", oldTempleId.toUpperCase()),
    ).toBe(ids.temple);
    expect(
      await createSqlTempleReader(db).getAdminMembership(
        ids.scopedAdmin,
        oldTempleId,
        oldMembershipId,
      ),
    ).toMatchObject({
      temple: { id: ids.temple },
      membership: { membershipId: ids.memberMembership },
    });
    expect(
      await resolveTempleRouteId(db, "temples", oldMembershipId),
    ).toBeNull();
    expect(
      await resolveTempleRouteId(db, "temples", ids.temple.toUpperCase()),
    ).toBeNull();
  });
});

describe("SQL temple joins", () => {
  it("joins at grade zero and makes retries idempotent", async () => {
    const generateId = vi.fn(() => createUuidV7());
    const writer = createSqlTempleWriter(db, async () => ids.outsider, {
      now: () => when,
      generateId,
    });
    const request = {
      version: 1,
      expectedActorId: ids.outsider,
      slug: " ALPHA ",
      joinPass: "alpha-secret",
    };
    const first = await writer.join(request);
    expect(first).toMatchObject({
      ok: true,
      templeId: ids.temple,
      alreadyMember: false,
    });
    const second = await writer.join(request);
    expect(second).toMatchObject({
      ok: true,
      templeId: ids.temple,
      membershipId: first.ok ? first.membershipId : undefined,
      alreadyMember: true,
    });
    expect(generateId).toHaveBeenCalledOnce();
    const [saved] = await db
      .select()
      .from(templeMemberships)
      .where(
        and(
          eq(templeMemberships.userId, ids.outsider),
          eq(templeMemberships.templeId, ids.temple),
        ),
      );
    expect(saved).toMatchObject({ grade: 0, admin: false, addedAt: when });
  });

  it("rejects invalid invitations, switched accounts and overposted grants", async () => {
    const writer = createSqlTempleWriter(db, async () => ids.outsider);
    expect(
      await writer.join({
        version: 1,
        expectedActorId: ids.outsider,
        slug: "alpha",
        joinPass: "wrong",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INVITE" });
    expect(
      await writer.join({
        version: 1,
        expectedActorId: ids.member,
        slug: "alpha",
        joinPass: "alpha-secret",
      }),
    ).toMatchObject({ ok: false, code: "ACCOUNT_CHANGED" });
    expect(
      await writer.join({
        version: 1,
        expectedActorId: ids.outsider,
        slug: "alpha",
        joinPass: "alpha-secret",
        admin: true,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(
      await db
        .select()
        .from(templeMemberships)
        .where(eq(templeMemberships.userId, ids.outsider)),
    ).toEqual([]);
  });
});

describe("SQL temple administration", () => {
  const updateRequest = () => ({
    version: 1,
    expectedActorId: ids.scopedAdmin,
    templeId: ids.temple,
    membershipId: ids.memberMembership,
    grade: 6,
    admin: true,
    motto: "Lux",
    memberSince: "2024-02-29",
  });

  it("updates the requested membership with bounded grade and a real date", async () => {
    const result = await createSqlTempleWriter(
      db,
      async () => ids.scopedAdmin,
      { now: () => new Date("2026-09-13T11:00:00.000Z") },
    ).updateMembership(updateRequest());
    expect(result).toMatchObject({
      ok: true,
      templeId: ids.temple,
      membershipId: ids.memberMembership,
    });
    const [saved] = await db
      .select()
      .from(templeMemberships)
      .where(eq(templeMemberships.id, ids.memberMembership));
    expect(saved).toMatchObject({ grade: 6, admin: true, motto: "Lux" });
    expect(saved.memberSince?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });

  it("rejects ordinary callers, cross-temple IDs, bad grades and bad dates", async () => {
    expect(
      await createSqlTempleWriter(db, async () => ids.member).updateMembership({
        ...updateRequest(),
        expectedActorId: ids.member,
      }),
    ).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(
      await createSqlTempleWriter(
        db,
        async () => ids.scopedAdmin,
      ).updateMembership({
        ...updateRequest(),
        membershipId: ids.globalMembership,
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    for (const patch of [
      { grade: -1 },
      { grade: 7 },
      { grade: 1.5 },
      { memberSince: "2023-02-29" },
      { memberSince: "02/29/2024" },
    ]) {
      expect(
        await createSqlTempleWriter(
          db,
          async () => ids.scopedAdmin,
        ).updateMembership({ ...updateRequest(), ...patch }),
      ).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    }
    const [unchanged] = await db
      .select()
      .from(templeMemberships)
      .where(eq(templeMemberships.id, ids.memberMembership));
    expect(unchanged).toMatchObject({ grade: 2, admin: false });
  });

  it("preserves the last temple administrator and lets global admins manage their own membership", async () => {
    const demotion = {
      ...updateRequest(),
      membershipId: ids.adminMembership,
      grade: 0,
      admin: false,
      motto: "",
      memberSince: null,
    };
    expect(
      await createSqlTempleWriter(
        db,
        async () => ids.scopedAdmin,
      ).updateMembership(demotion),
    ).toMatchObject({ ok: false, code: "LAST_ADMIN" });
    expect(
      await createSqlTempleWriter(
        db,
        async () => ids.scopedAdmin,
      ).updateMembership(updateRequest()),
    ).toMatchObject({ ok: true });
    expect(
      await createSqlTempleWriter(
        db,
        async () => ids.scopedAdmin,
      ).updateMembership(demotion),
    ).toMatchObject({ ok: true });
    expect(
      await createSqlTempleWriter(
        db,
        async () => ids.globalAdmin,
      ).updateMembership({
        ...updateRequest(),
        expectedActorId: ids.globalAdmin,
        templeId: ids.otherTemple,
        membershipId: ids.globalMembership,
      }),
    ).toMatchObject({
      ok: true,
      templeId: ids.otherTemple,
      membershipId: ids.globalMembership,
    });
    const roles = await db
      .select({ id: templeMemberships.id, admin: templeMemberships.admin })
      .from(templeMemberships)
      .where(eq(templeMemberships.templeId, ids.temple));
    expect(roles).toEqual(
      expect.arrayContaining([
        { id: ids.adminMembership, admin: false },
        { id: ids.memberMembership, admin: true },
      ]),
    );
    const [globalMembership] = await db
      .select({ admin: templeMemberships.admin })
      .from(templeMemberships)
      .where(eq(templeMemberships.id, ids.globalMembership));
    expect(globalMembership.admin).toBe(true);
  });

  it("uses fresh SQL grants for invitation changes and never trusts identity metadata", async () => {
    const scopedWriter = createSqlTempleWriter(db, async () => ids.scopedAdmin);
    expect(
      await scopedWriter.updateInvite({
        version: 1,
        expectedActorId: ids.scopedAdmin,
        templeId: ids.temple,
        joinPass: "new-secret",
      }),
    ).toMatchObject({ ok: true });
    await db
      .update(templeMemberships)
      .set({ admin: false })
      .where(eq(templeMemberships.id, ids.adminMembership));
    expect(
      await scopedWriter.updateInvite({
        version: 1,
        expectedActorId: ids.scopedAdmin,
        templeId: ids.temple,
        joinPass: "stolen",
      }),
    ).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
    expect(
      await createSqlTempleWriter(db, async () => ids.globalAdmin).updateInvite(
        {
          version: 1,
          expectedActorId: ids.globalAdmin,
          templeId: ids.temple,
          joinPass: "global-secret",
        },
      ),
    ).toMatchObject({ ok: true });
    expect(
      (
        await db
          .select()
          .from(templeInvites)
          .where(eq(templeInvites.templeId, ids.temple))
      )[0].joinPass,
    ).toBe("global-secret");
    expect(
      await createSqlTempleWriter(db, async () => ids.globalAdmin).updateInvite(
        {
          version: 1,
          expectedActorId: ids.globalAdmin,
          templeId: ids.temple,
          joinPass: "",
        },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await db
        .select()
        .from(templeInvites)
        .where(eq(templeInvites.templeId, ids.temple)),
    ).toEqual([]);
  });
});
