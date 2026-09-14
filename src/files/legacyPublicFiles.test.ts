import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  legacyFileRelocations,
  legacyFileSnapshots,
} from "../db/schema/legacyFiles";
import { legacyIdType } from "../db/schema/legacyIds";
import { loomFilesTable } from "../db/schema/loomFiles";
import { createUuidV7 } from "../lib/ids";
import { createLegacyPublicFileGet } from "./legacyPublicFileRoute";
import { createSqlLegacyPublicFileReader } from "./legacyPublicFiles";
import type { LegacyPublicObjectStorage } from "./legacyPublicR2";

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

const bytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sourceEjson = JSON.stringify({ sha256 });
const sourceSha256 = createHash("sha256")
  .update(sourceEjson, "utf8")
  .digest("hex");
const fileId = createUuidV7();
const filename = 'legacy α "diagram".svg';

async function insertLegacyFile() {
  await db.insert(loomFilesTable).values({
    id: fileId,
    sha256,
    byteSize: bytes.byteLength,
    originalFilename: filename,
    contentType: "image/svg+xml",
    detectedContentType: "image/svg+xml",
    kind: "image",
    storageProvider: "r2",
    bucket: "legacy-bucket",
    objectKey: `legacy-bucket/${sha256}`,
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
    sourceSha256,
    serializationVersion: "bson-canonical-ejson-v1",
    legacyPublicPath: `/api/file2?sha256=${sha256}`,
    sourceStorageProvider: "r2",
    sourceBucket: "legacy-bucket",
    sourceObjectKey: `legacy-bucket/${sha256}`,
    sourceObjectKeyPrefix: "legacy-bucket/",
    importedAt: new Date("2026-09-12T00:00:00.000Z"),
  });
}

const relocation = () => ({
  fileId,
  sourceStorageProvider: "r2",
  sourceBucket: "legacy-bucket",
  sourceObjectKey: `legacy-bucket/${sha256}`,
  sourceMetadataSha256: sourceSha256,
  contentSha256: sha256,
  byteSize: bytes.byteLength,
  destinationStorageProvider: "r2",
  destinationBucket: "magickli-files-production",
  destinationObjectKey: `legacy-file2/${sha256}`,
  verificationProfile: "magickli-legacy-file-relocation-v1",
  verifiedAt: new Date("2026-09-13T00:00:00.000Z"),
});

beforeEach(async () => {
  await db.delete(legacyFileRelocations);
  await db.delete(legacyFileSnapshots);
  await db.delete(loomFilesTable);
  await insertLegacyFile();
});

describe("legacy public file compatibility", () => {
  it("serves only a trusted snapshot location and preserves the imported MIME", async () => {
    const read = createSqlLegacyPublicFileReader(db);
    const storage: LegacyPublicObjectStorage = {
      read: vi.fn(async (file) => {
        expect(file).toMatchObject({
          bucket: "legacy-bucket",
          objectKey: `legacy-bucket/${sha256}`,
        });
        return { body: new Blob([bytes]), byteSize: bytes.byteLength };
      }),
    };
    const response = await createLegacyPublicFileGet({ read, storage })(
      new Request(`https://magick.ly/api/file2?sha256=${sha256}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-disposition")).toContain(
      "legacy _ _diagram_.svg",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''legacy%20%CE%B1%20%22diagram%22.svg",
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(storage.read).toHaveBeenCalledOnce();
  });

  it("answers a matching ETag without reading the provider", async () => {
    const storage: LegacyPublicObjectStorage = {
      read: vi.fn(async () => null),
    };
    const response = await createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage,
    })(
      new Request(`https://magick.ly/api/file2?sha256=${sha256}`, {
        headers: { "if-none-match": `"${sha256}"` },
      }),
    );
    expect(response.status).toBe(304);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("switches the unchanged public URL to an explicitly verified destination", async () => {
    await db.insert(legacyFileRelocations).values(relocation());
    const storage: LegacyPublicObjectStorage = {
      read: vi.fn(async (file) => {
        expect(file).toMatchObject({
          storageProvider: "r2",
          bucket: "magickli-files-production",
          objectKey: `legacy-file2/${sha256}`,
        });
        return { body: new Blob([bytes]), byteSize: bytes.byteLength };
      }),
    };
    const response = await createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage,
    })(new Request(`https://magick.ly/api/file2?sha256=${sha256}`));

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(storage.read).toHaveBeenCalledOnce();
  });

  it("fails closed on a present relocation that no longer binds the source", async () => {
    await db
      .insert(legacyFileRelocations)
      .values({ ...relocation(), sourceMetadataSha256: "f".repeat(64) });
    const storage: LegacyPublicObjectStorage = {
      read: vi.fn(async () => ({ body: new Blob([bytes]) })),
    };
    const response = await createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage,
    })(new Request(`https://magick.ly/api/file2?sha256=${sha256}`));

    expect(response.status).toBe(404);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it("rejects extra compatibility parameters and rows that are no longer public", async () => {
    const storage: LegacyPublicObjectStorage = {
      read: vi.fn(async () => ({ body: new Blob([bytes]) })),
    };
    const GET = createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage,
    });
    expect(
      (
        await GET(
          new Request(
            `https://magick.ly/api/file2?sha256=${sha256}&return=meta`,
          ),
        )
      ).status,
    ).toBe(400);
    await db
      .update(loomFilesTable)
      .set({
        visibility: "private",
        ownerType: "user",
        ownerId: createUuidV7(),
      })
      .where(eq(loomFilesTable.id, fileId));
    expect(
      (await GET(new Request(`https://magick.ly/api/file2?sha256=${sha256}`)))
        .status,
    ).toBe(404);
    expect(storage.read).not.toHaveBeenCalled();
  });
});
