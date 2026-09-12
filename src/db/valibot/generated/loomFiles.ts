// This file is auto-generated. Do not edit.

import * as v from "valibot";

export const loomFilesTableSelect = v.object({
  id: v.pipe(v.string(), v.uuid()),
  sha256: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  originalFilename: v.nullable(v.string()),
  contentType: v.nullable(v.string()),
  detectedContentType: v.nullable(v.string()),
  kind: v.string(),
  storageProvider: v.string(),
  bucket: v.nullable(v.string()),
  objectKey: v.string(),
  ownerType: v.nullable(v.string()),
  ownerId: v.nullable(v.string()),
  visibility: v.string(),
  imageMeta: v.nullable(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  audioMeta: v.nullable(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  meta: v.union([
    v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
    v.array(v.any()),
    v.record(v.string(), v.any()),
  ]),
  deletedAt: v.nullable(v.date()),
  createdAt: v.date(),
  updatedAt: v.date(),
});

export const loomFilesTableInsert = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  sha256: v.string(),
  byteSize: v.pipe(
    v.number(),
    v.minValue(-9007199254740991),
    v.maxValue(9007199254740991),
    v.integer(),
  ),
  originalFilename: v.optional(v.nullable(v.string())),
  contentType: v.optional(v.nullable(v.string())),
  detectedContentType: v.optional(v.nullable(v.string())),
  kind: v.optional(v.string()),
  storageProvider: v.string(),
  bucket: v.optional(v.nullable(v.string())),
  objectKey: v.string(),
  ownerType: v.optional(v.nullable(v.string())),
  ownerId: v.optional(v.nullable(v.string())),
  visibility: v.optional(v.string()),
  imageMeta: v.optional(
    v.nullable(
      v.union([
        v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
        v.array(v.any()),
        v.record(v.string(), v.any()),
      ]),
    ),
  ),
  audioMeta: v.optional(
    v.nullable(
      v.union([
        v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
        v.array(v.any()),
        v.record(v.string(), v.any()),
      ]),
    ),
  ),
  meta: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  deletedAt: v.optional(v.nullable(v.date())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export const loomFilesTableUpdate = v.object({
  id: v.optional(v.pipe(v.string(), v.uuid())),
  sha256: v.optional(v.string()),
  byteSize: v.optional(
    v.pipe(
      v.number(),
      v.minValue(-9007199254740991),
      v.maxValue(9007199254740991),
      v.integer(),
    ),
  ),
  originalFilename: v.optional(v.nullable(v.string())),
  contentType: v.optional(v.nullable(v.string())),
  detectedContentType: v.optional(v.nullable(v.string())),
  kind: v.optional(v.string()),
  storageProvider: v.optional(v.string()),
  bucket: v.optional(v.nullable(v.string())),
  objectKey: v.optional(v.string()),
  ownerType: v.optional(v.nullable(v.string())),
  ownerId: v.optional(v.nullable(v.string())),
  visibility: v.optional(v.string()),
  imageMeta: v.optional(
    v.nullable(
      v.union([
        v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
        v.array(v.any()),
        v.record(v.string(), v.any()),
      ]),
    ),
  ),
  audioMeta: v.optional(
    v.nullable(
      v.union([
        v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
        v.array(v.any()),
        v.record(v.string(), v.any()),
      ]),
    ),
  ),
  meta: v.optional(
    v.union([
      v.union([v.string(), v.number(), v.boolean(), (v.null ?? v.null_)()]),
      v.array(v.any()),
      v.record(v.string(), v.any()),
    ]),
  ),
  deletedAt: v.optional(v.nullable(v.date())),
  createdAt: v.optional(v.date()),
  updatedAt: v.optional(v.date()),
});

export type LoomFilesTableSelect = v.InferOutput<typeof loomFilesTableSelect>;
export type LoomFilesTableInsert = v.InferInput<typeof loomFilesTableInsert>;
export type LoomFilesTableUpdate = v.InferInput<typeof loomFilesTableUpdate>;
