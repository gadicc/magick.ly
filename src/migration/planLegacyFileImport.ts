import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isSha256Hex } from "@gadicc/loom/files";
import { EJSON, ObjectId } from "bson";
import type { LegacyAliasKey } from "../db/legacyIds";
import type { legacyFileSnapshots } from "../db/schema/legacyFiles";
import type { loomFilesTable } from "../db/schema/loomFiles";
import { isUuidV7 } from "../lib/ids";

type Row = Record<string, unknown>;
/** Metadata and protected evidence for one import transaction; no storage calls or allocation. */
export interface LegacyFileImportPlan {
  files: (typeof loomFilesTable.$inferInsert & { id: string })[];
  snapshots: (typeof legacyFileSnapshots.$inferInsert)[];
  aliases: { source: LegacyAliasKey; canonicalId: string }[];
  /** IDs whose historical size/type/digest still require independent object verification. */
  objectVerificationRequired: string[];
}
/** All values are explicit reviewed inputs; no provider, bucket or owner is inferred. */
export interface LegacyFileImportOptions {
  lookup: (source: LegacyAliasKey) => string | null;
  storageProvider: string;
  sourceBucket: string;
  importedAt: Date;
}
/** Safe categories and input positions only; no filenames, identifiers or metadata in messages. */
export class LegacyFileImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyFileImportError";
  }
}
function fail(code: string, path: string): never {
  throw new LegacyFileImportError(code, path);
}
function row(value: unknown, path: string): Row {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail("invalid-object", path);
  if (
    Object.getOwnPropertySymbols(value).length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !d.enumerable || !("value" in d),
    )
  )
    fail("unsupported-object-properties", path);
  return value as Row;
}
function text(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim()))
    fail("invalid-text", path);
  if (value.includes("\0") || !value.isWellFormed())
    fail("unrepresentable-text", path);
  return value;
}
function date(value: unknown, path: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    fail("invalid-date", path);
  return new Date(value.getTime());
}
function source(value: unknown, path: string): LegacyAliasKey {
  if (typeof value === "string")
    return {
      sourceSystem: "mongodb",
      entityType: "files",
      legacyIdType: "string",
      legacyIdValue: text(value, path, true),
    };
  // The import boundary is decoded BSON from this app's parser. Arbitrary toString
  // and lookalike plain objects are not identity evidence.
  if (!(value instanceof ObjectId)) fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType: "files",
    legacyIdType: "objectid",
    legacyIdValue: value.toHexString(),
  };
}
/** JSONB projection only; EJSON below separately retains exact source key ordering and types. */
function jsonObject(value: unknown, path: string): Row {
  const ancestors = new Set<object>();
  function validate(item: unknown): void {
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      text(item, path);
      return;
    }
    if (
      typeof item === "number" &&
      Number.isFinite(item) &&
      !Object.is(item, -0)
    )
      return;
    if (typeof item !== "object" || item === null || ancestors.has(item))
      fail("non-json-metadata", path);
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (
        Object.getOwnPropertyNames(item).length !== item.length + 1 ||
        Object.getOwnPropertySymbols(item).length
      )
        fail("non-json-metadata", path);
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor?.enumerable || !("value" in descriptor))
          fail("non-json-metadata", path);
        validate(descriptor.value);
      }
    } else {
      for (const [key, fieldValue] of Object.entries(row(item, path))) {
        text(key, path);
        validate(fieldValue);
      }
    }
    ancestors.delete(item);
  }
  row(value, path);
  validate(value);
  return JSON.parse(JSON.stringify(value)) as Row;
}
function snapshot(value: Row, path: string): string {
  try {
    const serialized = EJSON.stringify(value, { relaxed: false });
    // Reject silent undefined loss and literal EJSON tags that revive as BSON values.
    if (!isDeepStrictEqual(value, EJSON.parse(serialized, { relaxed: true })))
      fail("snapshot-roundtrip-loss", path);
    return serialized;
  } catch (error) {
    if (error instanceof LegacyFileImportError) throw error;
    return fail("snapshot-serialization-failed", path);
  }
}

/**
 * Imports only the evidenced FileEntry shape. Unknown owner/extra/deletion fields,
 * duplicate digests and missing historical dates require an inventory decision.
 * Legacy content stays public; a hash URL never establishes a private ritual grant.
 * Historical MIME/size are preserved claims, not server-verified byte evidence.
 */
export function planLegacyFileImport(
  input: readonly unknown[],
  options: LegacyFileImportOptions,
): LegacyFileImportPlan {
  if (!Array.isArray(input)) fail("invalid-input-array", "input");
  row(options, "options");
  if (typeof options.lookup !== "function")
    fail("invalid-lookup", "options.lookup");
  const storageProvider = text(
    options.storageProvider,
    "options.storageProvider",
    true,
  );
  const sourceBucket = text(options.sourceBucket, "options.sourceBucket", true);
  const importedAt = date(options.importedAt, "options.importedAt");
  const plan: LegacyFileImportPlan = {
    files: [],
    snapshots: [],
    aliases: [],
    objectVerificationRequired: [],
  };
  const sources = new Set<string>(),
    ids = new Set<string>(),
    digests = new Set<string>();
  const fields = [
    "_id",
    "filename",
    "sha256",
    "size",
    "type",
    "mimeType",
    "createdAt",
    "image",
    "audio",
    "__updatedAt",
  ];
  input.forEach((inputRow, index) => {
    const path = `files[${index}]`,
      entry = row(inputRow, path);
    if (Object.keys(entry).some((key) => !fields.includes(key)))
      fail("unclassified-fields", path);
    const ref = source(entry._id, `${path}._id`);
    const sourceKey = JSON.stringify(ref);
    if (sources.has(sourceKey)) fail("duplicate-source-id", path);
    sources.add(sourceKey);
    const id = options.lookup(ref);
    if (!isUuidV7(id)) fail("missing-or-invalid-alias", path);
    const canonicalId = id.toLowerCase();
    if (ids.has(canonicalId)) fail("canonical-alias-collision", path);
    ids.add(canonicalId);
    const sha256 = entry.sha256;
    // The old writer used lowercase crypto output as the actual object key. Do not
    // trim/lowercase an unexpected key and thereby invent another storage location.
    if (
      typeof sha256 !== "string" ||
      !isSha256Hex(sha256) ||
      sha256 !== sha256.toLowerCase()
    )
      fail("invalid-legacy-digest", path);
    if (digests.has(sha256)) fail("duplicate-digest-needs-review", path);
    digests.add(sha256);
    const byteSize = entry.size;
    if (
      typeof byteSize !== "number" ||
      !Number.isSafeInteger(byteSize) ||
      byteSize < 0 ||
      Object.is(byteSize, -0)
    )
      fail("invalid-byte-size", path);
    const kind = entry.type;
    if (kind !== "image" && kind !== "audio" && kind !== "other")
      fail("unsupported-kind", path);
    const hasImage = Object.hasOwn(entry, "image"),
      hasAudio = Object.hasOwn(entry, "audio");
    if (hasImage !== (kind === "image") || hasAudio !== (kind === "audio"))
      fail("inconsistent-kind-metadata", path);
    const imageMeta = hasImage
      ? jsonObject(entry.image, `${path}.image`)
      : null;
    const audioMeta = hasAudio
      ? jsonObject(entry.audio, `${path}.audio`)
      : null;
    const originalFilename = Object.hasOwn(entry, "filename")
      ? text(entry.filename, `${path}.filename`)
      : null;
    const contentType = Object.hasOwn(entry, "mimeType")
      ? text(entry.mimeType, `${path}.mimeType`)
      : null;
    const createdAt = date(entry.createdAt, `${path}.createdAt`);
    const sync = entry.__updatedAt;
    if (
      Object.hasOwn(entry, "__updatedAt") &&
      (typeof sync !== "number" ||
        !Number.isSafeInteger(sync) ||
        sync < 0 ||
        Object.is(sync, -0))
    )
      fail("invalid-sync-timestamp", path);
    const sourceEjson = snapshot(entry, path);
    plan.files.push({
      id: canonicalId,
      sha256,
      byteSize,
      originalFilename,
      contentType,
      detectedContentType: null,
      kind,
      storageProvider,
      bucket: sourceBucket,
      objectKey: sha256,
      ownerType: null,
      ownerId: null,
      visibility: "public",
      imageMeta,
      audioMeta,
      meta: {},
      deletedAt: null,
      createdAt,
      // The source has no updatedAt. This is explicitly the metadata import time.
      updatedAt: new Date(importedAt),
    });
    plan.snapshots.push({
      sourceSystem: ref.sourceSystem,
      legacyIdType: ref.legacyIdType,
      legacyIdValue: ref.legacyIdValue,
      fileId: canonicalId,
      sourceEjson,
      sourceSha256: createHash("sha256")
        .update(sourceEjson, "utf8")
        .digest("hex"),
      serializationVersion: "bson-canonical-ejson-v1",
      legacyPublicPath: `/api/file2?sha256=${sha256}`,
      sourceStorageProvider: storageProvider,
      sourceBucket,
      sourceObjectKey: sha256,
      legacySyncUpdatedAtMilliseconds:
        sync === undefined ? null : (sync as number),
      importedAt: new Date(importedAt),
    });
    plan.aliases.push({ source: ref, canonicalId });
    plan.objectVerificationRequired.push(canonicalId);
  });
  return plan;
}
