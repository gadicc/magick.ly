import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { syncStudyProgress } from "./clientTransport";
import {
  type StudyServerSnapshot,
  studySnapshotFromWire,
  studySnapshotToWire,
} from "./reviewContract";
import { StudyDatabase, StudyRepository } from "./storage";

const A = "01993000-0000-7000-8000-000000000001";
const B = "01993000-0000-7000-8000-000000000002";
const START = 2_000_000_000_000;
const databases: StudyDatabase[] = [];
const repositories: StudyRepository[] = [];

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const database of databases.splice(0)) database.close();
  await Dexie.waitFor(Promise.resolve());
  vi.restoreAllMocks();
});

function fixture(twoTabs = false) {
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const name = `study-${createUuidV7()}`;
  const firstDb = new StudyDatabase(name, options);
  const first = new StudyRepository(firstDb, { broadcast: false });
  databases.push(firstDb);
  repositories.push(first);
  if (!twoTabs) return { first };
  const secondDb = new StudyDatabase(name, options);
  const second = new StudyRepository(secondDb, { broadcast: false });
  databases.push(secondDb);
  repositories.push(second);
  return { first, second };
}

function serverSnapshot(
  ownerId: string,
  patch: Partial<StudyServerSnapshot> = {},
): StudyServerSnapshot {
  return {
    _id: createUuidV7(),
    userId: ownerId,
    setId: "synthetic",
    correct: 1,
    incorrect: 0,
    time: 1_000,
    dueDate: new Date(START + 86_400_000),
    version: 1,
    cards: {
      one: {
        correct: 1,
        incorrect: 0,
        time: 1_000,
        dueDate: new Date(START + 86_400_000),
        supermemo: { interval: 1, repetition: 1, efactor: 2.6 },
        repetition: { weight: 1 },
      },
      two: {
        correct: 0,
        incorrect: 0,
        time: 0,
        dueDate: new Date(START),
        supermemo: { interval: 0, repetition: 0, efactor: 2.5 },
        repetition: { weight: 1 },
      },
    },
    ...patch,
  };
}

describe("study Dexie scopes and outbox", () => {
  it("rejects wire dates outside the JavaScript date range", () => {
    expect(
      studySnapshotFromWire({
        ...studySnapshotToWire(serverSnapshot(A)),
        dueAtMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toBeNull();
    expect(
      studySnapshotFromWire({
        ...studySnapshotToWire(serverSnapshot(A)),
        cards: {
          ...studySnapshotToWire(serverSnapshot(A)).cards,
          one: {
            ...studySnapshotToWire(serverSnapshot(A)).cards.one,
            dueAtMs: Number.MAX_SAFE_INTEGER,
          },
        },
      }),
    ).toBeNull();
  });

  it("keeps stable anonymous progress separate through account switching", async () => {
    const { first } = fixture();
    const anonymous = await first.scope(null);
    await first.recordReview(
      anonymous,
      {
        setId: "synthetic",
        cardId: "one",
        mode: "repetition",
        wrongCount: 0,
        elapsedMs: 1_250,
        answeredAtMs: START,
      },
      ["one"],
    );
    expect((await first.getSnapshot(anonymous, "synthetic"))?.correct).toBe(1);
    expect((await first.scope(null)).ownerId).toBe(anonymous.ownerId);

    const accountA = await first.scope(A);
    const accountB = await first.scope(B);
    expect(await first.lastLocalAccountId()).toBe(B);
    expect(
      (await first.ensureSnapshot(accountA, "synthetic", ["one"], START))
        .correct,
    ).toBe(0);
    expect(
      (await first.ensureSnapshot(accountB, "synthetic", ["one"], START))
        .correct,
    ).toBe(0);
    expect((await first.getSnapshot(anonymous, "synthetic"))?.correct).toBe(1);
    const [localEvent] = await first.storage.events.toArray();
    expect(localEvent).toMatchObject({
      scopeKey: anonymous.key,
      expectedActorId: null,
      status: "local-only",
    });
    expect(await first.claimNext(accountA, START)).toBeNull();
    await first.markSignedOut();
    expect(await first.lastLocalAccountId()).toBeNull();
    expect((await first.getSnapshot(accountA, "synthetic"))?.correct).toBe(0);

    await expect(
      first.recordReview(
        anonymous,
        {
          setId: "synthetic",
          cardId: "one",
          mode: "repetition",
          wrongCount: 0,
          elapsedMs: 1,
          answeredAtMs: Number.MAX_SAFE_INTEGER,
        },
        ["one"],
      ),
    ).rejects.toThrow(/Invalid local study review/);
  });

  it("serializes two tabs, retries the same UUID and retains later optimistic work", async () => {
    const { first, second } = fixture(true);
    if (!second) throw new Error("Expected second synthetic tab.");
    const scope = await first.scope(A);
    await first.ensureSnapshot(scope, "synthetic", ["one", "two"], START);
    const firstEvent = await first.recordReview(
      scope,
      {
        setId: "synthetic",
        cardId: "one",
        mode: "supermemo",
        wrongCount: 0,
        elapsedMs: 1_000,
        answeredAtMs: START,
      },
      ["one", "two"],
    );
    await second.recordReview(
      scope,
      {
        setId: "synthetic",
        cardId: "two",
        mode: "repetition",
        wrongCount: 1,
        elapsedMs: 2_000,
        answeredAtMs: START + 1,
      },
      ["one", "two"],
    );
    const claims = await Promise.all([
      first.claimNext(scope, START + 2),
      second.claimNext(scope, START + 2),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find(Boolean);
    if (!claimed) throw new Error("Expected a review claim.");
    expect(claimed.event.eventId).toBe(firstEvent.eventId);
    expect(await first.releaseClaim(claimed, "NETWORK_ERROR", true)).toBe(true);
    const retried = await second.claimNext(scope, START + 3);
    expect(retried?.event.eventId).toBe(firstEvent.eventId);
    expect(retried?.event.attempts).toBe(2);
    if (!retried) throw new Error("Expected retry claim.");
    expect(
      await second.settleClaim(
        scope,
        retried,
        firstEvent.eventId,
        serverSnapshot(A),
      ),
    ).toBe(true);
    expect(await second.getSnapshot(scope, "synthetic")).toMatchObject({
      correct: 1,
      incorrect: 1,
      time: 3_000,
    });
    const remaining = await second.storage.events
      .where("scopeKey")
      .equals(scope.key)
      .toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      cardId: "two",
      status: "queued",
      expectedActorId: A,
    });
  });

  it("keeps a lost response queued and rejects foreign server snapshots atomically", async () => {
    const { first } = fixture();
    const scope = await first.scope(A);
    const event = await first.recordReview(
      scope,
      {
        setId: "synthetic",
        cardId: "one",
        mode: "supermemo",
        wrongCount: 0,
        elapsedMs: 1_000,
        answeredAtMs: START,
      },
      ["one"],
    );
    const failedFetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(
      await syncStudyProgress(first, scope, { fetch: failedFetch }),
    ).toEqual({ sent: 0, blocked: "NETWORK_ERROR" });
    expect(await first.storage.events.get(event.eventId)).toMatchObject({
      eventId: event.eventId,
      status: "queued",
      attempts: 1,
    });

    const malformedFetch = vi.fn(
      async () => new Response("temporary upstream failure", { status: 503 }),
    );
    expect(
      await syncStudyProgress(first, scope, { fetch: malformedFetch }),
    ).toEqual({ sent: 0, blocked: "MALFORMED_RESPONSE" });
    expect(await first.storage.events.get(event.eventId)).toMatchObject({
      eventId: event.eventId,
      status: "queued",
      attempts: 2,
    });

    const wrongAcknowledgement = vi.fn(async () =>
      Response.json({
        ok: true,
        eventId: createUuidV7(),
        replayed: false,
        acceptedVersion: 1,
        snapshot: studySnapshotToWire(serverSnapshot(A)),
      }),
    );
    expect(
      await syncStudyProgress(first, scope, { fetch: wrongAcknowledgement }),
    ).toEqual({ sent: 0, blocked: "MALFORMED_RESPONSE" });
    expect(await first.storage.events.get(event.eventId)).toMatchObject({
      eventId: event.eventId,
      status: "queued",
      attempts: 3,
    });

    const accepted = serverSnapshot(A);
    await first.acceptServerSnapshots(scope, [accepted]);
    // The GET may already include this lost-ack event; it must not be replayed locally.
    expect(await first.getSnapshot(scope, "synthetic")).toMatchObject({
      correct: 1,
      time: 1_000,
    });
    expect(
      (await first.storage.snapshots.toArray())[0].serverSnapshot,
    ).toBeNull();
    const successFetch = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        eventId: event.eventId,
        expectedActorId: A,
      });
      return Response.json({
        ok: true,
        eventId: event.eventId,
        replayed: true,
        acceptedVersion: 1,
        snapshot: studySnapshotToWire(accepted),
      });
    });
    expect(
      await syncStudyProgress(first, scope, { fetch: successFetch }),
    ).toEqual({ sent: 1 });
    expect(await first.storage.events.get(event.eventId)).toBeUndefined();

    const before = await first.getSnapshot(scope, "synthetic");
    await expect(
      first.acceptServerSnapshots(scope, [
        { ...accepted, setId: "new-own" },
        serverSnapshot(B, { setId: "foreign" }),
      ]),
    ).rejects.toThrow(/another account/);
    expect(await first.getSnapshot(scope, "new-own")).toBeUndefined();
    expect(await first.getSnapshot(scope, "synthetic")).toEqual(before);
  });

  it("retains an explicitly rejected event as recovery evidence but removes its optimistic result", async () => {
    const { first } = fixture();
    const scope = await first.scope(A);
    const event = await first.recordReview(
      scope,
      {
        setId: "synthetic",
        cardId: "one",
        mode: "supermemo",
        wrongCount: 0,
        elapsedMs: 1_000,
        answeredAtMs: START,
      },
      ["one"],
    );
    expect((await first.getSnapshot(scope, "synthetic"))?.correct).toBe(1);
    const rejectedFetch = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          message: "Synthetic permanent rejection",
          retryable: false,
        },
        { status: 400 },
      ),
    );
    expect(
      await syncStudyProgress(first, scope, { fetch: rejectedFetch }),
    ).toEqual({ sent: 0, blocked: "INVALID_REQUEST" });
    expect(await first.storage.events.get(event.eventId)).toMatchObject({
      status: "rejected",
      lastError: "INVALID_REQUEST",
    });
    expect(await first.getSnapshot(scope, "synthetic")).toMatchObject({
      correct: 0,
      time: 0,
    });
  });
});
