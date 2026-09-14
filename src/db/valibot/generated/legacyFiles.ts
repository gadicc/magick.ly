// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyFileRelocationsSelect = v.object({
  fileId: v.pipe(v.string(), v.uuid()),
  sourceStorageProvider: v.string(),
  sourceBucket: v.string(),
  sourceObjectKey: v.string(),
  sourceMetadataSha256: v.string(),
  contentSha256: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  destinationStorageProvider: v.string(),
  destinationBucket: v.string(),
  destinationObjectKey: v.string(),
  verificationProfile: v.string(),
  verifiedAt: v.date(),
});

export const legacyFileRelocationsInsert = v.object({
  fileId: v.pipe(v.string(), v.uuid()),
  sourceStorageProvider: v.string(),
  sourceBucket: v.string(),
  sourceObjectKey: v.string(),
  sourceMetadataSha256: v.string(),
  contentSha256: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  destinationStorageProvider: v.string(),
  destinationBucket: v.string(),
  destinationObjectKey: v.string(),
  verificationProfile: v.string(),
  verifiedAt: v.date(),
});

export const legacyFileRelocationsUpdate = v.object({
  fileId: v.optional(v.pipe(v.string(), v.uuid())),
  sourceStorageProvider: v.optional(v.string()),
  sourceBucket: v.optional(v.string()),
  sourceObjectKey: v.optional(v.string()),
  sourceMetadataSha256: v.optional(v.string()),
  contentSha256: v.optional(v.string()),
  byteSize: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  destinationStorageProvider: v.optional(v.string()),
  destinationBucket: v.optional(v.string()),
  destinationObjectKey: v.optional(v.string()),
  verificationProfile: v.optional(v.string()),
  verifiedAt: v.optional(v.date()),
});

export type LegacyFileRelocationsSelect = v.InferOutput<
  typeof legacyFileRelocationsSelect
>;
export type LegacyFileRelocationsInsert = v.InferInput<
  typeof legacyFileRelocationsInsert
>;
export type LegacyFileRelocationsUpdate = v.InferInput<
  typeof legacyFileRelocationsUpdate
>;
export const legacyFileSnapshotsSelect = v.object({
  sourceSystem: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  fileId: v.pipe(v.string(), v.uuid()),
  sourceEjson: v.string(),
  sourceSha256: v.string(),
  serializationVersion: v.string(),
  legacyPublicPath: v.string(),
  sourceStorageProvider: v.string(),
  sourceBucket: v.string(),
  sourceObjectKey: v.string(),
  sourceObjectKeyPrefix: v.string(),
  legacySyncUpdatedAtMilliseconds: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  importedAt: v.date(),
});

export const legacyFileSnapshotsInsert = v.object({
  sourceSystem: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  fileId: v.pipe(v.string(), v.uuid()),
  sourceEjson: v.string(),
  sourceSha256: v.string(),
  serializationVersion: v.string(),
  legacyPublicPath: v.string(),
  sourceStorageProvider: v.string(),
  sourceBucket: v.string(),
  sourceObjectKey: v.string(),
  sourceObjectKeyPrefix: v.optional(v.string()),
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
  importedAt: v.date(),
});

export const legacyFileSnapshotsUpdate = v.object({
  sourceSystem: v.optional(v.string()),
  legacyIdType: v.optional(v.enum({ objectid: "objectid", string: "string" })),
  legacyIdValue: v.optional(v.string()),
  fileId: v.optional(v.pipe(v.string(), v.uuid())),
  sourceEjson: v.optional(v.string()),
  sourceSha256: v.optional(v.string()),
  serializationVersion: v.optional(v.string()),
  legacyPublicPath: v.optional(v.string()),
  sourceStorageProvider: v.optional(v.string()),
  sourceBucket: v.optional(v.string()),
  sourceObjectKey: v.optional(v.string()),
  sourceObjectKeyPrefix: v.optional(v.string()),
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
  importedAt: v.optional(v.date()),
});

export type LegacyFileSnapshotsSelect = v.InferOutput<
  typeof legacyFileSnapshotsSelect
>;
export type LegacyFileSnapshotsInsert = v.InferInput<
  typeof legacyFileSnapshotsInsert
>;
export type LegacyFileSnapshotsUpdate = v.InferInput<
  typeof legacyFileSnapshotsUpdate
>;
