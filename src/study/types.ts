/** Persisted scheduling state for one content card. */
export interface StudyCardStats {
  correct: number;
  incorrect: number;
  time: number;
  dueDate: Date;
  supermemo: {
    interval: number;
    repetition: number;
    efactor: number;
  };
  /** Legacy baselines distinguish an absent value, an empty object and weight zero. */
  repetition: {
    weight: number;
  };
}

/** Cumulative baseline totals are independent of the per-card sums. */
export interface StudySetStats {
  [key: string]: unknown;
  _id?: string;
  userId?: string;
  setId: string;
  cards: Record<string, StudyCardStats>;
  correct: number;
  incorrect: number;
  time: number;
  dueDate: Date;
  __ObjectIDs?: string[];
  __updatedAt?: number;
}

/** Runtime form of imported SQL data, where historical repetition metadata may be absent. */
export type StudyRuntimeCardStats = Omit<StudyCardStats, "repetition"> & {
  repetition?: { weight?: number };
};
export interface StudyRuntimeSetStats {
  _id?: string;
  userId?: string;
  setId: string;
  cards: Record<string, StudyRuntimeCardStats>;
  correct: number;
  incorrect: number;
  time: number;
  dueDate: Date;
}
