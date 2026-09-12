// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyIdAliasesSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  sourceSystem: v.string(),
  entityType: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  canonicalId: v.pipe(v.string(), v.uuid()),
  createdAt: v.date(),
});

export const legacyIdAliasesInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  sourceSystem: v.string(),
  entityType: v.string(),
  legacyIdType: v.enum({ objectid: "objectid", string: "string" }),
  legacyIdValue: v.string(),
  canonicalId: v.pipe(v.string(), v.uuid()),
  createdAt: v.optional(v.date()),
});

export const legacyIdAliasesUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  sourceSystem: v.optional(v.string()),
  entityType: v.optional(v.string()),
  legacyIdType: v.optional(v.enum({ objectid: "objectid", string: "string" })),
  legacyIdValue: v.optional(v.string()),
  canonicalId: v.optional(v.pipe(v.string(), v.uuid())),
  createdAt: v.optional(v.date()),
});

export type LegacyIdAliasesSelect = v.InferOutput<typeof legacyIdAliasesSelect>;
export type LegacyIdAliasesInsert = v.InferInput<typeof legacyIdAliasesInsert>;
export type LegacyIdAliasesUpdate = v.InferInput<typeof legacyIdAliasesUpdate>;
