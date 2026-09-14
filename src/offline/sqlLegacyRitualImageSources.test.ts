import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  legacyFileRelocations,
  legacyFileSnapshots,
} from "../db/schema/legacyFiles";
import { legacyIdType } from "../db/schema/legacyIds";
import { loomFilesTable } from "../db/schema/loomFiles";
import {
  LEGACY_FILE_RELOCATION_BUCKET,
  LEGACY_FILE_RELOCATION_PREFIX,
  LEGACY_FILE_RELOCATION_PROFILE,
} from "../files/legacyFileLocation";
import { createUuidV7 } from "../lib/ids";
import { loadSqlLegacyRitualImageSources } from "./sqlLegacyRitualImageSources";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({
  schema: {
    loomFilesTable,
    legacyFileSnapshots,
    legacyFileRelocations,
    legacyIdType,
  },
});
const { db } = harness;
afterAll(() => harness.client.close());

const fileId = createUuidV7();
const sha256 = "a".repeat(64);
const sourceEjson = JSON.stringify({ sha256 });
const sourceMetadataSha256 = createHash("sha256")
  .update(sourceEjson)
  .digest("hex");

async function seed() {
  await db.insert(loomFilesTable).values({
    id: fileId,
    sha256,
    byteSize: 123,
    originalFilename: "legacy.png",
    contentType: "image/png",
    detectedContentType: "image/png",
    kind: "image",
    storageProvider: "r2",
    bucket: "magickly",
    objectKey: `images/${sha256}`,
    ownerType: null,
    ownerId: null,
    visibility: "public",
    meta: {},
  });
  await db.insert(legacyFileSnapshots).values({
    sourceSystem: "mongodb",
    legacyIdType: "objectid",
    legacyIdValue: "0123456789abcdef01234567",
    fileId,
    sourceEjson,
    sourceSha256: sourceMetadataSha256,
    serializationVersion: "bson-canonical-ejson-v1",
    legacyPublicPath: `/api/file2?sha256=${sha256}`,
    sourceStorageProvider: "r2",
    sourceBucket: "magickly",
    sourceObjectKey: `images/${sha256}`,
    sourceObjectKeyPrefix: "images/",
    importedAt: new Date("2026-09-12T00:00:00.000Z"),
  });
}

beforeEach(async () => {
  await db.delete(legacyFileRelocations);
  await db.delete(legacyFileSnapshots);
  await db.delete(loomFilesTable);
  await seed();
});

describe("SQL legacy ritual image sources", () => {
  it("returns an explicit null relocation while the original object is authoritative", async () => {
    const rows = await loadSqlLegacyRitualImageSources(db, [sha256]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      file: { id: fileId, objectKey: `images/${sha256}` },
      snapshot: {
        fileId,
        sourceBucket: "magickly",
        sourceObjectKey: `images/${sha256}`,
      },
      relocation: null,
    });
  });

  it("loads relocation evidence without overwriting original import provenance", async () => {
    await db.insert(legacyFileRelocations).values({
      fileId,
      sourceStorageProvider: "r2",
      sourceBucket: "magickly",
      sourceObjectKey: `images/${sha256}`,
      sourceMetadataSha256,
      contentSha256: sha256,
      byteSize: 123,
      destinationStorageProvider: "r2",
      destinationBucket: LEGACY_FILE_RELOCATION_BUCKET,
      destinationObjectKey: `${LEGACY_FILE_RELOCATION_PREFIX}${sha256}`,
      verificationProfile: LEGACY_FILE_RELOCATION_PROFILE,
      verifiedAt: new Date("2026-09-13T00:00:00.000Z"),
    });

    const [row] = await loadSqlLegacyRitualImageSources(db, [sha256]);
    expect(row.snapshot).toMatchObject({
      sourceBucket: "magickly",
      sourceObjectKey: `images/${sha256}`,
      sourceSha256: sourceMetadataSha256,
    });
    expect(row.file).toMatchObject({
      bucket: "magickly",
      objectKey: `images/${sha256}`,
    });
    expect(row.relocation).toMatchObject({
      destinationBucket: LEGACY_FILE_RELOCATION_BUCKET,
      destinationObjectKey: `${LEGACY_FILE_RELOCATION_PREFIX}${sha256}`,
      contentSha256: sha256,
    });
  });

  it("rejects unbounded, duplicate, or malformed digest requests", async () => {
    await expect(
      loadSqlLegacyRitualImageSources(db, [sha256, sha256]),
    ).rejects.toThrow(TypeError);
    await expect(
      loadSqlLegacyRitualImageSources(db, ["A".repeat(64)]),
    ).rejects.toThrow(TypeError);
  });
});
