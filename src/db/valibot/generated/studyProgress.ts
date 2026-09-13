// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyStudySnapshotsSelect = v.object({
  sourceSystem: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  progressId: v.pipe(v.string(), v.uuid()),
  disposition: v.string(),
  sourceEjson: v.string(),
  sourceSha256: v.string(),
  serializationVersion: v.string(),
  importedAt: v.date(),
});

export const legacyStudySnapshotsInsert = v.object({
  sourceSystem: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  progressId: v.pipe(v.string(), v.uuid()),
  disposition: v.string(),
  sourceEjson: v.string(),
  sourceSha256: v.string(),
  serializationVersion: v.string(),
  importedAt: v.date(),
});

export const legacyStudySnapshotsUpdate = v.object({
  sourceSystem: v.optional(v.string()),
  legacyIdType: v.optional(v.enum({ objectid: "objectid", string: "string" })),
  legacyIdValue: v.optional(v.string()),
  progressId: v.optional(v.pipe(v.string(), v.uuid())),
  disposition: v.optional(v.string()),
  sourceEjson: v.optional(v.string()),
  sourceSha256: v.optional(v.string()),
  serializationVersion: v.optional(v.string()),
  importedAt: v.optional(v.date()),
});

export type LegacyStudySnapshotsSelect = v.InferOutput<
  typeof legacyStudySnapshotsSelect
>;
export type LegacyStudySnapshotsInsert = v.InferInput<
  typeof legacyStudySnapshotsInsert
>;
export type LegacyStudySnapshotsUpdate = v.InferInput<
  typeof legacyStudySnapshotsUpdate
>;
export const studyCardStatesSelect = v.object({
  progressId: v.pipe(v.string(), v.uuid()),
  cardKey: v.string(),
  correct: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  incorrect: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  time: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  dueDate: v.date(),
  interval: v.pipe(
    v.number(),
    v.minValue(-140737488355328),
    v.maxValue(140737488355327),
  ),
  repetition: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  efactor: v.pipe(
    v.number(),
    v.minValue(-140737488355328),
    v.maxValue(140737488355327),
  ),
  repetitionPresent: v.boolean(),
  repetitionWeight: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
});

export const studyCardStatesInsert = v.object({
  progressId: v.pipe(v.string(), v.uuid()),
  cardKey: v.string(),
  correct: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  incorrect: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  time: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  dueDate: v.date(),
  interval: v.pipe(
    v.number(),
    v.minValue(-140737488355328),
    v.maxValue(140737488355327),
  ),
  repetition: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  efactor: v.pipe(
    v.number(),
    v.minValue(-140737488355328),
    v.maxValue(140737488355327),
  ),
  repetitionPresent: v.boolean(),
  repetitionWeight: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
});

export const studyCardStatesUpdate = v.object({
  progressId: v.optional(v.pipe(v.string(), v.uuid())),
  cardKey: v.optional(v.string()),
  correct: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  incorrect: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  time: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  dueDate: v.optional(v.date()),
  interval: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-140737488355328),
      v.maxValue(140737488355327),
    ),
  ),
  repetition: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  efactor: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-140737488355328),
      v.maxValue(140737488355327),
    ),
  ),
  repetitionPresent: v.optional(v.boolean()),
  repetitionWeight: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
});

export type StudyCardStatesSelect = v.InferOutput<typeof studyCardStatesSelect>;
export type StudyCardStatesInsert = v.InferInput<typeof studyCardStatesInsert>;
export type StudyCardStatesUpdate = v.InferInput<typeof studyCardStatesUpdate>;
export const studyProgressSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  userId: v.pipe(v.string(), v.uuid()),
  setId: v.string(),
  correct: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  incorrect: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  time: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  dueDate: v.date(),
  createdAt: v.nullable(v.date()),
  updatedAt: v.nullable(v.date()),
  legacySyncUpdatedAtMilliseconds: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  version: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
});

export const studyProgressInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.pipe(v.string(), v.uuid()),
  setId: v.string(),
  correct: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  incorrect: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  time: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  dueDate: v.date(),
  createdAt: v.optional(v.nullable(v.date())),
  updatedAt: v.optional(v.nullable(v.date())),
  legacySyncUpdatedAtMilliseconds: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
  version: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
});

export const studyProgressUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  setId: v.optional(v.string()),
  correct: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  incorrect: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  time: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  dueDate: v.optional(v.date()),
  createdAt: v.optional(v.nullable(v.date())),
  updatedAt: v.optional(v.nullable(v.date())),
  legacySyncUpdatedAtMilliseconds: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
  version: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
});

export type StudyProgressSelect = v.InferOutput<typeof studyProgressSelect>;
export type StudyProgressInsert = v.InferInput<typeof studyProgressInsert>;
export type StudyProgressUpdate = v.InferInput<typeof studyProgressUpdate>;
export const studyReviewReceiptsSelect = v.object({
  eventId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  progressId: v.pipe(v.string(), v.uuid()),
  acceptedVersion: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  acceptedAt: v.date(),
});

export const studyReviewReceiptsInsert = v.object({
  eventId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  progressId: v.pipe(v.string(), v.uuid()),
  acceptedVersion: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  acceptedAt: v.date(),
});

export const studyReviewReceiptsUpdate = v.object({
  eventId: v.optional(v.pipe(v.string(), v.uuid())),
  actorId: v.optional(v.pipe(v.string(), v.uuid())),
  requestHash: v.optional(v.string()),
  progressId: v.optional(v.pipe(v.string(), v.uuid())),
  acceptedVersion: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  acceptedAt: v.optional(v.date()),
});

export type StudyReviewReceiptsSelect = v.InferOutput<
  typeof studyReviewReceiptsSelect
>;
export type StudyReviewReceiptsInsert = v.InferInput<
  typeof studyReviewReceiptsInsert
>;
export type StudyReviewReceiptsUpdate = v.InferInput<
  typeof studyReviewReceiptsUpdate
>;
