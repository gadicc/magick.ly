// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const ritualWriteReceiptsSelect = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  kind: v.string(),
  ritualId: v.pipe(v.string(), v.uuid()),
  revisionId: v.pipe(v.string(), v.uuid()),
  version: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  updatedAt: v.date(),
});

export const ritualWriteReceiptsInsert = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  kind: v.string(),
  ritualId: v.pipe(v.string(), v.uuid()),
  revisionId: v.pipe(v.string(), v.uuid()),
  version: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  updatedAt: v.date(),
});

export const ritualWriteReceiptsUpdate = v.object({
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  actorId: v.optional(v.pipe(v.string(), v.uuid())),
  requestHash: v.optional(v.string()),
  kind: v.optional(v.string()),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  revisionId: v.optional(v.pipe(v.string(), v.uuid())),
  version: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  updatedAt: v.optional(v.date()),
});

export type RitualWriteReceiptsSelect = v.InferOutput<
  typeof ritualWriteReceiptsSelect
>;
export type RitualWriteReceiptsInsert = v.InferInput<
  typeof ritualWriteReceiptsInsert
>;
export type RitualWriteReceiptsUpdate = v.InferInput<
  typeof ritualWriteReceiptsUpdate
>;
