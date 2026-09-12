import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { EJSON, ObjectId } from "bson";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { LegacyAliasKey } from "../db/legacyIds";
import { legacyFileSnapshots } from "../db/schema/legacyFiles";
import { legacyIdType } from "../db/schema/legacyIds";
import { loomFilesTable } from "../db/schema/loomFiles";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  LegacyFileImportError,
  type LegacyFileImportOptions,
  planLegacyFileImport,
} from "./planLegacyFileImport";

type Row = Record<string, unknown>;
const firstId = createUuidV7(),
  secondId = createUuidV7();
const importedAt = new Date("2026-09-12T14:03:04.567Z");
const originalAt = new Date("2014-03-30T00:59:59.123Z");
const sourceId = new ObjectId("000000000000000000000001");
function file(overrides: Row = {}): Row {
  return {
    _id: sourceId,
    filename: "\uFEFFTemple diagram — α.svg\r\n",
    sha256: "a".repeat(64),
    size: 20139,
    mimeType: "image/svg+xml",
    createdAt: new Date(originalAt),
    type: "image",
    image: { format: "svg", size: 20139, width: 800, height: 600 },
    __updatedAt: 1234567890123,
    ...overrides,
  };
}
function options(
  overrides: Partial<LegacyFileImportOptions> = {},
): LegacyFileImportOptions {
  return {
    lookup: () => firstId,
    storageProvider: "s3",
    sourceBucket: "synthetic-legacy-bucket",
    sourceObjectKeyPrefix: "",
    importedAt: new Date(importedAt),
    ...overrides,
  };
}
function failure(
  input: readonly unknown[],
  code: string,
  settings = options(),
) {
  try {
    planLegacyFileImport(input, settings);
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyFileImportError);
    expect((error as LegacyFileImportError).code).toBe(code);
    expect((error as Error).message).not.toContain("Temple diagram");
    expect((error as Error).message).not.toContain(sourceId.toHexString());
    return;
  }
  throw new Error("Expected rejected synthetic import");
}

describe("legacy Files import plan", () => {
  it("preserves historical SVG links, keys, claims, source dates and protected evidence without fabricating ownership", () => {
    const input = file(),
      plan = planLegacyFileImport([input], options());
    expect(plan.files).toEqual([
      {
        id: firstId,
        sha256: input.sha256,
        byteSize: input.size,
        originalFilename: input.filename,
        contentType: "image/svg+xml",
        detectedContentType: null,
        kind: "image",
        storageProvider: "s3",
        bucket: "synthetic-legacy-bucket",
        objectKey: input.sha256,
        ownerType: null,
        ownerId: null,
        visibility: "public",
        imageMeta: input.image,
        audioMeta: null,
        meta: {},
        deletedAt: null,
        createdAt: originalAt,
        updatedAt: importedAt,
      },
    ]);
    const snapshot = plan.snapshots[0];
    expect(snapshot).toMatchObject({
      fileId: firstId,
      sourceSystem: "mongodb",
      legacyIdType: "objectid",
      legacyIdValue: sourceId.toHexString(),
      legacyPublicPath: `/api/file2?sha256=${input.sha256}`,
      sourceStorageProvider: "s3",
      sourceBucket: "synthetic-legacy-bucket",
      sourceObjectKey: input.sha256,
      sourceObjectKeyPrefix: "",
      serializationVersion: "bson-canonical-ejson-v1",
      legacySyncUpdatedAtMilliseconds: 1234567890123,
      importedAt,
    });
    expect(EJSON.parse(snapshot.sourceEjson, { relaxed: true })).toEqual(input);
    expect(snapshot.sourceSha256).toBe(
      createHash("sha256").update(snapshot.sourceEjson).digest("hex"),
    );
    expect(plan.objectVerificationRequired).toEqual([firstId]);
    expect(plan.aliases).toEqual([
      {
        source: {
          sourceSystem: "mongodb",
          entityType: "files",
          legacyIdType: "objectid",
          legacyIdValue: sourceId.toHexString(),
        },
        canonicalId: firstId,
      },
    ]);
  });
  it("uses only an explicit verified key prefix while preserving source, digest and public URL", () => {
    const input = file();
    const bare = planLegacyFileImport([input], options());
    const settings = options({ sourceObjectKeyPrefix: "verified-prefix/" });
    const prefixed = planLegacyFileImport([input], settings);
    expect(prefixed.files[0]).toEqual({
      ...bare.files[0],
      objectKey: `verified-prefix/${input.sha256}`,
    });
    expect(prefixed.snapshots[0]).toEqual({
      ...bare.snapshots[0],
      sourceObjectKey: `verified-prefix/${input.sha256}`,
      sourceObjectKeyPrefix: "verified-prefix/",
    });
    expect(prefixed.aliases).toEqual(bare.aliases);
    expect(prefixed.objectVerificationRequired).toEqual([firstId]);
    expect(planLegacyFileImport([input], settings)).toEqual(prefixed);
    settings.sourceObjectKeyPrefix = "changed-later/";
    expect(prefixed.snapshots[0].sourceObjectKeyPrefix).toBe(
      "verified-prefix/",
    );
  });
  it("never derives a key prefix from the provider or bucket", () => {
    const plan = planLegacyFileImport(
      [file()],
      options({
        storageProvider: "r2",
        sourceBucket: "different-bucket",
        sourceObjectKeyPrefix: "independently-verified/",
      }),
    );
    expect(plan.files[0]).toMatchObject({
      storageProvider: "r2",
      bucket: "different-bucket",
      objectKey: `independently-verified/${"a".repeat(64)}`,
    });
  });
  it("preserves exact prefix bytes instead of URL encoding, trimming or Unicode normalization", () => {
    const prefix = " exact e\u0301 é/";
    const plan = planLegacyFileImport(
      [file()],
      options({ sourceObjectKeyPrefix: prefix }),
    );
    expect(plan.files[0].objectKey).toBe(prefix + "a".repeat(64));
    expect(plan.snapshots[0].sourceObjectKeyPrefix).toBe(prefix);
  });
  it("requires an explicit prefix choice and rejects invalid or oversized key prefixes", () => {
    for (const prefix of [
      undefined,
      null,
      1,
      "missing-delimiter",
      "x\0/",
      "\ud800/",
      "x".repeat(960) + "/",
      "é".repeat(480) + "/",
    ]) {
      expect(() =>
        planLegacyFileImport(
          [file()],
          options({ sourceObjectKeyPrefix: prefix as string }),
        ),
      ).toThrow(LegacyFileImportError);
    }
    const prefix = "x".repeat(959) + "/";
    const plan = planLegacyFileImport(
      [file()],
      options({ sourceObjectKeyPrefix: prefix }),
    );
    expect(Buffer.byteLength(plan.files[0].objectKey, "utf8")).toBe(1024);
  });
  it("keeps old audio and other metadata outside the future image upload allowlist", () => {
    const audio = file({
      type: "audio",
      audio: {
        container: "WAVE",
        codec: "PCM",
        lossless: true,
        bitrate: 128000,
        duration: 2.125,
        notes: ["α", null],
      },
      mimeType: "audio/wav",
    });
    delete audio.image;
    const other = file({
      _id: "old-string-id",
      sha256: "b".repeat(64),
      type: "other",
      mimeType: "application/pdf",
      size: 30 * 1024 * 1024,
    });
    delete other.image;
    const plan = planLegacyFileImport(
      [audio, other],
      options({
        lookup: (ref) => (ref.legacyIdType === "objectid" ? firstId : secondId),
      }),
    );
    expect(plan.files.map((row) => row.kind)).toEqual(["audio", "other"]);
    expect(plan.files[0].audioMeta).toEqual(audio.audio);
    expect(plan.files[1]).toMatchObject({
      byteSize: 30 * 1024 * 1024,
      contentType: "application/pdf",
      visibility: "public",
    });
  });
  it("distinguishes absent optional source fields from empty strings and preserves zero sizes/sync values", () => {
    const absent = file({ size: 0 });
    delete absent.filename;
    delete absent.mimeType;
    delete absent.__updatedAt;
    const empty = file({ filename: "", mimeType: "", __updatedAt: 0 });
    const a = planLegacyFileImport([absent], options()),
      b = planLegacyFileImport([empty], options());
    expect(a.files[0]).toMatchObject({
      originalFilename: null,
      contentType: null,
      byteSize: 0,
    });
    expect(a.snapshots[0].legacySyncUpdatedAtMilliseconds).toBeNull();
    expect(
      Object.hasOwn(EJSON.parse(a.snapshots[0].sourceEjson), "filename"),
    ).toBe(false);
    expect(b.files[0]).toMatchObject({ originalFilename: "", contentType: "" });
    expect(b.snapshots[0].legacySyncUpdatedAtMilliseconds).toBe(0);
  });
  it("keeps ObjectId and identical string identities separate, with stable preallocated UUIDv7 mappings", () => {
    const input = [
      file(),
      file({ _id: sourceId.toHexString(), sha256: "b".repeat(64) }),
    ];
    const seen: LegacyAliasKey[] = [];
    const opts = options({
      lookup: (ref) => {
        seen.push(ref);
        return ref.legacyIdType === "objectid"
          ? firstId.toUpperCase()
          : secondId;
      },
    });
    const plan = planLegacyFileImport(input, opts);
    expect(plan.files.map((row) => row.id)).toEqual([firstId, secondId]);
    expect(seen.map((ref) => ref.legacyIdType)).toEqual(["objectid", "string"]);
    expect(planLegacyFileImport(input, opts)).toEqual(plan);
  });
  it("does not share mutable metadata or dates with its source", () => {
    const input = file(),
      settings = options();
    const before = EJSON.stringify(input, { relaxed: false }),
      plan = planLegacyFileImport([input], settings);
    (input.image as Row).width = 1;
    (input.createdAt as Date).setTime(0);
    settings.importedAt.setTime(0);
    expect(plan.files[0].imageMeta?.width).toBe(800);
    expect(plan.files[0].createdAt).toEqual(originalAt);
    expect(plan.files[0].updatedAt).toEqual(importedAt);
    expect(plan.snapshots[0].sourceEjson).toBe(before);
  });
  it("permits an empty inventory with explicit source settings", () => {
    expect(planLegacyFileImport([], options())).toEqual({
      files: [],
      snapshots: [],
      aliases: [],
      objectVerificationRequired: [],
    });
  });
  it.each([
    ["ownerId", firstId],
    ["userId", sourceId],
    ["templeId", secondId],
    ["meta", { private: true }],
    ["deletedAt", importedAt],
    ["unexpected", "secret"],
  ])(
    "rejects unreviewed %s rather than inventing ownership or dropping evidence",
    (field, value) =>
      failure([file({ [field]: value })], "unclassified-fields"),
  );
  it.each([
    ["sha256", "A".repeat(64), "invalid-legacy-digest"],
    ["sha256", ` ${"a".repeat(64)}`, "invalid-legacy-digest"],
    ["sha256", "not-a-hash", "invalid-legacy-digest"],
    ["sha256", 1, "invalid-legacy-digest"],
    ["size", -1, "invalid-byte-size"],
    ["size", -0, "invalid-byte-size"],
    ["size", 0.5, "invalid-byte-size"],
    ["size", Number.MAX_SAFE_INTEGER + 1, "invalid-byte-size"],
    ["size", "1", "invalid-byte-size"],
    ["size", Number.POSITIVE_INFINITY, "invalid-byte-size"],
    ["createdAt", undefined, "invalid-date"],
    ["createdAt", originalAt.toISOString(), "invalid-date"],
    ["createdAt", new Date(Number.NaN), "invalid-date"],
    ["type", "pdf", "unsupported-kind"],
    ["mimeType", undefined, "invalid-text"],
    ["filename", null, "invalid-text"],
    ["filename", "bad\u0000name", "unrepresentable-text"],
    ["filename", "\uD800", "unrepresentable-text"],
    ["__updatedAt", -1, "invalid-sync-timestamp"],
    ["__updatedAt", null, "invalid-sync-timestamp"],
    ["__updatedAt", undefined, "invalid-sync-timestamp"],
    ["__updatedAt", -0, "invalid-sync-timestamp"],
  ])("rejects unrepresentable %s case %#", (field, value, code) =>
    failure([file({ [field]: value })], code as string),
  );
  it.each([
    null,
    [],
    {},
    { _bsontype: "ObjectId", toHexString: () => sourceId.toHexString() },
    "",
    42,
  ])("rejects fabricated identity %#", (value) =>
    failure(
      [file({ _id: value })],
      typeof value === "string" ? "invalid-text" : "invalid-source-id",
    ),
  );
  it.each([
    ["image", null],
    ["image", []],
    ["image", { bad: undefined }],
    ["image", { bad: new Date() }],
    ["image", { bad: Number.NaN }],
    ["image", { bad: -0 }],
    ["image", { bad: [undefined] }],
  ])("rejects metadata that JSONB cannot preserve %#", (field, value) => {
    expect(() =>
      planLegacyFileImport([file({ [field as string]: value })], options()),
    ).toThrow(LegacyFileImportError);
  });
  it("rejects cycles, sparse arrays, symbol fields and accessor-backed metadata", () => {
    const cycle: Row = {};
    cycle.self = cycle;
    const sparse = new Array(2);
    sparse[1] = 1;
    const getter = Object.defineProperty({}, "x", {
      enumerable: true,
      get() {
        throw new Error("should not evaluate");
      },
    });
    for (const image of [
      cycle,
      { sparse },
      { [Symbol("secret")]: 1 },
      getter,
    ]) {
      expect(() => planLegacyFileImport([file({ image })], options())).toThrow(
        LegacyFileImportError,
      );
    }
  });
  it("rejects metadata array accessors without evaluating them", () => {
    let reads = 0;
    const values = [1];
    Object.defineProperty(values, "0", {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    let error: unknown;
    try {
      planLegacyFileImport([file({ image: { values } })], options());
    } catch (caught) {
      error = caught;
    }
    expect(reads).toBe(0);
    expect(error).toBeInstanceOf(LegacyFileImportError);
  });
  it("rejects hidden array metadata instead of silently dropping source evidence", () => {
    const values = [1];
    Object.defineProperty(values, "privateNote", {
      enumerable: false,
      value: "preserve this source evidence",
    });
    failure([file({ image: { values } })], "non-json-metadata");
  });
  it("rejects literal EJSON type tags rather than changing protected evidence on revival", () => {
    failure(
      [file({ image: { innocent: { $date: "2020-01-01T00:00:00.000Z" } } })],
      "snapshot-roundtrip-loss",
    );
  });
  it.each([
    { type: "other" },
    { type: "audio", audio: {} },
    { audio: {} },
    { image: undefined },
  ])("rejects inconsistent kind metadata %#", (override) => {
    expect(() => planLegacyFileImport([file(override)], options())).toThrow(
      LegacyFileImportError,
    );
  });
  it("fails duplicate source identities, canonical aliases and digest collisions without partial plans", () => {
    failure([file(), file()], "duplicate-source-id");
    const different = file({
      _id: new ObjectId("000000000000000000000002"),
      sha256: "b".repeat(64),
    });
    failure([file(), different], "canonical-alias-collision");
    failure(
      [file(), { ...different, sha256: "a".repeat(64) }],
      "duplicate-digest-needs-review",
      options({
        lookup: (ref) => (ref.legacyIdValue.endsWith("1") ? firstId : secondId),
      }),
    );
  });
  it.each([null, "bad", "00000000-0000-4000-8000-000000000000"])(
    "rejects missing or non-v7 alias %#",
    (id) =>
      failure(
        [file()],
        "missing-or-invalid-alias",
        options({ lookup: () => id }),
      ),
  );
  it.each([
    { storageProvider: "" },
    { sourceBucket: "  " },
    { sourceBucket: "invalid\u0000" },
    { importedAt: new Date(Number.NaN) },
    { lookup: null },
  ])("requires explicit valid import options %#", (override) => {
    expect(() =>
      planLegacyFileImport([file()], {
        ...options(),
        ...override,
      } as LegacyFileImportOptions),
    ).toThrow(LegacyFileImportError);
  });
  it("rejects malformed input containers", () => {
    expect(() => planLegacyFileImport(null as never, options())).toThrow(
      LegacyFileImportError,
    );
    expect(() => planLegacyFileImport([], null as never)).toThrow(
      LegacyFileImportError,
    );
    for (const value of [null, [], 3, new Date()])
      expect(() => planLegacyFileImport([value], options())).toThrow(
        LegacyFileImportError,
      );
  });
});

const harness = await createMemoryPgliteHarness({
  schema: { loomFilesTable, legacyFileSnapshots, legacyIdType },
});
const { db } = harness;
afterAll(() => harness.client.close());
beforeEach(async () => {
  await db.delete(legacyFileSnapshots);
  await db.delete(loomFilesTable);
});

describe("Loom managed Files schema and protected provenance", () => {
  it("persists the exact metadata/import dates and raw source separately", async () => {
    const plan = planLegacyFileImport([file()], options());
    await db.transaction(async (tx) => {
      await tx.insert(loomFilesTable).values(plan.files);
      await tx.insert(legacyFileSnapshots).values(plan.snapshots);
    });
    const [stored] = await db.select().from(loomFilesTable);
    // PGlite 0.3.16's bare text decoder removes a leading BOM; verify actual
    // UTF-8 bytes and JSON-wrapped read instead of changing stored text.
    const { originalFilename: _bareText, ...storedRest } = stored;
    const { originalFilename: expectedFilename, ...expectedRest } =
      plan.files[0];
    expect(storedRest).toEqual(expectedRest);
    const evidence = await db.execute(
      sql`select json_build_object('value', original_filename) as wrapped, encode(convert_to(original_filename, 'UTF8'), 'hex') as bytes from loom_files`,
    );
    expect(evidence.rows[0].wrapped).toEqual({ value: expectedFilename });
    expect(evidence.rows[0].bytes).toBe(
      Buffer.from(expectedFilename as string).toString("hex"),
    );
    expect(await db.select().from(legacyFileSnapshots)).toEqual(plan.snapshots);
  });
  it("persists a verified prefixed key independently of its unchanged public URL", async () => {
    const prefix = " verified e\u0301 é/";
    const plan = planLegacyFileImport(
      [file()],
      options({ sourceObjectKeyPrefix: prefix }),
    );
    await db.transaction(async (tx) => {
      await tx.insert(loomFilesTable).values(plan.files);
      await tx.insert(legacyFileSnapshots).values(plan.snapshots);
    });
    const [stored] = await db.select().from(legacyFileSnapshots);
    expect(stored).toEqual(plan.snapshots[0]);
    const [metadata] = await db.select().from(loomFilesTable);
    expect(metadata.objectKey).toBe(prefix + "a".repeat(64));
    expect(stored.legacyPublicPath).toBe(`/api/file2?sha256=${"a".repeat(64)}`);
    const bytes = await db.execute(
      sql`select encode(convert_to(source_object_key, 'UTF8'), 'hex') as bytes from legacy_file_snapshots`,
    );
    expect(bytes.rows[0].bytes).toBe(
      Buffer.from(metadata.objectKey).toString("hex"),
    );
  });
  it("retains the bare-key default for existing snapshot insertions", async () => {
    const plan = planLegacyFileImport([file()], options());
    const { sourceObjectKeyPrefix: _explicitEmpty, ...oldSnapshot } =
      plan.snapshots[0];
    await db.insert(loomFilesTable).values(plan.files);
    await db.insert(legacyFileSnapshots).values(oldSnapshot);
    expect(await db.select().from(legacyFileSnapshots)).toEqual(plan.snapshots);
  });
  it("rejects prefix/key/public-path mismatch and absent or malformed archived digest", async () => {
    const plan = planLegacyFileImport(
      [file()],
      options({ sourceObjectKeyPrefix: "verified/" }),
    );
    const modifiedSource = (digest: unknown) => {
      const input = file();
      if (digest === undefined) delete input.sha256;
      else input.sha256 = digest;
      const sourceEjson = EJSON.stringify(input, { relaxed: false });
      return {
        sourceEjson,
        sourceSha256: createHash("sha256").update(sourceEjson).digest("hex"),
      };
    };
    for (const changes of [
      { sourceObjectKey: "a".repeat(64) },
      { sourceObjectKeyPrefix: "other/" },
      {
        sourceObjectKeyPrefix: "wrong",
        sourceObjectKey: `wrong${"a".repeat(64)}`,
      },
      {
        sourceObjectKeyPrefix: "é".repeat(480) + "/",
        sourceObjectKey: `${"é".repeat(480)}/${"a".repeat(64)}`,
      },
      { legacyPublicPath: `/api/file2?sha256=verified/${"a".repeat(64)}` },
      modifiedSource(undefined),
      modifiedSource(null),
      modifiedSource(1),
      modifiedSource("A".repeat(64)),
      modifiedSource("b".repeat(64)),
    ]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(loomFilesTable).values(plan.files);
          await tx
            .insert(legacyFileSnapshots)
            .values({ ...plan.snapshots[0], ...changes });
        }),
      ).rejects.toThrow();
      expect(await db.select().from(loomFilesTable)).toEqual([]);
      expect(await db.select().from(legacyFileSnapshots)).toEqual([]);
    }
  });
  it("keeps the untouched managed UUIDv7 and private defaults for newly inserted metadata", async () => {
    const [inserted] = await db
      .insert(loomFilesTable)
      .values({
        sha256: "b".repeat(64),
        byteSize: 1,
        storageProvider: "unconfigured",
        objectKey: "b".repeat(64),
      })
      .returning();
    expect(isUuidV7(inserted.id)).toBe(true);
    expect(inserted.visibility).toBe("private");
    expect(inserted.ownerId).toBeNull();
  });
  it("enforces Loom's digest uniqueness, while import collisions remain explicit review errors", async () => {
    const plan = planLegacyFileImport([file()], options());
    await db.insert(loomFilesTable).values(plan.files);
    await expect(
      db.insert(loomFilesTable).values({ ...plan.files[0], id: secondId }),
    ).rejects.toThrow();
  });
  it("binds protected evidence to an existing canonical file", async () => {
    const plan = planLegacyFileImport([file()], options());
    await expect(
      db.insert(legacyFileSnapshots).values(plan.snapshots),
    ).rejects.toThrow();
  });
  it("rolls back all metadata when source evidence is altered or bound to a rewritten path", async () => {
    const plan = planLegacyFileImport([file()], options());
    for (const change of [
      { sourceSha256: "0".repeat(64) },
      { legacyPublicPath: "/api/files/new" },
      { sourceObjectKey: "B".repeat(64) },
      { legacySyncUpdatedAtMilliseconds: -1 },
    ]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(loomFilesTable).values(plan.files);
          await tx
            .insert(legacyFileSnapshots)
            .values({ ...plan.snapshots[0], ...change });
        }),
      ).rejects.toThrow();
      expect(await db.select().from(loomFilesTable)).toEqual([]);
    }
  });
  it("keeps a single reviewed baseline per canonical file and preserves it after file metadata changes", async () => {
    const plan = planLegacyFileImport([file()], options());
    await db.insert(loomFilesTable).values(plan.files);
    await db.insert(legacyFileSnapshots).values(plan.snapshots);
    await expect(
      db.insert(legacyFileSnapshots).values({
        ...plan.snapshots[0],
        legacyIdType: "string",
        legacyIdValue: "another-id",
      }),
    ).rejects.toThrow();
    await db
      .update(loomFilesTable)
      .set({
        originalFilename: "new name",
        ownerId: firstId,
        visibility: "private",
      })
      .where(eq(loomFilesTable.id, firstId));
    expect(await db.select().from(legacyFileSnapshots)).toEqual(plan.snapshots);
  });
});
