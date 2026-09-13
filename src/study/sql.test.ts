import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import {
  studyCardStates,
  studyProgress,
  studyReviewReceipts,
} from "../db/schema/studyProgress";
import { createUuidV7 } from "../lib/ids";
import type { StudyReviewRequest } from "./reviewContract";
import { createSqlStudyService } from "./sql";

vi.mock("server-only", () => ({}));

const schema = { user, studyProgress, studyCardStates, studyReviewReceipts };
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());
const actorId = createUuidV7();
const otherActorId = createUuidV7();
const acceptedAt = new Date("2026-09-13T12:00:00.000Z");
const answeredAtMs = new Date("2026-09-12T10:00:00.000Z").getTime();

function request(patch: Partial<StudyReviewRequest> = {}): StudyReviewRequest {
  return {
    version: 1,
    eventId: createUuidV7(),
    expectedActorId: actorId,
    setId: "hebrew-latin",
    cardId: "aleph",
    mode: "supermemo",
    wrongCount: 0,
    elapsedMs: 2_500,
    answeredAtMs,
    ...patch,
  };
}
const content = () => ["aleph", "beth", "gimel"];

beforeEach(async () => {
  await db.delete(studyReviewReceipts);
  await db.delete(studyCardStates);
  await db.delete(studyProgress);
  await db.delete(user);
  await db.insert(user).values([
    { id: actorId, name: "Synthetic actor", email: "study-a@example.test" },
    {
      id: otherActorId,
      name: "Synthetic other actor",
      email: "study-b@example.test",
    },
  ]);
});

describe("account-scoped SQL study reviews", () => {
  it("preserves imported baseline totals and applies an immutable event exactly once", async () => {
    const progressId = createUuidV7();
    await db.insert(studyProgress).values({
      id: progressId,
      userId: actorId,
      setId: "hebrew-latin",
      correct: 41,
      incorrect: 7,
      time: 10_000,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      version: 9,
    });
    await db.insert(studyCardStates).values({
      progressId,
      cardKey: "aleph",
      correct: 1,
      incorrect: 2,
      time: 500,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      interval: 0,
      repetition: 0,
      efactor: 2.5,
      repetitionPresent: false,
      repetitionWeight: null,
    });
    const service = createSqlStudyService(db, async () => actorId, {
      now: () => acceptedAt,
      getCardIds: content,
    });
    const command = request();
    const first = await service.review(command);
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      acceptedVersion: 10,
      snapshot: { correct: 42, incorrect: 7, time: 12_500 },
    });
    if (!first.ok) throw new Error("Expected accepted review.");
    expect(first.snapshot.cards.aleph).toMatchObject({
      correct: 2,
      incorrect: 2,
      time: 3_000,
    });
    expect(first.snapshot.cards.aleph.dueDate.getTime()).toBe(
      answeredAtMs + 86_400_000,
    );
    // All current content cards are durable and immediately due; aggregate totals stay untouched.
    expect(Object.keys(first.snapshot.cards)).toEqual([
      "aleph",
      "beth",
      "gimel",
    ]);

    const replay = await service.review(command);
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      acceptedVersion: 10,
      snapshot: { correct: 42, incorrect: 7, time: 12_500 },
    });
    expect(await db.select().from(studyReviewReceipts)).toHaveLength(1);
    expect((await db.select().from(studyProgress))[0].version).toBe(10);
    const collision = await service.review({ ...command, elapsedMs: 2_501 });
    expect(collision).toMatchObject({
      ok: false,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("keeps a committed review retryable when the session changes before its response", async () => {
    const identity = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(actorId)
      .mockResolvedValueOnce(otherActorId)
      .mockResolvedValue(actorId);
    const service = createSqlStudyService(db, identity, {
      now: () => acceptedAt,
      getCardIds: content,
    });
    const command = request();
    expect(await service.review(command)).toMatchObject({
      ok: false,
      code: "ACCOUNT_CHANGED",
    });
    expect(await db.select().from(studyReviewReceipts)).toHaveLength(1);
    const replay = await service.review(command);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    const [progress] = await db.select().from(studyProgress);
    expect(progress.correct).toBe(1);
    expect(progress.version).toBe(1);
  });

  it("derives ownership from the session and lists no other account's baseline", async () => {
    const own = createSqlStudyService(db, async () => actorId, {
      now: () => acceptedAt,
      getCardIds: content,
    });
    const foreign = createSqlStudyService(db, async () => otherActorId, {
      now: () => acceptedAt,
      getCardIds: content,
    });
    expect(
      await foreign.review(request({ expectedActorId: actorId })),
    ).toMatchObject({ ok: false, code: "ACCOUNT_CHANGED" });
    expect(await db.select().from(studyReviewReceipts)).toHaveLength(0);
    const accepted = await own.review(request());
    expect(accepted.ok).toBe(true);
    expect(await foreign.list()).toEqual({ ok: true, snapshots: [] });
    const list = await own.list("hebrew-latin");
    expect(list).toMatchObject({
      ok: true,
      snapshots: [{ userId: actorId, setId: "hebrew-latin" }],
    });
    expect(
      await db
        .select()
        .from(studyProgress)
        .where(eq(studyProgress.userId, otherActorId)),
    ).toHaveLength(0);
  });
});
