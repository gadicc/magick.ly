// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyImportRunsSelect = v.object({
  runId: v.pipe(v.string(), v.uuid()),
  slot: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  profile: v.string(),
  sourceManifestSha256: v.string(),
  sourceDescriptorSha256: v.string(),
  configurationSha256: v.string(),
  schemaSha256: v.string(),
  targetSha256: v.string(),
  payloadSha256: v.string(),
  expectedRowsSha256: v.string(),
  payload: v.string(),
  importedAt: v.date(),
  preparedAt: v.date(),
  completedAt: v.nullable(v.date()),
  reconciliationSha256: v.nullable(v.string()),
});

export const legacyImportRunsInsert = v.object({
  runId: v.pipe(v.string(), v.uuid()),
  slot: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  profile: v.string(),
  sourceManifestSha256: v.string(),
  sourceDescriptorSha256: v.string(),
  configurationSha256: v.string(),
  schemaSha256: v.string(),
  targetSha256: v.string(),
  payloadSha256: v.string(),
  expectedRowsSha256: v.string(),
  payload: v.string(),
  importedAt: v.date(),
  preparedAt: v.date(),
  completedAt: v.optional(v.nullable(v.date())),
  reconciliationSha256: v.optional(v.nullable(v.string())),
});

export const legacyImportRunsUpdate = v.object({
  runId: v.optional(v.pipe(v.string(), v.uuid())),
  slot: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-2147483648),
      v.maxValue(2147483647),
      v.integer(),
    ),
  ),
  profile: v.optional(v.string()),
  sourceManifestSha256: v.optional(v.string()),
  sourceDescriptorSha256: v.optional(v.string()),
  configurationSha256: v.optional(v.string()),
  schemaSha256: v.optional(v.string()),
  targetSha256: v.optional(v.string()),
  payloadSha256: v.optional(v.string()),
  expectedRowsSha256: v.optional(v.string()),
  payload: v.optional(v.string()),
  importedAt: v.optional(v.date()),
  preparedAt: v.optional(v.date()),
  completedAt: v.optional(v.nullable(v.date())),
  reconciliationSha256: v.optional(v.nullable(v.string())),
});

export type LegacyImportRunsSelect = v.InferOutput<
  typeof legacyImportRunsSelect
>;
export type LegacyImportRunsInsert = v.InferInput<
  typeof legacyImportRunsInsert
>;
export type LegacyImportRunsUpdate = v.InferInput<
  typeof legacyImportRunsUpdate
>;
