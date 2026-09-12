import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { EJSON } from "bson";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { StudySetStats } from "../src/app/study/[_id]/exports";
import { ensureLegacyId } from "../src/db/legacyIds";
import * as auth from "../src/db/schema/auth";
import * as alias from "../src/db/schema/legacyIds";
import * as study from "../src/db/schema/studyProgress";
import { createUuidV7, isUuidV7 } from "../src/lib/ids";
import { planLegacyStudyImport } from "../src/migration/planLegacyStudyImport";
import { studyProgressSnapshot } from "../src/study/progressSnapshot";
import { dueCount, repetitionCards, reviewCard } from "../src/study/scheduling";
import { fixture } from "./studyFixtures";

const schema = { ...auth, ...alias, ...study };
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  await db.delete(study.legacyStudySnapshots);
  await db.delete(study.studyCardStates);
  await db.delete(study.studyProgress);
  await db.delete(auth.user);
  await db.delete(alias.legacyIdAliases);
});
async function importSynthetic(large = false) {
  const test = fixture(large);
  const plan = planLegacyStudyImport(test.input, test.options());
  await db.transaction(async (tx) => {
    for (const ref of test.refs)
      await ensureLegacyId(tx, ref, test.lookup(ref)!);
    await tx.insert(auth.user).values(
      test.options().canonicalUserIds.map((id, index) => ({
        id,
        name: `Synthetic ${index}`,
        email: `synthetic-${index}@example.test`,
      })),
    );
    await tx.insert(study.studyProgress).values(plan.progress);
    await tx.insert(study.studyCardStates).values(plan.cards);
    await tx.insert(study.legacyStudySnapshots).values(plan.snapshots);
  });
  return { test, plan };
}

describe("study schema and scheduler boundary on PGlite", () => {
  it("persists the synthetic 667/459 source shape without counting archived duplicate cards as active", async () => {
    const { plan } = await importSynthetic(true);
    expect(await db.select().from(study.studyProgress)).toHaveLength(48);
    expect(await db.select().from(study.studyCardStates)).toHaveLength(656);
    const snapshots = await db.select().from(study.legacyStudySnapshots);
    expect(snapshots).toHaveLength(49);
    const archived = snapshots.filter(
      (row) => row.disposition === "empty-duplicate",
    );
    expect(archived).toHaveLength(1);
    const restored = snapshots.map((row) =>
      EJSON.parse(row.sourceEjson, { relaxed: true }),
    );
    expect(restored.flatMap((row) => Object.values(row.cards))).toHaveLength(
      667,
    );
    expect(
      restored
        .flatMap((row) => Object.values(row.cards))
        .filter((card) => Object.hasOwn(card as object, "repetition")),
    ).toHaveLength(459);
    expect(plan.counts.aggregateMismatchRows).toBe(11);
  });

  it("hydrates Dates and absent repetition for the existing scheduler without recomputing totals", async () => {
    const { plan } = await importSynthetic();
    const [progress] = await db
      .select()
      .from(study.studyProgress)
      .where(eq(study.studyProgress.id, plan.progress[1].id));
    const cards = await db
      .select()
      .from(study.studyCardStates)
      .where(eq(study.studyCardStates.progressId, progress.id));
    const snapshot = studyProgressSnapshot(progress, cards);
    expect(snapshot.dueDate).toBeInstanceOf(Date);
    expect(snapshot.cards["card-1"].dueDate).toBeInstanceOf(Date);
    expect(snapshot.cards["card-1"]).not.toHaveProperty("repetition");
    // The legacy TS export incorrectly requires repetition; runtime already supports its absence.
    const schedulerInput = snapshot as StudySetStats;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    expect(dueCount(schedulerInput)).toBe(3);
    const contentCard = {
      id: "card-1",
      question: "q",
      answer: "a",
      answers: ["a"],
    };
    expect(repetitionCards([contentCard], schedulerInput)).toEqual([
      contentCard,
    ]);
    const update = reviewCard("card-1", schedulerInput, {
      wrongCount: 0,
      startTime: Date.now() - 1200,
      mode: "supermemo",
    });
    expect(update.correct).toBe(progress.correct + 1);
    expect(update.time).toBe(progress.time + 1200);
    expect(update.card.dueDate).toBeInstanceOf(Date);
    expect(snapshot.cards["card-1"].correct).toBe(2);
    const first = (
      await db
        .select()
        .from(study.studyProgress)
        .where(eq(study.studyProgress.id, plan.progress[0].id))
    )[0];
    expect(first.correct).toBe(5); // Its cards sum to four; the legacy mismatch stays intact.
  });

  it("round-trips all repetition presence states and keeps the existing scheduler fallback", async () => {
    const { plan } = await importSynthetic();
    const id = plan.progress[1].id;
    const [progress] = await db
      .select()
      .from(study.studyProgress)
      .where(eq(study.studyProgress.id, id));
    await db
      .update(study.studyCardStates)
      .set({ repetitionPresent: true })
      .where(eq(study.studyCardStates.cardKey, "card-1"));
    const states = await db
      .select()
      .from(study.studyCardStates)
      .where(eq(study.studyCardStates.progressId, id));
    const snapshot = studyProgressSnapshot(progress, states);
    expect(snapshot.cards["card-0"].repetition).toEqual({ weight: 0 });
    expect(snapshot.cards["card-1"].repetition).toEqual({});
    expect(snapshot.cards["card-2"]).not.toHaveProperty("repetition");
    const content = ["card-0", "card-1", "card-2"].map((id) => ({
      id,
      question: "q",
      answer: "a",
      answers: ["a"],
    }));
    expect(repetitionCards(content, snapshot as StudySetStats)).toEqual(
      content,
    );
    await expect(
      db
        .update(study.studyCardStates)
        .set({ repetitionPresent: false, repetitionWeight: 2 }),
    ).rejects.toThrow();
  });

  it("keeps snapshot ownership/card identity strict and cannot mutate input timestamps", async () => {
    const { plan } = await importSynthetic();
    const [progress] = await db
      .select()
      .from(study.studyProgress)
      .where(eq(study.studyProgress.id, plan.progress[0].id));
    const cards = await db
      .select()
      .from(study.studyCardStates)
      .where(eq(study.studyCardStates.progressId, progress.id));
    expect(() =>
      studyProgressSnapshot(progress, [
        { ...cards[0], progressId: createUuidV7() },
      ]),
    ).toThrow(/exactly one baseline/);
    expect(() => studyProgressSnapshot(progress, [cards[0], cards[0]])).toThrow(
      /exactly one baseline/,
    );
    expect(() =>
      studyProgressSnapshot(
        { ...progress, dueDate: progress.dueDate.toISOString() } as never,
        cards,
      ),
    ).toThrow(/hydrated Date/);
    const snapshot = studyProgressSnapshot(progress, cards);
    snapshot.dueDate.setTime(0);
    snapshot.cards["card-0"].dueDate.setTime(0);
    expect(progress.dueDate.getTime()).not.toBe(0);
    expect(cards[0].dueDate.getTime()).not.toBe(0);
    const proto = studyProgressSnapshot(progress, [
      { ...cards[0], cardKey: "__proto__" },
    ]);
    expect(Object.hasOwn(proto.cards, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(proto.cards)).toBeNull();
  });

  it("enforces unique user/set and card keys while preserving exact case-sensitive content identities", async () => {
    const { plan } = await importSynthetic();
    await expect(
      db
        .insert(study.studyProgress)
        .values({ ...plan.progress[0], id: createUuidV7() }),
    ).rejects.toThrow();
    await expect(
      db.insert(study.studyCardStates).values(plan.cards[0]),
    ).rejects.toThrow();
    const [different] = await db
      .insert(study.studyProgress)
      .values({
        ...plan.progress[0],
        id: createUuidV7(),
        setId: "Synthetic-set-0",
      })
      .returning();
    expect(different.setId).toBe("Synthetic-set-0");
    await db
      .insert(study.studyCardStates)
      .values({ ...plan.cards[0], cardKey: "CARD-0" });
    await expect(
      db.update(study.studyProgress).set({ setId: "" }),
    ).rejects.toThrow();
    await expect(
      db.update(study.studyCardStates).set({ cardKey: "" }),
    ).rejects.toThrow();
  });

  it("preserves optional repetition and rejects invalid counters, floats and orphan links", async () => {
    const { plan } = await importSynthetic();
    for (const patch of [
      { correct: -1 },
      { time: 0.5 },
      { incorrect: Number.MAX_SAFE_INTEGER + 1 },
      { version: -1 },
    ])
      await expect(db.update(study.studyProgress).set(patch)).rejects.toThrow();
    for (const patch of [
      { interval: Infinity },
      { interval: NaN },
      { efactor: 0 },
      { repetition: -1 },
      { repetitionWeight: -1 },
    ])
      await expect(
        db.update(study.studyCardStates).set(patch),
      ).rejects.toThrow();
    expect(
      (await db.select().from(study.studyCardStates)).some(
        (card) => card.repetitionWeight === null,
      ),
    ).toBe(true);
    expect(
      (await db.select().from(study.studyCardStates)).some(
        (card) => card.repetitionWeight === 0,
      ),
    ).toBe(true);
    await expect(
      db.insert(study.studyProgress).values({
        ...plan.progress[0],
        id: createUuidV7(),
        userId: createUuidV7(),
      }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(study.studyCardStates)
        .values({ ...plan.cards[0], progressId: createUuidV7() }),
    ).rejects.toThrow();
    await expect(db.delete(auth.user)).rejects.toThrow();
    await expect(db.delete(study.studyProgress)).rejects.toThrow();
  });

  it("keeps durable aliases stable and protects original snapshot integrity", async () => {
    const { test, plan } = await importSynthetic();
    const before = await db.select().from(alias.legacyIdAliases);
    for (const mapping of plan.aliases)
      expect(
        await ensureLegacyId(db, mapping.source, mapping.canonicalId),
      ).toBe(mapping.canonicalId);
    expect(await db.select().from(alias.legacyIdAliases)).toEqual(before);
    expect(planLegacyStudyImport(test.input, test.options())).toEqual(plan);
    await expect(
      db.update(study.legacyStudySnapshots).set({ sourceEjson: "{}" }),
    ).rejects.toThrow();
    await expect(
      db.insert(study.legacyStudySnapshots).values({
        ...plan.snapshots[0],
        legacyIdType: "string",
        legacyIdValue: "another-original",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(study.legacyStudySnapshots).values(plan.snapshots[0]),
    ).rejects.toThrow();
    await expect(
      db
        .update(study.legacyStudySnapshots)
        .set({ disposition: "unknown" as never }),
    ).rejects.toThrow();
  });

  it("allocates UUIDv7 and rolls aliases/baselines back together on an invalid card", async () => {
    const { test, plan } = await importSynthetic();
    const [generated] = await db
      .insert(study.studyProgress)
      .values({
        ...plan.progress[0],
        id: undefined,
        setId: "synthetic-default-id",
      })
      .returning();
    expect(isUuidV7(generated.id)).toBe(true);
    await expect(
      db.insert(study.studyProgress).values({
        ...plan.progress[0],
        id: "550e8400-e29b-41d4-a716-446655440000",
        setId: "wrong-version",
      }),
    ).rejects.toThrow();
    const before = await db.select().from(alias.legacyIdAliases);
    await expect(
      db.transaction(async (tx) => {
        const id = await ensureLegacyId(tx, {
          ...test.keep,
          legacyIdType: "string",
          legacyIdValue: "synthetic-rollback",
        });
        await tx
          .insert(study.studyProgress)
          .values({ ...plan.progress[0], id, setId: "synthetic-rollback" });
        await tx
          .insert(study.studyCardStates)
          .values({ ...plan.cards[0], progressId: id, correct: -1 });
      }),
    ).rejects.toThrow();
    expect(await db.select().from(alias.legacyIdAliases)).toEqual(before);
    expect(
      (await db.select().from(study.studyProgress)).some(
        (row) => row.setId === "synthetic-rollback",
      ),
    ).toBe(false);
  });
});
