import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import { userGroupGrants, userGroups } from "../db/schema/memberships";
import { userAccess, userProfile } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import { createSqlAdminService } from "./sqlAdmin";

vi.mock("server-only", () => ({}));
const schema = { user, userGroups, userGroupGrants, userAccess, userProfile };
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
const adminId = createUuidV7(),
  memberId = createUuidV7(),
  otherId = createUuidV7(),
  groupId = createUuidV7();
let actorId: string | null = adminId;
const service = createSqlAdminService(db, async () => actorId);
const request = (
  operation: "add-member" | "remove-member" | "add-admin" | "remove-admin",
) => ({
  expectedActorId: adminId,
  groupId,
  userIds: [memberId],
  operation,
});
afterAll(() => harness.client.close());
beforeEach(async () => {
  actorId = adminId;
  await db.delete(userGroupGrants);
  await db.delete(userGroups);
  await db.delete(userProfile);
  await db.delete(userAccess);
  await db.delete(user);
  await db.insert(user).values([
    { id: adminId, name: "Administrator", email: "admin@example.test" },
    { id: memberId, name: "Member", email: "member@example.test" },
    { id: otherId, name: "Other", email: "other@example.test" },
  ]);
  await db.insert(userAccess).values({ userId: adminId, admin: true });
  await db.insert(userGroups).values({ id: groupId, name: "Synthetic group" });
});

describe("SQL global administration", () => {
  it("projects only display identity and explicit independent grants", async () => {
    await db
      .insert(userProfile)
      .values({ userId: memberId, displayName: "Member display name" });
    await db
      .insert(userGroupGrants)
      .values({ userId: memberId, groupId, admin: true });
    const result = await service.read();
    expect(result.users.find((value) => value.id === memberId)).toEqual({
      id: memberId,
      name: "Member",
      displayName: "Member display name",
      email: "member@example.test",
    });
    expect(result.groups).toEqual([{ id: groupId, name: "Synthetic group" }]);
    expect(result.grants).toEqual([
      { userId: memberId, groupId, member: false, admin: true },
    ]);
  });

  it.each([null, memberId, "507f1f77bcf86cd799439011"])(
    "denies unauthorized principal %s before any mutation",
    async (identity) => {
      actorId = identity;
      await expect(service.read()).rejects.toHaveProperty(
        "code",
        identity === memberId ? "FORBIDDEN" : "NOT_AUTHENTICATED",
      );
      await expect(
        service.setGrants(request("add-admin")),
      ).rejects.toBeInstanceOf(Error);
      expect(await db.select().from(userGroupGrants)).toEqual([]);
    },
  );

  it("refuses a stale form after the signed-in account changes", async () => {
    await db.insert(userAccess).values({ userId: otherId, admin: true });
    actorId = otherId;
    await expect(
      service.setGrants(request("add-admin")),
    ).rejects.toHaveProperty("code", "CHANGED");
    expect(await db.select().from(userGroupGrants)).toEqual([]);
  });

  it("checks revoked global access on the next operation", async () => {
    await service.read();
    await db
      .update(userAccess)
      .set({ admin: false })
      .where(eq(userAccess.userId, adminId));
    await expect(
      service.setGrants(request("add-member")),
    ).rejects.toHaveProperty("code", "FORBIDDEN");
  });

  it("never returns a loaded directory after the session changes", async () => {
    const identity = vi
      .fn()
      .mockResolvedValueOnce(adminId)
      .mockResolvedValueOnce(otherId);
    await expect(
      createSqlAdminService(db, identity).read(),
    ).rejects.toHaveProperty("code", "CHANGED");
  });

  it("replays group creation and refuses a reused ID with changed content", async () => {
    const input = {
      expectedActorId: adminId,
      id: createUuidV7(),
      name: "  New group  ",
    };
    await service.createGroup(input);
    await service.createGroup(input);
    await expect(
      service.createGroup({ ...input, name: "Changed" }),
    ).rejects.toHaveProperty("code", "CHANGED");
    expect(
      await db.select().from(userGroups).where(eq(userGroups.id, input.id)),
    ).toMatchObject([{ name: "New group" }]);
  });

  it("adds and removes each grant independently; repeated requests are idempotent", async () => {
    await service.setGrants(request("add-admin"));
    await service.setGrants(request("add-admin"));
    await service.setGrants(request("add-member"));
    await service.setGrants(request("remove-member"));
    await service.setGrants(request("remove-member"));
    expect(await db.select().from(userGroupGrants)).toEqual([
      { userId: memberId, groupId, member: false, admin: true },
    ]);
    await service.setGrants(request("remove-admin"));
    await service.setGrants(request("remove-admin"));
    expect(await db.select().from(userGroupGrants)).toEqual([]);
    await service.setGrants(request("add-member"));
    await service.setGrants(request("add-admin"));
    await service.setGrants(request("remove-admin"));
    expect(await db.select().from(userGroupGrants)).toEqual([
      { userId: memberId, groupId, member: true, admin: false },
    ]);
  });

  it("rejects a partly invalid bulk selection without changing valid users", async () => {
    await expect(
      service.setGrants({
        ...request("add-member"),
        userIds: [memberId, createUuidV7()],
      }),
    ).rejects.toHaveProperty("code", "INVALID");
    expect(await db.select().from(userGroupGrants)).toEqual([]);
  });

  it("deduplicates selected users and does not touch unselected grants", async () => {
    await db
      .insert(userGroupGrants)
      .values({ userId: otherId, groupId, member: true });
    await service.setGrants({
      ...request("add-admin"),
      userIds: [memberId, memberId],
    });
    expect(
      await db
        .select()
        .from(userGroupGrants)
        .where(eq(userGroupGrants.userId, otherId)),
    ).toEqual([{ userId: otherId, groupId, member: true, admin: false }]);
  });

  it("rejects missing groups, empty names and malformed operation/identity values", async () => {
    await expect(
      service.setGrants({ ...request("add-admin"), groupId: createUuidV7() }),
    ).rejects.toHaveProperty("code", "INVALID");
    await expect(
      service.setGrants({
        ...request("add-admin"),
        operation: "toggle" as never,
      }),
    ).rejects.toHaveProperty("code", "INVALID");
    await expect(
      service.setGrants({ ...request("add-admin"), userIds: [] }),
    ).rejects.toHaveProperty("code", "INVALID");
    await expect(
      service.createGroup({
        expectedActorId: adminId,
        id: createUuidV7(),
        name: " ",
      }),
    ).rejects.toHaveProperty("code", "INVALID");
  });
});
