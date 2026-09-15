import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  legacyFileRelocations,
  legacyFileSnapshots,
} from "../db/schema/legacyFiles";
import { legacyIdType } from "../db/schema/legacyIds";
import { loomFilesTable } from "../db/schema/loomFiles";
import { createUuidV7 } from "../lib/ids";

const transport = vi.hoisted(() => ({
  handle: vi.fn(),
  created: vi.fn(),
  destroyers: [] as Array<() => void>,
}));
vi.mock("server-only", () => ({}));
vi.mock("./legacyPublicR2", async (original) => {
  const actual = await original<typeof import("./legacyPublicR2")>();
  return {
    ...actual,
    createLegacyPublicR2Storage: (
      config: Parameters<typeof actual.createLegacyPublicR2Storage>[0],
    ) => {
      transport.created();
      const provider = actual.createLegacyPublicR2Storage(config, {
        requestHandler: { handle: transport.handle },
      });
      transport.destroyers.push(provider.destroy);
      return provider;
    },
  };
});

const harness = await createMemoryPgliteHarness({
  schema: {
    loomFilesTable,
    legacyFileSnapshots,
    legacyFileRelocations,
    legacyIdType,
  },
});
const { db } = harness;
vi.doMock("../db/neonFull", () => ({ db }));
afterAll(() => harness.client.close());

const bytes = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sourceEjson = JSON.stringify({ sha256 });
const sourceSha256 = createHash("sha256").update(sourceEjson).digest("hex");
const fileId = createUuidV7();
const endpoint =
  "https://00000000000000000000000000000000.r2.cloudflarestorage.com";
const canonical = {
  FILES_STORAGE_PROVIDER: "cloudflare-r2",
  FILES_S3_REGION: "auto",
  FILES_S3_FORCE_PATH_STYLE: "true",
  FILES_S3_ENDPOINT: endpoint,
  FILES_S3_BUCKET: "magickli-files-preview",
  FILES_S3_ACCESS_KEY_ID: "SYNTHETIC",
  FILES_S3_SECRET_ACCESS_KEY: "synthetic-only",
};
const legacyKeys = [
  "AWS_S3_ENDPOINT_URL",
  "AWS_S3_DEFAULT_BUCKET",
  "AWS_REGION_APP",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID_APP",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY_APP",
  "AWS_SECRET_ACCESS_KEY",
];

function configure(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function request(query = `sha256=${sha256}`, headers?: HeadersInit) {
  return new Request(`https://preview.example/api/file2?${query}`, { headers });
}

async function runtime() {
  const { GET } = await import("../app/api/file2/route");
  return GET;
}

async function insertLegacyFile(relocated = false) {
  await db.insert(loomFilesTable).values({
    id: fileId,
    sha256,
    byteSize: bytes.byteLength,
    originalFilename: "legacy α.svg",
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
    importedAt: new Date("2026-09-12T00:00:00Z"),
  });
  if (relocated)
    await db.insert(legacyFileRelocations).values({
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
      verifiedAt: new Date("2026-09-13T00:00:00Z"),
    });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of [...legacyKeys, ...Object.keys(canonical)])
    vi.stubEnv(key, undefined);
  transport.handle.mockImplementation(async () => ({
    response: {
      statusCode: 200,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "application/octet-stream",
      },
      body: Readable.from([bytes]),
    },
  }));
  await db.delete(legacyFileRelocations);
  await db.delete(legacyFileSnapshots);
  await db.delete(loomFilesTable);
});
afterEach(() => {
  for (const destroy of transport.destroyers.splice(0)) destroy();
  vi.unstubAllEnvs();
});

describe("legacy public runtime without retired credentials", () => {
  it.each(["", "sha256=bad", `sha256=${sha256}&sha256=${sha256}`])(
    "preserves invalid-reference 400 before storage initialization: %s",
    async (query) => {
      const response = await (await runtime())(request(query));
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Invalid file reference\n");
      expect(transport.created).not.toHaveBeenCalled();
      expect(transport.handle).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "returns 404 for absent SQL rows with Preview config %s",
    async (preview) => {
      if (preview) configure(canonical);
      const response = await (await runtime())(request());
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found\n");
      expect(transport.created).not.toHaveBeenCalled();
      expect(transport.handle).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "returns safe 503 for a real legacy row with no matching storage (Preview %s)",
    async (preview) => {
      if (preview) configure(canonical);
      await insertLegacyFile();
      const response = await (await runtime())(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("File temporarily unavailable\n");
      expect(transport.created).not.toHaveBeenCalled();
      expect(transport.handle).not.toHaveBeenCalled();
    },
  );

  it.each(["private", "deleted"])(
    "never initializes storage for a %s legacy row",
    async (kind) => {
      await insertLegacyFile();
      await db
        .update(loomFilesTable)
        .set(
          kind === "private"
            ? {
                visibility: "private",
                ownerType: "user",
                ownerId: createUuidV7(),
              }
            : { deletedAt: new Date() },
        )
        .where(eq(loomFilesTable.id, fileId));
      expect((await (await runtime())(request())).status).toBe(404);
      expect(transport.created).not.toHaveBeenCalled();
      expect(transport.handle).not.toHaveBeenCalled();
    },
  );

  it("serves exact relocated bytes with canonical settings only, then reuses its provider", async () => {
    configure({ ...canonical, FILES_S3_BUCKET: "magickli-files-production" });
    await insertLegacyFile(true);
    const GET = await runtime();
    for (let i = 0; i < 2; i++) {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("content-disposition")).toContain(
        "legacy%20%CE%B1.svg",
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
    expect(transport.created).toHaveBeenCalledOnce();
    expect(transport.handle).toHaveBeenCalledTimes(2);
    expect(transport.handle.mock.calls[0][0]).toMatchObject({
      method: "GET",
      hostname: new URL(endpoint).hostname,
      path: `/magickli-files-production/legacy-file2/${sha256}`,
    });
  });

  it("keeps a failed setup retryable and does not substitute the Production bucket for unrelocated rows", async () => {
    await insertLegacyFile(true);
    const GET = await runtime();
    expect((await GET(request())).status).toBe(503);
    configure({ ...canonical, FILES_S3_BUCKET: "magickli-files-production" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    await db.delete(legacyFileRelocations);
    expect((await GET(request())).status).toBe(503);
    expect(transport.created).toHaveBeenCalledOnce();
    expect(transport.handle).toHaveBeenCalledOnce();
  });

  it("keeps conditional public responses independent of storage", async () => {
    await insertLegacyFile();
    const response = await (await runtime())(
      request(undefined, { "if-none-match": `"${sha256}"` }),
    );
    expect(response.status).toBe(304);
    expect(transport.created).not.toHaveBeenCalled();
    expect(transport.handle).not.toHaveBeenCalled();
  });
});
