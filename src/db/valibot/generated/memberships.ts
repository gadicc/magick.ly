// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const legacyUserGroupGrantsSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  groupIdsPresent: v.boolean(),
  groupAdminIdsPresent: v.boolean(),
  groupReferences: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  groupAdminReferences: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  importedAt: v.date(),
});

export const legacyUserGroupGrantsInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  groupIdsPresent: v.boolean(),
  groupAdminIdsPresent: v.boolean(),
  groupReferences: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  groupAdminReferences: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  importedAt: v.date(),
});

export const legacyUserGroupGrantsUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  groupIdsPresent: v.optional(v.boolean()),
  groupAdminIdsPresent: v.optional(v.boolean()),
  groupReferences: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  groupAdminReferences: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  importedAt: v.optional(v.date()),
});

export type LegacyUserGroupGrantsSelect = v.InferOutput<
  typeof legacyUserGroupGrantsSelect
>;
export type LegacyUserGroupGrantsInsert = v.InferInput<
  typeof legacyUserGroupGrantsInsert
>;
export type LegacyUserGroupGrantsUpdate = v.InferInput<
  typeof legacyUserGroupGrantsUpdate
>;
export const templeInvitesSelect = v.object({
  templeId: v.pipe(v.string(), v.uuid()),
  joinPass: v.string(),
});

export const templeInvitesInsert = v.object({
  templeId: v.pipe(v.string(), v.uuid()),
  joinPass: v.string(),
});

export const templeInvitesUpdate = v.object({
  templeId: v.optional(v.pipe(v.string(), v.uuid())),
  joinPass: v.optional(v.string()),
});

export type TempleInvitesSelect = v.InferOutput<typeof templeInvitesSelect>;
export type TempleInvitesInsert = v.InferInput<typeof templeInvitesInsert>;
export type TempleInvitesUpdate = v.InferInput<typeof templeInvitesUpdate>;
export const templeMembershipsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  userId: v.pipe(v.string(), v.uuid()),
  templeId: v.pipe(v.string(), v.uuid()),
  grade: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  admin: v.boolean(),
  motto: v.nullable(v.string()),
  addedAt: v.date(),
  memberSince: v.nullable(v.date()),
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

export const templeMembershipsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.pipe(v.string(), v.uuid()),
  templeId: v.pipe(v.string(), v.uuid()),
  grade: v.pipe(
    v.number(),
    v.minValue(-2147483648),
    v.maxValue(2147483647),
    v.integer(),
  ),
  admin: v.optional(v.boolean()),
  motto: v.optional(v.nullable(v.string())),
  addedAt: v.date(),
  memberSince: v.optional(v.nullable(v.date())),
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

export const templeMembershipsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  templeId: v.optional(v.pipe(v.string(), v.uuid())),
  grade: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-2147483648),
      v.maxValue(2147483647),
      v.integer(),
    ),
  ),
  admin: v.optional(v.boolean()),
  motto: v.optional(v.nullable(v.string())),
  addedAt: v.optional(v.date()),
  memberSince: v.optional(v.nullable(v.date())),
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

export type TempleMembershipsSelect = v.InferOutput<
  typeof templeMembershipsSelect
>;
export type TempleMembershipsInsert = v.InferInput<
  typeof templeMembershipsInsert
>;
export type TempleMembershipsUpdate = v.InferInput<
  typeof templeMembershipsUpdate
>;
export const templesSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  name: v.string(),
  slug: v.string(),
  createdById: v.nullable(v.pipe(v.string(), v.uuid())),
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

export const templesInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.string(),
  slug: v.string(),
  createdById: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
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

export const templesUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.optional(v.string()),
  slug: v.optional(v.string()),
  createdById: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
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

export type TemplesSelect = v.InferOutput<typeof templesSelect>;
export type TemplesInsert = v.InferInput<typeof templesInsert>;
export type TemplesUpdate = v.InferInput<typeof templesUpdate>;
export const userGroupGrantsSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  groupId: v.pipe(v.string(), v.uuid()),
  member: v.boolean(),
  admin: v.boolean(),
});

export const userGroupGrantsInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  groupId: v.pipe(v.string(), v.uuid()),
  member: v.optional(v.boolean()),
  admin: v.optional(v.boolean()),
});

export const userGroupGrantsUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  groupId: v.optional(v.pipe(v.string(), v.uuid())),
  member: v.optional(v.boolean()),
  admin: v.optional(v.boolean()),
});

export type UserGroupGrantsSelect = v.InferOutput<typeof userGroupGrantsSelect>;
export type UserGroupGrantsInsert = v.InferInput<typeof userGroupGrantsInsert>;
export type UserGroupGrantsUpdate = v.InferInput<typeof userGroupGrantsUpdate>;
export const userGroupsSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  name: v.string(),
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

export const userGroupsInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.string(),
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

export const userGroupsUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  name: v.optional(v.string()),
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

export type UserGroupsSelect = v.InferOutput<typeof userGroupsSelect>;
export type UserGroupsInsert = v.InferInput<typeof userGroupsInsert>;
export type UserGroupsUpdate = v.InferInput<typeof userGroupsUpdate>;
