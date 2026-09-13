import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatRitualFileLocator } from "@/files/ritualFileLocator";
import type { RitualFileRecord } from "@/files/repository";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  getRendered: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/files/repository", () => ({
  filesRepository: { findById: mocks.findById },
}));
vi.mock("@/files/storage", () => ({
  filesStorage: { provider: "r2", getObject: mocks.getObject },
}));
vi.mock("@/doc/sqlRuntime", () => ({
  sqlRitualReader: { getRendered: mocks.getRendered },
}));

const bytes = new Uint8Array([1, 2, 3, 4]);
const record = {
  id: "01990100-0000-7000-8000-000000000001",
  ritualId: "01990100-0000-7000-8000-000000000002",
  attachmentId: "01990100-0000-7000-8000-000000000003",
  operationId: "01990100-0000-7000-8000-000000000004",
  audioMeta: null,
  bucket: "private-files",
  byteSize: bytes.length,
  contentType: "image/png",
  detectedContentType: "image/png",
  imageMeta: { format: "png", width: 1, height: 1 },
  kind: "image",
  meta: {},
  objectKey: "ritual-files/synthetic",
  originalFilename: "私の画像.png",
  ownerId: "01990100-0000-7000-8000-000000000005",
  ownerType: "user",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  storageProvider: "r2",
  visibility: "private",
} satisfies RitualFileRecord;
const locator = formatRitualFileLocator({
  ritualId: record.ritualId,
  attachmentId: record.attachmentId,
  fileId: record.id,
});
const request = (path = locator) => new Request(`https://app.example${path}`);
const rendered = {
  ritual: { id: record.ritualId, canEdit: true },
  contentJson: '{"children":[]}',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findById.mockResolvedValue({ ...record });
  mocks.getRendered.mockResolvedValue(rendered);
  mocks.getObject.mockImplementation(async () => ({
    body: bytes.slice(),
    byteSize: bytes.length,
    contentType: "image/png",
  }));
});

describe("managed private file HTTP delivery", () => {
  it("serves an editor's unsaved attachment through the actual Loom route", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("refuses metadata and alternate locator spellings before object I/O", async () => {
    for (const path of [
      `/api/files?id=${record.id}`,
      locator.replace("mode=download", "mode=metadata"),
      `${locator}&id=${record.id}`,
      locator.replace(record.ritualId, record.ownerId),
    ]) {
      const response = await GET(request(path));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).not.toContain(record.bucket);
    }
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("withholds image bytes if access is revoked during the object read", async () => {
    mocks.getObject.mockImplementation(async () => {
      mocks.getRendered.mockResolvedValue(null);
      return {
        body: bytes.slice(),
        contentType: "image/png",
        byteSize: bytes.length,
      };
    });
    const response = await GET(request());
    expect(response.ok).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain(record.objectKey);
  });

  it("does not expose repository errors through the shared handler", async () => {
    mocks.findById.mockRejectedValue(new Error("private database diagnostic"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("private database diagnostic");
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
});
