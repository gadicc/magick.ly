import { createHash } from "node:crypto";
import type { LoomFileStorageAdapter } from "@gadicc/loom/files";
import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type { RitualFileRecord } from "./repository";
import {
  createAuthorizedRitualFileReader,
  createRitualFileLoomService,
} from "./ritualFileService";

vi.mock("server-only", () => ({}));

const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const record = {
  id: createUuidV7(),
  ritualId: createUuidV7(),
  attachmentId: createUuidV7(),
  operationId: createUuidV7(),
  audioMeta: null,
  bucket: "private-files",
  byteSize: bytes.length,
  contentType: "image/png",
  detectedContentType: "image/png",
  imageMeta: { format: "png", width: 1, height: 1 },
  kind: "image",
  meta: {},
  objectKey: "ritual-files/synthetic",
  originalFilename: "synthetic.png",
  ownerId: createUuidV7(),
  ownerType: "user",
  sha256,
  storageProvider: "r2",
  visibility: "private",
} satisfies RitualFileRecord;
const locator = {
  ritualId: record.ritualId,
  attachmentId: record.attachmentId,
  fileId: record.id,
};

function setup() {
  const repository = { findById: vi.fn(async () => ({ ...record })) };
  const storage: LoomFileStorageAdapter = {
    provider: "r2",
    putObject: vi.fn(async () => {
      throw new Error();
    }),
    getObject: vi.fn(async () => ({
      body: bytes.slice(),
      byteSize: bytes.length,
      contentType: "image/png",
    })),
  };
  const authorize = vi.fn(async () => true);
  return {
    repository,
    storage,
    authorize,
    read: createAuthorizedRitualFileReader({
      repository,
      storage,
      authorize,
    }),
  };
}

describe("authorized ritual file read", () => {
  it("checks association and policy before and after verified bounded bytes", async () => {
    const f = setup();
    const result = await f.read(locator);
    expect(result).toEqual({ record, bytes });
    expect(f.repository.findById).toHaveBeenCalledTimes(2);
    expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(f.storage.getObject).toHaveBeenCalledOnce();
    result?.bytes.fill(9);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does no provider read when the first current policy check fails", async () => {
    const f = setup();
    f.authorize.mockResolvedValue(false);
    await expect(f.read(locator)).resolves.toBeNull();
    expect(f.storage.getObject).not.toHaveBeenCalled();
  });

  it("withholds bytes when access or association changes during provider I/O", async () => {
    const f = setup();
    f.authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.read(locator)).resolves.toBeNull();
    expect(f.authorize).toHaveBeenCalledTimes(2);

    const changed = setup();
    changed.repository.findById
      .mockResolvedValueOnce({ ...record })
      .mockResolvedValueOnce({ ...record, attachmentId: createUuidV7() });
    await expect(changed.read(locator)).resolves.toBeNull();
    expect(changed.authorize).toHaveBeenCalledOnce();
  });

  it("rejects provider size, type and digest mismatches", async () => {
    for (const object of [
      {
        body: bytes.slice(),
        byteSize: bytes.length + 1,
        contentType: "image/png",
      },
      {
        body: bytes.slice(),
        byteSize: bytes.length,
        contentType: "image/jpeg",
      },
      {
        body: new Uint8Array([1, 2, 3, 5]),
        byteSize: bytes.length,
        contentType: "image/png",
      },
    ]) {
      const f = setup();
      vi.mocked(f.storage.getObject!).mockResolvedValueOnce(object);
      await expect(f.read(locator)).resolves.toBeNull();
      expect(f.repository.findById).toHaveBeenCalledOnce();
    }
  });

  it("adapts only authorized downloads to Loom and keeps generic writes disabled", async () => {
    const f = setup();
    const service = createRitualFileLoomService({
      repository: f.repository,
      readAuthorized: f.read,
    });
    expect(await service.getFileById(record.id)).toEqual({
      ...record,
      originalFilename: null,
    });
    expect(await service.getFileBySha256(sha256)).toBeNull();
    const object = await service.getDownloadObject(record);
    expect(object).toMatchObject({
      byteSize: bytes.length,
      contentType: "image/png",
      etag: `\"${sha256}\"`,
    });
    await expect(service.saveFile({ body: bytes })).rejects.toThrow(
      "writes are disabled",
    );
  });
});
