// This file is auto-generated. Do not edit.

import * as v from "valibot";

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
