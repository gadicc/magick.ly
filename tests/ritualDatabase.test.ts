import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureLegacyId } from "../src/db/legacyIds";
import * as auth from "../src/db/schema/auth";
import * as aliases from "../src/db/schema/legacyIds";
import * as membership from "../src/db/schema/memberships";
import * as ritual from "../src/db/schema/rituals";
import { createUuidV7, isUuidV7 } from "../src/lib/ids";
import { planLegacyRitualImport } from "../src/migration/planLegacyRitualImport";
import { fixture, sourceKey } from "./ritualFixtures";

const schema = { ...auth, ...aliases, ...membership, ...ritual };
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
afterAll(() => harness.client.close());
beforeEach(async () => {
  await db.delete(ritual.ritualCompiledArtifacts);
  await db.delete(ritual.legacyRitualCompiledArchives);
  await db.update(ritual.rituals).set({ currentRevisionId: null });
  await db.delete(ritual.ritualRevisions);
  await db.delete(ritual.rituals);
  await db.delete(membership.temples);
  await db.delete(membership.userGroups);
  await db.delete(auth.user);
  await db.delete(aliases.legacyIdAliases);
});

async function importSynthetic() {
  const test = fixture();
  const plan = await db.transaction(async (tx) => {
    for (const ref of test.primaries)
      test.ids.set(sourceKey(ref), await ensureLegacyId(tx, ref));
    const plan = planLegacyRitualImport(test.input, test.options());
    await tx.insert(auth.user).values(
      test.options().canonicalUserIds.map((id, index) => ({
        id,
        name: `Synthetic ${index}`,
        email: `synthetic-${index}@example.test`,
      })),
    );
    await tx.insert(membership.userGroups).values({
      id: test.options().canonicalGroupIds[0],
      name: "Synthetic group",
    });
    await tx.insert(membership.temples).values({
      id: test.options().canonicalTempleIds[0],
      name: "Synthetic temple",
      slug: "synthetic",
    });
    for (const alias of plan.aliases)
      await ensureLegacyId(tx, alias.source, alias.canonicalId);
    await tx.insert(ritual.rituals).values(plan.rituals);
    await tx.insert(ritual.ritualRevisions).values(plan.revisions);
    await tx.insert(ritual.legacyRitualCompiledArchives).values(plan.archives);
    for (const pointer of plan.currentRevisions)
      await tx
        .update(ritual.rituals)
        .set({ currentRevisionId: pointer.revisionId })
        .where(eq(ritual.rituals.id, pointer.ritualId));
    return plan;
  });
  return { test, plan };
}

describe("ritual schema on PGlite", () => {
  it("imports exact source/archive data with stable durable aliases and no invented historical compiled artifacts", async () => {
    const { test, plan } = await importSynthetic();
    expect(await db.select().from(ritual.ritualRevisions)).toEqual(
      plan.revisions,
    );
    expect(await db.select().from(ritual.legacyRitualCompiledArchives)).toEqual(
      plan.archives,
    );
    expect(await db.select().from(ritual.ritualCompiledArtifacts)).toEqual([]);
    const before = await db.select().from(aliases.legacyIdAliases);
    for (const alias of plan.aliases)
      expect(await ensureLegacyId(db, alias.source, alias.canonicalId)).toBe(
        alias.canonicalId,
      );
    expect(await db.select().from(aliases.legacyIdAliases)).toEqual(before);
    expect(planLegacyRitualImport(test.input, test.options())).toEqual(plan);
    const rows = await db.select().from(ritual.rituals);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(isUuidV7(row.id)).toBe(true);
      expect(row.currentRevisionId).toBe(
        plan.currentRevisions.find((pointer) => pointer.ritualId === row.id)
          ?.revisionId,
      );
      expect(row.version).toBe(0);
    }
    expect(rows[2].creatorId).toBeNull();
    expect(rows[2].minGrade).toBe(0);
  });

  it("enforces that the current revision belongs to its own ritual, even for raw SQL updates", async () => {
    const { plan } = await importSynthetic();
    await expect(
      db
        .update(ritual.rituals)
        .set({ currentRevisionId: plan.revisions[3].id })
        .where(eq(ritual.rituals.id, plan.rituals[0].id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.rituals)
        .set({ currentRevisionId: createUuidV7() })
        .where(eq(ritual.rituals.id, plan.rituals[0].id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.ritualRevisions)
        .set({ ritualId: plan.rituals[1].id })
        .where(eq(ritual.ritualRevisions.id, plan.revisions[1].id)),
    ).rejects.toThrow();
    const [row] = await db
      .select()
      .from(ritual.rituals)
      .where(eq(ritual.rituals.id, plan.rituals[0].id));
    expect(row.currentRevisionId).toBe(plan.revisions[1].id);
  });

  it("enforces exclusive scopes and keeps grade zero valid", async () => {
    const { plan } = await importSynthetic();
    const target = eq(ritual.rituals.id, plan.rituals[0].id);
    for (const patch of [
      { scope: "public" as const, groupId: plan.rituals[1].groupId },
      { scope: "group" as const, groupId: null },
      {
        scope: "temple" as const,
        templeId: plan.rituals[2].templeId,
        minGrade: null,
      },
      {
        scope: "temple" as const,
        templeId: plan.rituals[2].templeId,
        minGrade: -1,
      },
      {
        scope: "temple" as const,
        templeId: plan.rituals[2].templeId,
        minGrade: 0.5,
      },
      {
        scope: "group" as const,
        groupId: plan.rituals[1].groupId,
        minGrade: 0,
      },
      {
        scope: "temple" as const,
        templeId: plan.rituals[2].templeId,
        groupId: plan.rituals[1].groupId,
        minGrade: 0,
      },
    ])
      await expect(
        db.update(ritual.rituals).set(patch).where(target),
      ).rejects.toThrow();
    await db
      .update(ritual.rituals)
      .set({ scope: "temple", templeId: plan.rituals[2].templeId, minGrade: 0 })
      .where(target);
    expect(
      (await db.select().from(ritual.rituals).where(target))[0].minGrade,
    ).toBe(0);
  });

  it("rejects unknown authors, creators and scope targets and restricts incidental deletion", async () => {
    await importSynthetic();
    await expect(
      db.update(ritual.ritualRevisions).set({ authorId: createUuidV7() }),
    ).rejects.toThrow();
    await expect(
      db.update(ritual.rituals).set({ creatorId: createUuidV7() }),
    ).rejects.toThrow();
    await expect(
      db.update(ritual.rituals).set({
        scope: "group",
        groupId: createUuidV7(),
        templeId: null,
        minGrade: null,
      }),
    ).rejects.toThrow();
    await expect(db.delete(auth.user)).rejects.toThrow();
    await expect(db.delete(ritual.ritualRevisions)).rejects.toThrow();
    await expect(db.delete(ritual.rituals)).rejects.toThrow();
  });

  it("enforces exact source/content hashes and original archive pointer ownership", async () => {
    const { plan } = await importSynthetic();
    await expect(
      db.update(ritual.ritualRevisions).set({ source: "p altered source" }),
    ).rejects.toThrow();
    await expect(
      db.update(ritual.legacyRitualCompiledArchives).set({ contentJson: "{}" }),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.legacyRitualCompiledArchives)
        .set({ claimedRevisionId: plan.revisions[3].id })
        .where(
          eq(ritual.legacyRitualCompiledArchives.ritualId, plan.rituals[0].id),
        ),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.legacyRitualCompiledArchives)
        .set({ contentJson: "not JSON", contentSha256: hash("not JSON") }),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.legacyRitualCompiledArchives)
        .set({ contentJson: "[]", contentSha256: hash("[]") }),
    ).rejects.toThrow();
    expect(
      (await db.select().from(ritual.legacyRitualCompiledArchives))[0]
        .contentJson,
    ).toContain('"forMe":true');
  });

  it("stores explicit compiler output separately and binds it to the exact source hash", async () => {
    const { plan } = await importSynthetic();
    const contentJson = JSON.stringify({
      children: [{ type: "text", value: "Synthetic compiler result" }],
    });
    const artifact = {
      revisionId: plan.revisions[1].id,
      sourceSha256: plan.revisions[1].sourceSha256!,
      compilerVersion: "synthetic-compiler-v1",
      outputFormat: "jrt",
      outputFormatVersion: "synthetic-jrt-v1",
      transformations: ["synthetic-derived-state-removal-v1"],
      contentJson,
      contentSha256: hash(contentJson),
      compiledAt: new Date("2026-09-12T12:01:00Z"),
    };
    const [created] = await db
      .insert(ritual.ritualCompiledArtifacts)
      .values(artifact)
      .returning();
    expect(isUuidV7(created.id)).toBe(true);
    expect(created.transformations).toEqual(artifact.transformations);
    await expect(
      db
        .insert(ritual.ritualCompiledArtifacts)
        .values({ ...artifact, transformations: [""] }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(ritual.ritualCompiledArtifacts)
        .values({ ...artifact, outputFormat: "" }),
    ).rejects.toThrow();
    const [withoutTransform] = await db
      .insert(ritual.ritualCompiledArtifacts)
      .values({ ...artifact, transformations: [] })
      .returning();
    expect(withoutTransform.transformations).toEqual([]);

    expect(
      (await db.select().from(ritual.legacyRitualCompiledArchives))[0],
    ).toEqual(plan.archives[0]);
    await expect(
      db
        .insert(ritual.ritualCompiledArtifacts)
        .values({ ...artifact, sourceSha256: plan.revisions[0].sourceSha256! }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(ritual.ritualCompiledArtifacts)
        .values({ ...artifact, compilerVersion: " " }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(ritual.ritualCompiledArtifacts)
        .values({ ...artifact, outputFormatVersion: "" }),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritual.ritualRevisions)
        .set({ source: "changed", sourceSha256: hash("changed") })
        .where(eq(ritual.ritualRevisions.id, artifact.revisionId)),
    ).rejects.toThrow();
  });

  it("allocates UUIDv7 defaults and rejects invalid UUID versions and concurrency tokens", async () => {
    const [row] = await db
      .insert(ritual.rituals)
      .values({ title: "Synthetic shell", scope: "public" })
      .returning();
    expect(isUuidV7(row.id)).toBe(true);
    await expect(
      db.insert(ritual.rituals).values({
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Wrong UUID",
        scope: "public",
      }),
    ).rejects.toThrow();
    await expect(
      db.update(ritual.rituals).set({ version: -1 }),
    ).rejects.toThrow();
    await expect(
      db.update(ritual.rituals).set({ version: Number.MAX_SAFE_INTEGER + 1 }),
    ).rejects.toThrow();
  });

  it("rolls back source, pointers, concurrency and aliases when any atomic write fails", async () => {
    const { test, plan } = await importSynthetic();
    const parent = plan.rituals[0];
    const previous = (
      await db
        .select()
        .from(ritual.rituals)
        .where(eq(ritual.rituals.id, parent.id))
    )[0];
    const extraSource = {
      ...test.primaries[0],
      entityType: "docRevisions",
      legacyIdType: "string" as const,
      legacyIdValue: "synthetic-new-revision",
    };
    await expect(
      db.transaction(async (tx) => {
        const id = await ensureLegacyId(tx, extraSource);
        await tx
          .insert(ritual.ritualRevisions)
          .values({ ...plan.revisions[0], id });
        await tx
          .update(ritual.rituals)
          .set({ currentRevisionId: id, version: previous.version + 1 })
          .where(
            and(
              eq(ritual.rituals.id, parent.id),
              eq(ritual.rituals.version, previous.version),
            ),
          );
        await tx
          .update(ritual.legacyRitualCompiledArchives)
          .set({ contentSha256: "invalid" })
          .where(eq(ritual.legacyRitualCompiledArchives.ritualId, parent.id));
      }),
    ).rejects.toThrow();
    expect(
      (
        await db
          .select()
          .from(ritual.rituals)
          .where(eq(ritual.rituals.id, parent.id))
      )[0],
    ).toEqual(previous);
    expect(await db.select().from(ritual.ritualRevisions)).toHaveLength(6);
    expect(
      (await db.select().from(aliases.legacyIdAliases)).some(
        (row) => row.legacyIdValue === "synthetic-new-revision",
      ),
    ).toBe(false);
  });
});
