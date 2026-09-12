import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureLegacyId } from "../src/db/legacyIds";
import * as schema from "../src/db/schema";
import { createUuidV7, isUuidV7 } from "../src/lib/ids";
import { planLegacyMembershipImport } from "../src/migration/planLegacyMembershipImport";
import { fixture, sourceKey } from "./membershipFixtures";

const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());
beforeEach(async () => {
  await db.delete(schema.templeMemberships);
  await db.delete(schema.templeInvites);
  await db.delete(schema.temples);
  await db.delete(schema.legacyUserGroupGrants);
  await db.delete(schema.userGroupGrants);
  await db.delete(schema.userGroups);
  await db.delete(schema.user);
  await db.delete(schema.legacyIdAliases);
});

// Fixed-input test helper only: a real resumable importer must compare target
// fingerprints/content, not use onConflictDoNothing to conceal changed rows.
async function importSynthetic() {
  const test = fixture();
  return db.transaction(async (tx) => {
    for (const ref of test.primaries)
      test.ids.set(sourceKey(ref), await ensureLegacyId(tx, ref));
    const plan = planLegacyMembershipImport(test.input, test.options());
    await tx
      .insert(schema.user)
      .values(
        test.options().canonicalUserIds.map((id, index) => ({
          id,
          name: `Synthetic user ${index}`,
          email: `synthetic-${index}@example.test`,
        })),
      )
      .onConflictDoNothing();
    for (const alias of plan.aliases)
      await ensureLegacyId(tx, alias.source, alias.canonicalId);
    await tx
      .insert(schema.userGroups)
      .values(plan.groups)
      .onConflictDoNothing();
    await tx
      .insert(schema.userGroupGrants)
      .values(plan.grants)
      .onConflictDoNothing();
    await tx
      .insert(schema.legacyUserGroupGrants)
      .values(plan.grantEvidence)
      .onConflictDoNothing();
    await tx.insert(schema.temples).values(plan.temples).onConflictDoNothing();
    await tx
      .insert(schema.templeInvites)
      .values(plan.invites)
      .onConflictDoNothing();
    await tx
      .insert(schema.templeMemberships)
      .values(plan.memberships)
      .onConflictDoNothing();
    return plan;
  });
}

describe("membership schema on PGlite", () => {
  it("reruns with the same canonical IDs, source evidence, flags and typed dates", async () => {
    const first = await importSynthetic();
    const aliases = await db.select().from(schema.legacyIdAliases);
    expect(await importSynthetic()).toEqual(first);
    expect(await db.select().from(schema.legacyIdAliases)).toEqual(aliases);
    expect(await db.select().from(schema.userGroups)).toHaveLength(1);
    expect(await db.select().from(schema.userGroupGrants)).toEqual(
      first.grants,
    );
    expect(await db.select().from(schema.legacyUserGroupGrants)).toEqual(
      first.grantEvidence,
    );
    expect(await db.select().from(schema.templeMemberships)).toEqual(
      first.memberships,
    );
    expect(await db.select().from(schema.templeInvites)).toEqual(first.invites);
    expect((await db.select().from(schema.temples))[0]).not.toHaveProperty(
      "joinPass",
    );
    expect(first.groups.every((row) => isUuidV7(row.id))).toBe(true);
    expect(first.temples.every((row) => isUuidV7(row.id))).toBe(true);
    expect(first.memberships.every((row) => isUuidV7(row.id))).toBe(true);
  });

  it("enforces one membership per user/temple and a nonnegative integer grade", async () => {
    const plan = await importSynthetic();
    await expect(
      db.insert(schema.templeMemberships).values({
        ...plan.memberships[0],
        id: createUuidV7(),
      }),
    ).rejects.toThrow();
    await expect(
      db
        .update(schema.templeMemberships)
        .set({ grade: -1 })
        .where(eq(schema.templeMemberships.id, plan.memberships[0].id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(schema.templeMemberships)
        .set({ grade: 1.5 })
        .where(eq(schema.templeMemberships.id, plan.memberships[0].id)),
    ).rejects.toThrow();
    expect((await db.select().from(schema.templeMemberships))[0].grade).toBe(0);
  });

  it("enforces normalized slug uniqueness without requiring group-name uniqueness", async () => {
    await importSynthetic();
    await expect(
      db
        .insert(schema.temples)
        .values({ name: "Another temple", slug: " temple-example " }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.temples).values({ name: "Empty slug", slug: "   " }),
    ).rejects.toThrow();
    const [group] = await db
      .insert(schema.userGroups)
      .values({ name: "Synthetic Group" })
      .returning();
    expect(isUuidV7(group.id)).toBe(true);
    expect(await db.select().from(schema.userGroups)).toHaveLength(2);
  });

  it("keeps non-ASCII-space slug keys distinct exactly as import preflight does", async () => {
    await importSynthetic();
    for (const slug of [
      "\tTemple-Example\t",
      "\u00a0Temple-Example\u00a0",
      "Temple-Example \n",
      "Temple-Example\n",
    ]) {
      const [created] = await db
        .insert(schema.temples)
        .values({ name: "Exact spelling", slug })
        .returning();
      expect(created.slug).toBe(slug);
    }
    expect(await db.select().from(schema.temples)).toHaveLength(5);
  });

  it("permits admin-only grants and rejects duplicate, empty or orphan grants", async () => {
    const plan = await importSynthetic();
    expect(plan.grants[1]).toMatchObject({ member: false, admin: true });
    await expect(
      db.insert(schema.userGroupGrants).values(plan.grants[1]),
    ).rejects.toThrow();
    await expect(
      db.update(schema.userGroupGrants).set({ member: false, admin: false }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.userGroupGrants).values({
        userId: createUuidV7(),
        groupId: plan.groups[0].id,
        admin: true,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.userGroupGrants).values({
        userId: plan.grants[0].userId,
        groupId: createUuidV7(),
        member: true,
      }),
    ).rejects.toThrow();
  });

  it("does not invent a creator or cascade destructive deletion through domain data", async () => {
    const plan = await importSynthetic();
    expect((await db.select().from(schema.temples))[0].createdById).toBeNull();
    await expect(
      db
        .delete(schema.user)
        .where(eq(schema.user.id, plan.memberships[0].userId)),
    ).rejects.toThrow();
    await expect(db.delete(schema.temples)).rejects.toThrow();
    await expect(
      db
        .insert(schema.templeInvites)
        .values({ templeId: createUuidV7(), joinPass: "synthetic-only" }),
    ).rejects.toThrow();
    await expect(
      db.update(schema.temples).set({ createdById: createUuidV7() }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.userGroups).values({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Wrong version",
      }),
    ).rejects.toThrow();
  });

  it("rolls back aliases and domain rows together after a failed dependency", async () => {
    const test = fixture();
    await expect(
      db.transaction(async (tx) => {
        const id = await ensureLegacyId(tx, test.primaries[3]);
        await tx
          .insert(schema.userGroups)
          .values({ id, name: "Rollback group" });
        await tx
          .insert(schema.userGroupGrants)
          .values({ userId: createUuidV7(), groupId: id, admin: true });
      }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.userGroups)).toEqual([]);
    expect(await db.select().from(schema.legacyIdAliases)).toEqual([]);
  });
});
