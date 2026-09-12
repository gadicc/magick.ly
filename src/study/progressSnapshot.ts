import type {
  studyCardStates,
  studyProgress,
} from "../db/schema/studyProgress";

/** Current scheduler shape with the supported historical absence of repetition state. */
export interface StudyProgressSnapshot {
  _id: string;
  userId: string;
  setId: string;
  correct: number;
  incorrect: number;
  time: number;
  dueDate: Date;
  cards: Record<
    string,
    {
      correct: number;
      incorrect: number;
      time: number;
      dueDate: Date;
      supermemo: { interval: number; repetition: number; efactor: number };
      repetition?: { weight?: number };
    }
  >;
}
function copyDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Study SQL timestamps must be hydrated Date values.");
  return new Date(value.getTime());
}
/**
 * Reconstructs one SQL baseline without filling absent schedules, recomputing
 * totals or claiming legacy sync tokens. It rejects foreign/duplicate card rows.
 */
export function studyProgressSnapshot(
  progress: typeof studyProgress.$inferSelect,
  cards: readonly (typeof studyCardStates.$inferSelect)[],
): StudyProgressSnapshot {
  const result: StudyProgressSnapshot = {
    _id: progress.id,
    userId: progress.userId,
    setId: progress.setId,
    correct: progress.correct,
    incorrect: progress.incorrect,
    time: progress.time,
    dueDate: copyDate(progress.dueDate),
    cards: Object.create(null),
  };
  for (const card of cards) {
    if (
      card.progressId !== progress.id ||
      Object.hasOwn(result.cards, card.cardKey)
    )
      throw new Error("Study cards do not belong to exactly one baseline.");
    result.cards[card.cardKey] = {
      correct: card.correct,
      incorrect: card.incorrect,
      time: card.time,
      dueDate: copyDate(card.dueDate),
      supermemo: {
        interval: card.interval,
        repetition: card.repetition,
        efactor: card.efactor,
      },
      ...(card.repetitionPresent
        ? {
            repetition:
              card.repetitionWeight === null
                ? {}
                : { weight: card.repetitionWeight },
          }
        : {}),
    };
  }
  return result;
}
