import { type SuperMemoGrade, supermemo } from "supermemo";
import type { StudyCardStats, StudySetStats } from "../app/study/[_id]/exports";
import type { StudyCard, StudySet } from "./sets";

/** A completed card: wrong guesses so far and its start time in epoch milliseconds. */
export interface StudyAttempt {
  wrongCount: number;
  startTime: number;
  mode: string;
}

/** Updated card/set totals for one completed card; durations are milliseconds. */
export interface StudyReview {
  card: StudyCardStats;
  correct: number;
  incorrect: number;
  time: number;
  dueDate?: Date;
}

export function newCardStats(): StudyCardStats {
  return {
    correct: 0,
    incorrect: 0,
    time: 0,
    dueDate: new Date(),
    supermemo: {
      interval: 0,
      repetition: 0,
      efactor: 2.5,
    },
    repetition: {
      weight: 1,
    },
  };
}

export function randomCard(
  set: StudyCard[],
  prevCard: StudyCard | null = null,
): StudyCard {
  // Filtering preserves repetition weights without retrying indefinitely when
  // the pool consists only of the previous card (possibly repeated by weight).
  const alternatives = set.filter((card) => card !== prevCard);
  const candidates = alternatives.length > 0 ? alternatives : set;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function newStudySetStats(
  set: Pick<StudySet, "id" | "data">,
  userId?: string,
) {
  const studySetStats: StudySetStats = {
    setId: set.id,
    cards: {},
    correct: 0,
    incorrect: 0,
    time: 0,
    dueDate: new Date(),
  };

  if (userId) {
    studySetStats.userId = userId;
    studySetStats.__ObjectIDs = ["userId"];
  }

  for (const cardId of Object.keys(set.data)) {
    studySetStats.cards[cardId] = newCardStats();
  }

  return studySetStats;
}

/**
 * Computes a domain update without persisting or mutating stored progress.
 * Each completed card increments correct or incorrect once, regardless of guesses.
 */
export function reviewCard(
  cardId: string,
  _studyData: StudySetStats,
  { wrongCount, startTime, mode }: StudyAttempt,
) {
  // Content can acquire new cards after this study record was first created.
  const card = { ...(_studyData.cards[cardId] || newCardStats()) };

  const studyDataUpdate: StudyReview = {
    correct: _studyData.correct,
    incorrect: _studyData.incorrect,
    time: _studyData.time,
    card,
  };

  const elapsed = Date.now() - startTime;
  card.time += elapsed;
  studyDataUpdate.time += elapsed;

  let grade: SuperMemoGrade;
  if (wrongCount === 0) {
    card.correct++;
    studyDataUpdate.correct++;
    if (elapsed < 3000) grade = 5;
    else if (elapsed < 5000) grade = 4;
    else grade = 3;
  } else {
    card.incorrect++;
    studyDataUpdate.incorrect++;
    if (elapsed < 3000) grade = 2;
    else if (elapsed < 8000) grade = 1;
    else grade = 0;
  }

  if (mode === "supermemo") {
    card.supermemo = supermemo(card.supermemo, grade);

    const dayInMs = 86400000;
    card.dueDate = new Date(Date.now() + card.supermemo.interval * dayInMs);

    let earliestDueDate = card.dueDate;
    for (const [id, card2] of Object.entries(_studyData.cards)) {
      // Skip currentId because we already used it but more importantly, we
      // didn't mutate _studyData.cards[currentId] so it would be the previous
      // dueDate, i.e. before now & thus guaranteed (but incorrect) "earliest"
      if (id !== cardId && card2.dueDate < earliestDueDate)
        earliestDueDate = card2.dueDate;
    }
    studyDataUpdate.dueDate = earliestDueDate;
  } else if (mode === "repetition") {
    card.repetition = {
      // 6 so if they get it correct (5) it will still repeat (once, unweighted)
      weight: 6 - grade,
    };
  }

  return studyDataUpdate;
}

export function fetchDueCards(
  allCards: StudyCard[],
  studyData: StudySetStats,
): StudyCard[] {
  const now = new Date();
  const cards: StudyCard[] = [];
  for (const setCard of allCards) {
    const studySetCard = studyData.cards[setCard.id];
    if (!studySetCard || studySetCard.dueDate <= now) cards.push(setCard);
  }
  return cards;
}

export function repetitionCards(
  allCards: StudyCard[],
  studyData: StudySetStats,
): StudyCard[] {
  const cards: StudyCard[] = [];
  for (const setCard of allCards) {
    const studySetCard = studyData.cards[setCard.id] || newCardStats();
    const weight = studySetCard?.repetition?.weight || 1;
    for (let i = 0; i < weight; i++) cards.push(setCard);
  }
  return cards;
}

export function dueCount(set: StudySetStats): number {
  let count = 0;
  const now = new Date();
  for (const card of Object.values(set.cards)) if (card.dueDate <= now) count++;
  return count;
}
