// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const discourseUserLinksSelect = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  forumOrigin: v.string(),
  discourseUserId: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  createdAt: v.date(),
});

export const discourseUserLinksInsert = v.object({
  userId: v.pipe(v.string(), v.uuid()),
  forumOrigin: v.string(),
  discourseUserId: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  createdAt: v.optional(v.date()),
});

export const discourseUserLinksUpdate = v.object({
  userId: v.optional(v.pipe(v.string(), v.uuid())),
  forumOrigin: v.optional(v.string()),
  discourseUserId: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  createdAt: v.optional(v.date()),
});

export type DiscourseUserLinksSelect = v.InferOutput<
  typeof discourseUserLinksSelect
>;
export type DiscourseUserLinksInsert = v.InferInput<
  typeof discourseUserLinksInsert
>;
export type DiscourseUserLinksUpdate = v.InferInput<
  typeof discourseUserLinksUpdate
>;
