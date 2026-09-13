import { isUuidV7 } from "../lib/ids";
import { newCardStats, reviewCardAt } from "./scheduling";
import type { StudyRuntimeCardStats, StudyRuntimeSetStats } from "./types";

export type StudyMode = "supermemo" | "repetition";

/** Immutable review facts. Account ownership is a precondition, never authorship. */
export interface StudyReviewRequest {
  version: 1;
  eventId: string;
  expectedActorId: string;
  setId: string;
  cardId: string;
  mode: StudyMode;
  wrongCount: number;
  elapsedMs: number;
  answeredAtMs: number;
}

export interface StudyServerSnapshot extends StudyRuntimeSetStats {
  _id: string;
  userId: string;
  version: number;
}

export interface StudySnapshotWire {
  id: string;
  userId: string;
  setId: string;
  correct: number;
  incorrect: number;
  time: number;
  dueAtMs: number;
  version: number;
  cards: Record<
    string,
    Omit<StudyRuntimeCardStats, "dueDate" | "repetition"> & {
      dueAtMs: number;
      repetition?: { weight?: number };
    }
  >;
}

export type StudyReviewResult =
  | {
      ok: true;
      eventId: string;
      replayed: boolean;
      acceptedVersion: number;
      snapshot: StudyServerSnapshot;
    }
  | {
      ok: false;
      code:
        | "INVALID_REQUEST"
        | "NOT_AUTHENTICATED"
        | "ACCOUNT_CHANGED"
        | "IDEMPOTENCY_KEY_REUSED"
        | "RETRYABLE"
        | "UNAVAILABLE";
      message: string;
      retryable: boolean;
    };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function validText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\0") &&
    value.isWellFormed()
  );
}

function safeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validEpochMs(value: unknown): value is number {
  return safeCount(value) && Number.isFinite(new Date(Number(value)).getTime());
}

/** Strict parser shared by the route and browser response tests. */
export function parseStudyReviewRequest(
  input: unknown,
): StudyReviewRequest | null {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return null;
  const row = input as Record<string, unknown>;
  const keys = [
    "version",
    "eventId",
    "expectedActorId",
    "setId",
    "cardId",
    "mode",
    "wrongCount",
    "elapsedMs",
    "answeredAtMs",
  ];
  if (
    Object.keys(row).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(row, key)) ||
    row.version !== 1 ||
    !isUuidV7(row.eventId) ||
    row.eventId !== row.eventId.toLowerCase() ||
    !isUuidV7(row.expectedActorId) ||
    row.expectedActorId !== row.expectedActorId.toLowerCase() ||
    !validText(row.setId, 200) ||
    !validText(row.cardId, 500) ||
    (row.mode !== "supermemo" && row.mode !== "repetition") ||
    !safeCount(row.wrongCount) ||
    !safeCount(row.elapsedMs) ||
    !validEpochMs(row.answeredAtMs) ||
    row.wrongCount > 10_000 ||
    row.elapsedMs > MAX_SAFE
  )
    return null;
  return row as unknown as StudyReviewRequest;
}

function copyCard(card: StudyRuntimeCardStats): StudyRuntimeCardStats {
  return {
    correct: card.correct,
    incorrect: card.incorrect,
    time: card.time,
    dueDate: new Date(card.dueDate.getTime()),
    supermemo: { ...card.supermemo },
    ...(Object.hasOwn(card, "repetition")
      ? { repetition: card.repetition ? { ...card.repetition } : undefined }
      : {}),
  };
}

/** Copies a baseline and materializes newly-added content cards without changing totals. */
export function materializeStudyCards(
  input: StudyRuntimeSetStats,
  cardIds: readonly string[],
  dueAtMs: number,
): StudyRuntimeSetStats {
  const cards: Record<string, StudyRuntimeCardStats> = Object.create(null);
  for (const [cardId, card] of Object.entries(input.cards))
    cards[cardId] = copyCard(card);
  let dueDate = new Date(input.dueDate.getTime());
  for (const cardId of cardIds) {
    if (Object.hasOwn(cards, cardId)) continue;
    cards[cardId] = newCardStats(new Date(dueAtMs));
    if (dueAtMs < dueDate.getTime()) dueDate = new Date(dueAtMs);
  }
  return {
    ...input,
    dueDate,
    cards,
  };
}

/** Applies one validated event while preserving imported cumulative baselines exactly. */
export function applyStudyReview(
  input: StudyRuntimeSetStats,
  event: Pick<
    StudyReviewRequest,
    "cardId" | "wrongCount" | "elapsedMs" | "answeredAtMs" | "mode"
  >,
): StudyRuntimeSetStats {
  const { card, ...set } = reviewCardAt(event.cardId, input, event);
  if (
    !safeCount(set.correct) ||
    !safeCount(set.incorrect) ||
    !safeCount(set.time) ||
    !safeCount(card.correct) ||
    !safeCount(card.incorrect) ||
    !safeCount(card.time) ||
    !Number.isFinite(card.dueDate.getTime()) ||
    (set.dueDate && !Number.isFinite(set.dueDate.getTime()))
  )
    throw new Error("Study review exceeds the durable counter or date range.");
  return {
    ...input,
    ...set,
    cards: { ...input.cards, [event.cardId]: card },
  };
}

export function studySnapshotToWire(
  snapshot: StudyServerSnapshot,
): StudySnapshotWire {
  return {
    id: snapshot._id,
    userId: snapshot.userId,
    setId: snapshot.setId,
    correct: snapshot.correct,
    incorrect: snapshot.incorrect,
    time: snapshot.time,
    dueAtMs: snapshot.dueDate.getTime(),
    version: snapshot.version,
    cards: Object.fromEntries(
      Object.entries(snapshot.cards).map(([id, card]) => {
        const { dueDate: _dueDate, ...rest } = copyCard(card);
        return [id, { ...rest, dueAtMs: card.dueDate.getTime() }];
      }),
    ) as StudySnapshotWire["cards"],
  };
}

export function studySnapshotFromWire(
  input: unknown,
): StudyServerSnapshot | null {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return null;
  const row = input as Record<string, unknown>;
  if (
    !isUuidV7(row.id) ||
    !isUuidV7(row.userId) ||
    !validText(row.setId, 200) ||
    !safeCount(row.correct) ||
    !safeCount(row.incorrect) ||
    !safeCount(row.time) ||
    !validEpochMs(row.dueAtMs) ||
    !safeCount(row.version) ||
    row.cards === null ||
    typeof row.cards !== "object" ||
    Array.isArray(row.cards)
  )
    return null;
  const cards: Record<string, StudyRuntimeCardStats> = Object.create(null);
  for (const [cardId, value] of Object.entries(
    row.cards as Record<string, unknown>,
  )) {
    if (
      !validText(cardId, 500) ||
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return null;
    const card = value as Record<string, unknown>;
    const memo = card.supermemo as Record<string, unknown> | null;
    if (
      !safeCount(card.correct) ||
      !safeCount(card.incorrect) ||
      !safeCount(card.time) ||
      !validEpochMs(card.dueAtMs) ||
      !memo ||
      !Number.isFinite(memo.interval) ||
      Number(memo.interval) < 0 ||
      !safeCount(memo.repetition) ||
      !Number.isFinite(memo.efactor) ||
      Number(memo.efactor) <= 0
    )
      return null;
    let repetition: StudyRuntimeCardStats["repetition"];
    if (Object.hasOwn(card, "repetition")) {
      if (
        card.repetition === null ||
        typeof card.repetition !== "object" ||
        Array.isArray(card.repetition)
      )
        return null;
      const rep = card.repetition as Record<string, unknown>;
      if (
        Object.keys(rep).some((key) => key !== "weight") ||
        (Object.hasOwn(rep, "weight") && !safeCount(rep.weight))
      )
        return null;
      repetition = Object.hasOwn(rep, "weight")
        ? { weight: rep.weight as number }
        : {};
    }
    cards[cardId] = {
      correct: card.correct,
      incorrect: card.incorrect,
      time: card.time,
      dueDate: new Date(card.dueAtMs),
      supermemo: {
        interval: memo.interval as number,
        repetition: memo.repetition as number,
        efactor: memo.efactor as number,
      },
      ...(Object.hasOwn(card, "repetition") ? { repetition } : {}),
    };
  }
  return {
    _id: row.id,
    userId: row.userId,
    setId: row.setId,
    correct: row.correct,
    incorrect: row.incorrect,
    time: row.time,
    dueDate: new Date(row.dueAtMs),
    version: row.version,
    cards,
  } as StudyServerSnapshot;
}
