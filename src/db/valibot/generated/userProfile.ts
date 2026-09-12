// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyAuthAccountsSelect = v.object({
  accountId: v.pipe(v.string(), v.uuid()),
  legacyType: v.string(),
  modernSources: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  embeddedSources: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  importedAt: v.date(),
});

export const legacyAuthAccountsInsert = v.object({
  accountId: v.pipe(v.string(), v.uuid()),
  legacyType: v.string(),
  modernSources: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  embeddedSources: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  importedAt: v.date(),
});

export const legacyAuthAccountsUpdate = v.object({
  accountId: v.optional(v.pipe(v.string(), v.uuid())),
  legacyType: v.optional(v.string()),
  modernSources: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  embeddedSources: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  importedAt: v.optional(v.date()),
});

export type LegacyAuthAccountsSelect = v.InferOutput<
  typeof legacyAuthAccountsSelect
>;
export type LegacyAuthAccountsInsert = v.InferInput<
  typeof legacyAuthAccountsInsert
>;
export type LegacyAuthAccountsUpdate = v.InferInput<
  typeof legacyAuthAccountsUpdate
>;
export const legacyAuthUsersSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  createdAt: v.nullable(v.date()),
  updatedAt: v.nullable(v.date()),
  syncUpdatedAtMilliseconds: v.nullable(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  importedAt: v.date(),
});

export const legacyAuthUsersInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  createdAt: v.optional(v.nullable(v.date())),
  updatedAt: v.optional(v.nullable(v.date())),
  syncUpdatedAtMilliseconds: v.optional(
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

export const legacyAuthUsersUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  createdAt: v.optional(v.nullable(v.date())),
  updatedAt: v.optional(v.nullable(v.date())),
  syncUpdatedAtMilliseconds: v.optional(
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

export type LegacyAuthUsersSelect = v.InferOutput<typeof legacyAuthUsersSelect>;
export type LegacyAuthUsersInsert = v.InferInput<typeof legacyAuthUsersInsert>;
export type LegacyAuthUsersUpdate = v.InferInput<typeof legacyAuthUsersUpdate>;
export const legacyUserEmailsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  userId: v.pipe(v.string(), v.uuid()),
  value: v.string(),
  normalizedValue: v.string(),
  verified: v.boolean(),
  evidence: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
});

export const legacyUserEmailsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.pipe(v.string(), v.uuid()),
  value: v.string(),
  normalizedValue: v.string(),
  verified: v.boolean(),
  evidence: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
});

export const legacyUserEmailsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  value: v.optional(v.string()),
  normalizedValue: v.optional(v.string()),
  verified: v.optional(v.boolean()),
  evidence: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
});

export type LegacyUserEmailsSelect = v.InferOutput<
  typeof legacyUserEmailsSelect
>;
export type LegacyUserEmailsInsert = v.InferInput<
  typeof legacyUserEmailsInsert
>;
export type LegacyUserEmailsUpdate = v.InferInput<
  typeof legacyUserEmailsUpdate
>;
export const userAccessSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  admin: v.boolean(),
});

export const userAccessInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  admin: v.optional(v.boolean()),
});

export const userAccessUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  admin: v.optional(v.boolean()),
});

export type UserAccessSelect = v.InferOutput<typeof userAccessSelect>;
export type UserAccessInsert = v.InferInput<typeof userAccessInsert>;
export type UserAccessUpdate = v.InferInput<typeof userAccessUpdate>;
export const userProfileSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  displayName: v.nullable(v.string()),
});

export const userProfileInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  displayName: v.optional(v.nullable(v.string())),
});

export const userProfileUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  displayName: v.optional(v.nullable(v.string())),
});

export type UserProfileSelect = v.InferOutput<typeof userProfileSelect>;
export type UserProfileInsert = v.InferInput<typeof userProfileInsert>;
export type UserProfileUpdate = v.InferInput<typeof userProfileUpdate>;
