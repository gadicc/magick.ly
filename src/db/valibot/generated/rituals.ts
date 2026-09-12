// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyRitualCompiledArchivesSelect = v.object({
  ritualId: v.pipe(v.string(), v.uuid()),
  claimedRevisionId: v.pipe(v.string(), v.uuid()),
  contentJson: v.string(),
  contentSha256: v.string(),
  serializationVersion: v.string(),
  importedAt: v.date(),
});

export const legacyRitualCompiledArchivesInsert = v.object({
  ritualId: v.pipe(v.string(), v.uuid()),
  claimedRevisionId: v.pipe(v.string(), v.uuid()),
  contentJson: v.string(),
  contentSha256: v.string(),
  serializationVersion: v.string(),
  importedAt: v.date(),
});

export const legacyRitualCompiledArchivesUpdate = v.object({
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  claimedRevisionId: v.optional(v.pipe(v.string(), v.uuid())),
  contentJson: v.optional(v.string()),
  contentSha256: v.optional(v.string()),
  serializationVersion: v.optional(v.string()),
  importedAt: v.optional(v.date()),
});

export type LegacyRitualCompiledArchivesSelect = v.InferOutput<
  typeof legacyRitualCompiledArchivesSelect
>;
export type LegacyRitualCompiledArchivesInsert = v.InferInput<
  typeof legacyRitualCompiledArchivesInsert
>;
export type LegacyRitualCompiledArchivesUpdate = v.InferInput<
  typeof legacyRitualCompiledArchivesUpdate
>;
export const ritualCompiledArtifactsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  revisionId: v.pipe(v.string(), v.uuid()),
  sourceSha256: v.string(),
  compilerVersion: v.string(),
  outputFormat: v.string(),
  outputFormatVersion: v.string(),
  transformations: v.array(v.string()),
  contentJson: v.string(),
  contentSha256: v.string(),
  compiledAt: v.date(),
});

export const ritualCompiledArtifactsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  revisionId: v.pipe(v.string(), v.uuid()),
  sourceSha256: v.string(),
  compilerVersion: v.string(),
  outputFormat: v.string(),
  outputFormatVersion: v.string(),
  transformations: v.array(v.string()),
  contentJson: v.string(),
  contentSha256: v.string(),
  compiledAt: v.date(),
});

export const ritualCompiledArtifactsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  revisionId: v.optional(v.pipe(v.string(), v.uuid())),
  sourceSha256: v.optional(v.string()),
  compilerVersion: v.optional(v.string()),
  outputFormat: v.optional(v.string()),
  outputFormatVersion: v.optional(v.string()),
  transformations: v.optional(v.array(v.string())),
  contentJson: v.optional(v.string()),
  contentSha256: v.optional(v.string()),
  compiledAt: v.optional(v.date()),
});

export type RitualCompiledArtifactsSelect = v.InferOutput<
  typeof ritualCompiledArtifactsSelect
>;
export type RitualCompiledArtifactsInsert = v.InferInput<
  typeof ritualCompiledArtifactsInsert
>;
export type RitualCompiledArtifactsUpdate = v.InferInput<
  typeof ritualCompiledArtifactsUpdate
>;
export const ritualRevisionsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  ritualId: v.pipe(v.string(), v.uuid()),
  authorId: v.pipe(v.string(), v.uuid()),
  source: v.string(),
  sourceSha256: v.string(),
  sourceFormat: v.string(),
  sourceFormatVersion: v.string(),
  createdAt: v.date(),
  updatedAt: v.date(),
  legacySyncUpdatedAtMilliseconds: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
});

export const ritualRevisionsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.pipe(v.string(), v.uuid()),
  authorId: v.pipe(v.string(), v.uuid()),
  source: v.string(),
  sourceSha256: v.string(),
  sourceFormat: v.string(),
  sourceFormatVersion: v.string(),
  createdAt: v.date(),
  updatedAt: v.date(),
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
});

export const ritualRevisionsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  ritualId: v.optional(v.pipe(v.string(), v.uuid())),
  authorId: v.optional(v.pipe(v.string(), v.uuid())),
  source: v.optional(v.string()),
  sourceSha256: v.optional(v.string()),
  sourceFormat: v.optional(v.string()),
  sourceFormatVersion: v.optional(v.string()),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
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
});

export type RitualRevisionsSelect = v.InferOutput<typeof ritualRevisionsSelect>;
export type RitualRevisionsInsert = v.InferInput<typeof ritualRevisionsInsert>;
export type RitualRevisionsUpdate = v.InferInput<typeof ritualRevisionsUpdate>;
export const ritualsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  title: v.string(),
  creatorId: v.nullable(v.pipe(v.string(), v.uuid())),
  scope: v.enum({ public: "public", group: "group", temple: "temple" }),
  groupId: v.nullable(v.pipe(v.string(), v.uuid())),
  templeId: v.nullable(v.pipe(v.string(), v.uuid())),
  minGrade: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  currentRevisionId: v.nullable(v.pipe(v.string(), v.uuid())),
  version: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
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
});

export const ritualsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  title: v.string(),
  creatorId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  scope: v.enum({ public: "public", group: "group", temple: "temple" }),
  groupId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  templeId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  minGrade: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
  currentRevisionId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  version: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
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
});

export const ritualsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  title: v.optional(v.string()),
  creatorId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  scope: v.optional(
    v.enum({ public: "public", group: "group", temple: "temple" }),
  ),
  groupId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  templeId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  minGrade: v.optional(
    v.nullable(
      v.pipe(
        v.number(),
        v.minValue(-9007199254740991),
        v.maxValue(9007199254740991),
        v.integer(),
      ),
    ),
  ),
  currentRevisionId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  version: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
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
});

export type RitualsSelect = v.InferOutput<typeof ritualsSelect>;
export type RitualsInsert = v.InferInput<typeof ritualsInsert>;
export type RitualsUpdate = v.InferInput<typeof ritualsUpdate>;
