// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const ritualBundleAssetsSelect = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  bundleId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  key: v.pipe(v.string(), v.uuid()),
  assetIndex: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  reference: v.string(),
  sha256: v.string(),
  mime: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  storageProvider: v.string(),
  bucket: v.string(),
  objectKey: v.string(),
  receiptJson: v.nullable(v.string()),
  receiptSha256: v.nullable(v.string()),
  verifiedAt: v.nullable(v.date()),
});

export const ritualBundleAssetsInsert = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  bundleId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  key: v.pipe(v.string(), v.uuid()),
  assetIndex: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  reference: v.string(),
  sha256: v.string(),
  mime: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  storageProvider: v.string(),
  bucket: v.string(),
  objectKey: v.string(),
  receiptJson: v.optional(v.nullable(v.string())),
  receiptSha256: v.optional(v.nullable(v.string())),
  verifiedAt: v.optional(v.nullable(v.date())),
});

export const ritualBundleAssetsUpdate = v.object({
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  bundleId: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  key: v.optional(v.pipe(v.string(), v.uuid())),
  assetIndex: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-2147483648),
      v.maxValue(2147483647),
      v.integer(),
    ),
  ),
  reference: v.optional(v.string()),
  sha256: v.optional(v.string()),
  mime: v.optional(v.string()),
  byteSize: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  storageProvider: v.optional(v.string()),
  bucket: v.optional(v.string()),
  objectKey: v.optional(v.string()),
  receiptJson: v.optional(v.nullable(v.string())),
  receiptSha256: v.optional(v.nullable(v.string())),
  verifiedAt: v.optional(v.nullable(v.date())),
});

export type RitualBundleAssetsSelect = v.InferOutput<
  typeof ritualBundleAssetsSelect
>;
export type RitualBundleAssetsInsert = v.InferInput<
  typeof ritualBundleAssetsInsert
>;
export type RitualBundleAssetsUpdate = v.InferInput<
  typeof ritualBundleAssetsUpdate
>;
export const ritualBundlePublicationIntentsSelect = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  bundleId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  currentRevisionId: v.pipe(v.string(), v.uuid()),
  currentCompiledArtifactId: v.nullable(v.pipe(v.string(), v.uuid())),
  parentVersion: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  descriptorSha256: v.string(),
  contentSha256: v.string(),
  publicationPolicyId: v.string(),
  manifestJson: v.string(),
  manifestSha256: v.string(),
  planJson: v.string(),
  planSha256: v.string(),
  requestHash: v.string(),
  createdAt: v.date(),
  expiresAt: v.date(),
  claimId: v.nullable(v.pipe(v.string(), v.uuid())),
  claimStartedAt: v.nullable(v.date()),
  claimExpiresAt: v.nullable(v.date()),
  completedAt: v.nullable(v.date()),
});

export const ritualBundlePublicationIntentsInsert = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  bundleId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  currentRevisionId: v.pipe(v.string(), v.uuid()),
  currentCompiledArtifactId: v.optional(
    v.nullable(v.pipe(v.string(), v.uuid())),
  ),
  parentVersion: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  descriptorSha256: v.string(),
  contentSha256: v.string(),
  publicationPolicyId: v.string(),
  manifestJson: v.string(),
  manifestSha256: v.string(),
  planJson: v.string(),
  planSha256: v.string(),
  requestHash: v.string(),
  createdAt: v.date(),
  expiresAt: v.date(),
  claimId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  claimStartedAt: v.optional(v.nullable(v.date())),
  claimExpiresAt: v.optional(v.nullable(v.date())),
  completedAt: v.optional(v.nullable(v.date())),
});

export const ritualBundlePublicationIntentsUpdate = v.object({
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  actorId: v.optional(v.pipe(v.string(), v.uuid())),
  bundleId: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  currentRevisionId: v.optional(v.pipe(v.string(), v.uuid())),
  currentCompiledArtifactId: v.optional(
    v.nullable(v.pipe(v.string(), v.uuid())),
  ),
  parentVersion: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  descriptorSha256: v.optional(v.string()),
  contentSha256: v.optional(v.string()),
  publicationPolicyId: v.optional(v.string()),
  manifestJson: v.optional(v.string()),
  manifestSha256: v.optional(v.string()),
  planJson: v.optional(v.string()),
  planSha256: v.optional(v.string()),
  requestHash: v.optional(v.string()),
  createdAt: v.optional(v.date()),
  expiresAt: v.optional(v.date()),
  claimId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  claimStartedAt: v.optional(v.nullable(v.date())),
  claimExpiresAt: v.optional(v.nullable(v.date())),
  completedAt: v.optional(v.nullable(v.date())),
});

export type RitualBundlePublicationIntentsSelect = v.InferOutput<
  typeof ritualBundlePublicationIntentsSelect
>;
export type RitualBundlePublicationIntentsInsert = v.InferInput<
  typeof ritualBundlePublicationIntentsInsert
>;
export type RitualBundlePublicationIntentsUpdate = v.InferInput<
  typeof ritualBundlePublicationIntentsUpdate
>;
export const ritualBundlesSelect = v.object({
  bundleId: v.pipe(v.string(), v.uuid()),
  operationId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  currentRevisionId: v.pipe(v.string(), v.uuid()),
  publishedAt: v.date(),
});

export const ritualBundlesInsert = v.object({
  bundleId: v.pipe(v.string(), v.uuid()),
  operationId: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  currentRevisionId: v.pipe(v.string(), v.uuid()),
  publishedAt: v.date(),
});

export const ritualBundlesUpdate = v.object({
  bundleId: v.optional(v.pipe(v.string(), v.uuid())),
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  currentRevisionId: v.optional(v.pipe(v.string(), v.uuid())),
  publishedAt: v.optional(v.date()),
});

export type RitualBundlesSelect = v.InferOutput<typeof ritualBundlesSelect>;
export type RitualBundlesInsert = v.InferInput<typeof ritualBundlesInsert>;
export type RitualBundlesUpdate = v.InferInput<typeof ritualBundlesUpdate>;
