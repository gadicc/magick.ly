import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudySetStats } from "../app/study/[_id]/exports";
import {
  dueCount,
  fetchDueCards,
  newCardStats,
  newStudySetStats,
  randomCard,
  repetitionCards,
  reviewCard,
} from "./scheduling";
import type { StudyCard } from "./sets";

const now = new Date("2026-09-12T12:00:00.000Z");
const day = 86_400_000;

function stats(setId = "letters"): StudySetStats {
  return newStudySetStats({
    id: setId,
    data: { aleph: { id: "aleph" }, beth: { id: "beth" } },
  });
}

function card(id: string): StudyCard {
  return { id, question: id, answer: id, answers: [id] };
}

function answer(
  studyData: StudySetStats,
  { elapsed = 1000, wrongCount = 0, mode = "supermemo" } = {},
) {
  return reviewCard("aleph", studyData, {
    wrongCount,
    startTime: Date.now() - elapsed,
    mode,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("starting study without an account", () => {
  it("starts each card due immediately without an owner", () => {
    const studyData = stats();
    expect(studyData).not.toHaveProperty("userId");
    expect(studyData).not.toHaveProperty("__ObjectIDs");
    expect(studyData.dueDate).toEqual(now);
    expect(dueCount(studyData)).toBe(2);
    expect(studyData.cards.aleph).toEqual({
      correct: 0,
      incorrect: 0,
      time: 0,
      dueDate: now,
      supermemo: { interval: 0, repetition: 0, efactor: 2.5 },
      repetition: { weight: 1 },
    });
  });

  it("records an existing owner when initializing signed-in progress", () => {
    const studyData = newStudySetStats(
      { id: "letters", data: { aleph: { id: "aleph" } } },
      "legacy-user-id",
    );
    expect(studyData.userId).toBe("legacy-user-id");
    expect(studyData.__ObjectIDs).toEqual(["userId"]);
  });

  it("keeps cards and identically named cards in other sets independent", () => {
    const first = stats("letters");
    const second = stats("symbols");
    first.cards.aleph.supermemo.interval = 12;
    first.cards.aleph.repetition.weight = 5;
    expect(first.cards.beth.supermemo.interval).toBe(0);
    expect(second.cards.aleph.supermemo.interval).toBe(0);
    expect(second.cards.aleph.repetition.weight).toBe(1);
    expect(second.setId).toBe("symbols");
  });
});

describe("answer grading and totals", () => {
  it.each([
    { wrongCount: 0, elapsed: 2999, weight: 1 },
    { wrongCount: 0, elapsed: 3000, weight: 2 },
    { wrongCount: 0, elapsed: 4999, weight: 2 },
    { wrongCount: 0, elapsed: 5000, weight: 3 },
    { wrongCount: 1, elapsed: 2999, weight: 4 },
    { wrongCount: 1, elapsed: 3000, weight: 5 },
    { wrongCount: 1, elapsed: 7999, weight: 5 },
    { wrongCount: 1, elapsed: 8000, weight: 6 },
  ])(
    "uses repetition weight $weight after $wrongCount errors and $elapsed ms",
    ({ wrongCount, elapsed, weight }) => {
      const review = answer(stats(), {
        wrongCount,
        elapsed,
        mode: "repetition",
      });
      expect(review.card.repetition.weight).toBe(weight);
    },
  );

  it("adds a successful attempt and elapsed time to existing card/set totals", () => {
    const studyData = stats();
    studyData.correct = 7;
    studyData.incorrect = 3;
    studyData.time = 12_000;
    studyData.cards.aleph.correct = 2;
    studyData.cards.aleph.incorrect = 1;
    studyData.cards.aleph.time = 4500;

    const review = answer(studyData, { elapsed: 1500 });
    expect(review).toMatchObject({ correct: 8, incorrect: 3, time: 13_500 });
    expect(review.card).toMatchObject({ correct: 3, incorrect: 1, time: 6000 });
  });

  it("counts a card with several wrong guesses once as incorrect", () => {
    const review = answer(stats(), { wrongCount: 3, elapsed: 5000 });
    expect(review).toMatchObject({ correct: 0, incorrect: 1, time: 5000 });
    expect(review.card).toMatchObject({ correct: 0, incorrect: 1, time: 5000 });
    expect(review.card.supermemo.repetition).toBe(0);
  });

  it.each(["supermemo", "repetition"])(
    "returns a %s update without mutating persisted progress",
    (mode) => {
      const studyData = stats();
      const before = structuredClone(studyData);
      Object.freeze(studyData.cards.aleph.supermemo);
      Object.freeze(studyData.cards.aleph.repetition);
      Object.freeze(studyData.cards.aleph);
      Object.freeze(studyData.cards);
      Object.freeze(studyData);
      const review = answer(studyData, { mode });
      expect(studyData).toEqual(before);
      expect(review.card).not.toBe(studyData.cards.aleph);
    },
  );
});

describe("spaced repetition scheduling", () => {
  it("schedules successive quick correct answers at 1, 6 and 16 days", () => {
    const studyData = stats();
    const intervals: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const review = answer(studyData);
      intervals.push(review.card.supermemo.interval);
      expect(review.card.dueDate.getTime() - Date.now()).toBe(
        review.card.supermemo.interval * day,
      );
      studyData.cards.aleph = review.card;
      vi.setSystemTime(review.card.dueDate);
    }
    expect(intervals).toEqual([1, 6, 16]);
    expect(studyData.cards.aleph.supermemo.repetition).toBe(3);
  });

  it("resets a failed mature card to one day while retaining its history", () => {
    const studyData = stats();
    studyData.cards.aleph.supermemo = {
      interval: 30,
      repetition: 5,
      efactor: 2.5,
    };
    studyData.cards.aleph.correct = 5;
    const review = answer(studyData, { wrongCount: 1, elapsed: 8000 });
    expect(review.card.supermemo).toMatchObject({ interval: 1, repetition: 0 });
    expect(review.card.supermemo.efactor).toBeCloseTo(1.7);
    expect(review.card.dueDate).toEqual(new Date(now.getTime() + day));
    expect(review.card.correct).toBe(5);
    expect(review.card.incorrect).toBe(1);
  });

  it("uses the earliest remaining card without reusing the answered card's old due date", () => {
    const studyData = stats();
    studyData.cards.aleph.dueDate = new Date(now.getTime() - 2 * day);
    studyData.cards.beth.dueDate = new Date(now.getTime() - day);
    const review = answer(studyData);
    expect(review.dueDate).toEqual(studyData.cards.beth.dueDate);
  });

  it("uses the answered card's new due date when it is now earliest", () => {
    const studyData = stats();
    studyData.cards.beth.dueDate = new Date(now.getTime() + 3 * day);
    expect(answer(studyData).dueDate).toEqual(new Date(now.getTime() + day));
  });

  it("finishes a one-card set with a future due date", () => {
    const studyData = stats();
    delete studyData.cards.beth;
    const review = answer(studyData);
    expect(review.dueDate).toEqual(review.card.dueDate);
    expect(review.dueDate!.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("card availability and repetition practice", () => {
  it("includes cards due now, skips future cards and ignores removed set content", () => {
    const studyData = stats();
    studyData.cards.aleph.dueDate = new Date(now.getTime() + 1);
    expect(dueCount(studyData)).toBe(1);
    studyData.cards.removed = newCardStats();
    const cards = [card("aleph"), card("beth")];
    expect(fetchDueCards(cards, studyData)).toEqual([cards[1]]);
  });

  it("keeps the spaced schedule unchanged when practicing in repetition mode", () => {
    const studyData = stats();
    studyData.cards.aleph.dueDate = new Date(now.getTime() + 7 * day);
    studyData.cards.aleph.supermemo = {
      interval: 7,
      repetition: 3,
      efactor: 2.3,
    };
    const review = answer(studyData, { mode: "repetition", wrongCount: 1 });
    expect(review).not.toHaveProperty("dueDate");
    expect(review.card.dueDate).toEqual(studyData.cards.aleph.dueDate);
    expect(review.card.supermemo).toEqual(studyData.cards.aleph.supermemo);
    expect(review.card.repetition.weight).toBe(4);
  });

  it("practices future cards and keeps harder cards more likely to appear", () => {
    const studyData = stats();
    studyData.cards.aleph.dueDate = new Date(now.getTime() + day);
    studyData.cards.beth.repetition.weight = 4;
    const cards = [card("aleph"), card("beth")];
    expect(repetitionCards(cards, studyData)).toEqual([
      cards[0],
      cards[1],
      cards[1],
      cards[1],
      cards[1],
    ]);
  });

  it("avoids immediately repeating the previous card when alternatives exist", () => {
    const cards = [card("aleph"), card("beth")];
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    expect(randomCard(cards, cards[0])).toBe(cards[1]);
  });
});
