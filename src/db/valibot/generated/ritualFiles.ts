// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const ritualFileLinksSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  operationId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  fileId: v.pipe(v.string(), v.uuid()),
  uploaderId: v.pipe(v.string(), v.uuid()),
  createdAt: v.date(),
  deletedAt: v.nullable(v.date()),
});

export const ritualFileLinksInsert = v.object({
  id: v.pipe(v.string(), v.uuid()),
  operationId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  fileId: v.pipe(v.string(), v.uuid()),
  uploaderId: v.pipe(v.string(), v.uuid()),
  createdAt: v.date(),
  deletedAt: v.optional(v.nullable(v.date())),
});

export const ritualFileLinksUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  fileId: v.optional(v.pipe(v.string(), v.uuid())),
  uploaderId: v.optional(v.pipe(v.string(), v.uuid())),
  createdAt: v.optional(v.date()),
  deletedAt: v.optional(v.nullable(v.date())),
});

export type RitualFileLinksSelect = v.InferOutput<typeof ritualFileLinksSelect>;
export type RitualFileLinksInsert = v.InferInput<typeof ritualFileLinksInsert>;
export type RitualFileLinksUpdate = v.InferInput<typeof ritualFileLinksUpdate>;
export const ritualUploadIntentsSelect = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  filename: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  contentType: v.string(),
  sha256: v.string(),
  fileId: v.pipe(v.string(), v.uuid()),
  attachmentId: v.pipe(v.string(), v.uuid()),
  stagingProvider: v.string(),
  stagingBucket: v.string(),
  stagingObjectKey: v.string(),
  canonicalProvider: v.string(),
  canonicalBucket: v.string(),
  canonicalObjectKey: v.string(),
  createdAt: v.date(),
  expiresAt: v.date(),
  claimId: v.nullable(v.pipe(v.string(), v.uuid())),
  claimStartedAt: v.nullable(v.date()),
  claimExpiresAt: v.nullable(v.date()),
  completedAt: v.nullable(v.date()),
});

export const ritualUploadIntentsInsert = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  filename: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  contentType: v.string(),
  sha256: v.string(),
  fileId: v.pipe(v.string(), v.uuid()),
  attachmentId: v.pipe(v.string(), v.uuid()),
  stagingProvider: v.string(),
  stagingBucket: v.string(),
  stagingObjectKey: v.string(),
  canonicalProvider: v.string(),
  canonicalBucket: v.string(),
  canonicalObjectKey: v.string(),
  createdAt: v.date(),
  expiresAt: v.date(),
  claimId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  claimStartedAt: v.optional(v.nullable(v.date())),
  claimExpiresAt: v.optional(v.nullable(v.date())),
  completedAt: v.optional(v.nullable(v.date())),
});

export const ritualUploadIntentsUpdate = v.object({
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  actorId: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  requestHash: v.optional(v.string()),
  filename: v.optional(v.string()),
  byteSize: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  contentType: v.optional(v.string()),
  sha256: v.optional(v.string()),
  fileId: v.optional(v.pipe(v.string(), v.uuid())),
  attachmentId: v.optional(v.pipe(v.string(), v.uuid())),
  stagingProvider: v.optional(v.string()),
  stagingBucket: v.optional(v.string()),
  stagingObjectKey: v.optional(v.string()),
  canonicalProvider: v.optional(v.string()),
  canonicalBucket: v.optional(v.string()),
  canonicalObjectKey: v.optional(v.string()),
  createdAt: v.optional(v.date()),
  expiresAt: v.optional(v.date()),
  claimId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  claimStartedAt: v.optional(v.nullable(v.date())),
  claimExpiresAt: v.optional(v.nullable(v.date())),
  completedAt: v.optional(v.nullable(v.date())),
});

export type RitualUploadIntentsSelect = v.InferOutput<
  typeof ritualUploadIntentsSelect
>;
export type RitualUploadIntentsInsert = v.InferInput<
  typeof ritualUploadIntentsInsert
>;
export type RitualUploadIntentsUpdate = v.InferInput<
  typeof ritualUploadIntentsUpdate
>;
