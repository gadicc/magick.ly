import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  createPrivateRitualImageCatalog,
  type PrivateRitualImageCatalog,
  PrivateRitualImageCatalogError,
} from "./privateRitualImageCatalog";
import type { RitualFileRecord } from "./repository";
import { formatRitualFileLocator } from "./ritualFileLocator";

vi.mock("server-only", () => ({}));

const locator = {
  ritualId: createUuidV7(),
  attachmentId: createUuidV7(),
  fileId: createUuidV7(),
};
const reference = formatRitualFileLocator(locator);
let bytes: Uint8Array;
let record: RitualFileRecord;
const catalogs: PrivateRitualImageCatalog[] = [];

beforeAll(async () => {
  bytes = Uint8Array.from(
    await sharp({
      create: { width: 3, height: 2, channels: 4, background: "red" },
    })
      .png()
      .toBuffer(),
  );
  record = {
    id: locator.fileId,
    ritualId: locator.ritualId,
    attachmentId: locator.attachmentId,
    operationId: createUuidV7(),
    audioMeta: null,
    bucket: "private-files",
    byteSize: bytes.length,
    contentType: "image/png",
    detectedContentType: "image/png",
    imageMeta: { format: "png", width: 3, height: 2 },
    kind: "image",
    meta: {},
    objectKey: `ritual-files/${locator.fileId}`,
    originalFilename: "private.png",
    ownerId: createUuidV7(),
    ownerType: "user",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storageProvider: "r2",
    visibility: "private",
  };
});

afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.dispose();
});

async function catalog(
  readAuthorized: Parameters<
    typeof createPrivateRitualImageCatalog
  >[0]["readAuthorized"] = async () => ({
    record: { ...record },
    bytes: bytes.slice(),
  }),
  extra: Partial<Parameters<typeof createPrivateRitualImageCatalog>[0]> = {},
) {
  const result = await createPrivateRitualImageCatalog({
    references: [reference],
    readAuthorized,
    ...extra,
  });
  catalogs.push(result);
  return result;
}

describe("private ritual image catalog", () => {
  it("captures freshly authorized finalized bytes with distinct private provenance", async () => {
    const read = vi.fn(async () => ({
      record: { ...record },
      bytes: bytes.slice(),
    }));
    const result = await catalog(read);
    expect(read).toHaveBeenCalledWith(locator);
    expect(result.metadata).toMatchObject({
      profile: "magickli-private-ritual-image-catalog-v1",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      validationSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      entries: [
        {
          kind: "available",
          ritualId: locator.ritualId,
          attachmentId: locator.attachmentId,
          fileId: locator.fileId,
          sourceSha256: record.sha256,
          sha256: record.sha256,
          bytes: bytes.length,
          mime: "image/png",
          width: 3,
          frameHeight: 2,
          frames: 1,
          decodedPixels: 6,
        },
      ],
    });
    const key = result.metadata.entries[0].referenceSha256;
    const copy = result.copyBytes(key)!;
    expect([...copy]).toEqual([...bytes]);
    copy.fill(0);
    expect([...(result.copyBytes(key) ?? [])]).toEqual([...bytes]);
  });

  it("records unavailable authorization, metadata and object mismatches without leaking details", async () => {
    for (const read of [
      async () => null,
      async () => ({
        record: {
          ...record,
          imageMeta: { format: "png", width: 4, height: 2 },
        },
        bytes: bytes.slice(),
      }),
      async () => ({
        record: { ...record },
        bytes: new Uint8Array(bytes.length),
      }),
    ])
      expect((await catalog(read)).metadata.entries).toEqual([
        expect.objectContaining({ kind: "unresolved", reason: "unavailable" }),
      ]);
  });

  it("rejects noncanonical, duplicate and over-budget input before publication", async () => {
    await expect(
      createPrivateRitualImageCatalog({
        references: [`${reference}&extra=1`],
        readAuthorized: async () => null,
      }),
    ).rejects.toBeInstanceOf(PrivateRitualImageCatalogError);
    await expect(
      createPrivateRitualImageCatalog({
        references: [reference, reference],
        readAuthorized: async () => null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      catalog(undefined, { limits: { capturedBytes: bytes.length - 1 } }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  });

  it("wipes returned bytes when cancellation lands as an authorized read resolves", async () => {
    const controller = new AbortController();
    const owned = bytes.slice();
    await expect(
      createPrivateRitualImageCatalog({
        references: [reference],
        signal: controller.signal,
        readAuthorized: async () => {
          controller.abort();
          return { record: { ...record }, bytes: owned };
        },
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(owned.every((byte) => byte === 0)).toBe(true);
  });
});
