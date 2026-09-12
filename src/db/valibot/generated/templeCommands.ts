// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const templeCreationReceiptsSelect = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  templeId: v.pipe(v.string(), v.uuid()),
  firstAdminMembershipId: v.pipe(v.string(), v.uuid()),
  slug: v.string(),
  createdAt: v.date(),
});

export const templeCreationReceiptsInsert = v.object({
  operationId: v.pipe(v.string(), v.uuid()),
  actorId: v.pipe(v.string(), v.uuid()),
  requestHash: v.string(),
  templeId: v.pipe(v.string(), v.uuid()),
  firstAdminMembershipId: v.pipe(v.string(), v.uuid()),
  slug: v.string(),
  createdAt: v.date(),
});

export const templeCreationReceiptsUpdate = v.object({
  operationId: v.optional(v.pipe(v.string(), v.uuid())),
  actorId: v.optional(v.pipe(v.string(), v.uuid())),
  requestHash: v.optional(v.string()),
  templeId: v.optional(v.pipe(v.string(), v.uuid())),
  firstAdminMembershipId: v.optional(v.pipe(v.string(), v.uuid())),
  slug: v.optional(v.string()),
  createdAt: v.optional(v.date()),
});

export type TempleCreationReceiptsSelect = v.InferOutput<
  typeof templeCreationReceiptsSelect
>;
export type TempleCreationReceiptsInsert = v.InferInput<
  typeof templeCreationReceiptsInsert
>;
export type TempleCreationReceiptsUpdate = v.InferInput<
  typeof templeCreationReceiptsUpdate
>;
