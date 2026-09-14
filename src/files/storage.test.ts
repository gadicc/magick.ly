import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type { RitualFileRecord } from "./repository";
import { createRitualFileR2Storage, createRitualFileStorage } from "./storage";

vi.mock("server-only", () => ({}));
vi.mock("../db/neon", () => ({ db: {} }));
vi.mock("../auth/session", () => ({
  getCurrentSqlUserId: vi.fn(async () => null),
}));
vi.mock("../db/neonFull", () => ({ db: {} }));

const endpoint =
  "https://00000000000000000000000000000000.r2.cloudflarestorage.com";
const bucket = "private-ritual-files";
const environment = {
  FILES_STORAGE_PROVIDER: "cloudflare-r2",
  FILES_S3_REGION: "auto",
  FILES_S3_FORCE_PATH_STYLE: "true",
  FILES_S3_ENDPOINT: endpoint,
  FILES_S3_BUCKET: bucket,
  FILES_S3_ACCESS_KEY_ID: "EXAMPLE",
  FILES_S3_SECRET_ACCESS_KEY: "synthetic-only",
};
const minioEnvironment = {
  NODE_ENV: "production",
  MAGICKLI_LOCAL_ACCEPTANCE: "1",
  BETTER_AUTH_URL: "http://127.0.0.1:3115",
  DATABASE_URL:
    "postgresql://local:synthetic@127.0.0.1:5432/magickli_acceptance_20260914",
  FILES_STORAGE_PROVIDER: "minio",
  FILES_S3_REGION: "auto",
  FILES_S3_FORCE_PATH_STYLE: "true",
  FILES_S3_ENDPOINT: "http://127.0.0.1:9125",
  FILES_S3_BUCKET: "magickli-local-acceptance",
  FILES_S3_ACCESS_KEY_ID: "LOCALONLY",
  FILES_S3_SECRET_ACCESS_KEY: "synthetic-only",
};
const bytes = new Uint8Array([1, 2, 3, 4]);
const record = {
  id: createUuidV7(),
  ritualId: createUuidV7(),
  attachmentId: createUuidV7(),
  operationId: createUuidV7(),
  audioMeta: null,
  bucket,
  byteSize: bytes.length,
  contentType: "image/png",
  detectedContentType: "image/png",
  imageMeta: { format: "png", width: 1, height: 1 },
  kind: "image",
  meta: {},
  objectKey: `ritual-files/${createUuidV7()}`,
  originalFilename: "private.png",
  ownerId: createUuidV7(),
  ownerType: "user",
  sha256: "a".repeat(64),
  storageProvider: "r2",
  visibility: "private",
} satisfies RitualFileRecord;
const providers: Array<{ destroy(): void }> = [];

afterEach(() => {
  for (const provider of providers.splice(0)) provider.destroy();
  vi.restoreAllMocks();
});

describe("managed ritual file R2 storage", () => {
  it.each([
    { FILES_S3_ENDPOINT: "https://example.com" },
    { FILES_S3_ENDPOINT: endpoint.replace("https:", "http:") },
    { FILES_S3_ENDPOINT: `${endpoint}/other-prefix` },
    { FILES_S3_ENDPOINT: `${endpoint}?query=value` },
    { FILES_S3_ENDPOINT: endpoint.replace("https://", "https://user:pass@") },
    { FILES_S3_BUCKET: "private/other-bucket" },
  ])(
    "rejects invalid storage destinations before constructing a reader",
    (override) => {
      const handle = vi.fn();
      expect(() =>
        createRitualFileR2Storage(
          { ...environment, ...override },
          { requestHandler: { handle } as never },
        ),
      ).toThrow("Invalid R2 ritual storage configuration");
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it("reads only an exact canonical record through Loom's closed adapter", async () => {
    const handle = vi.fn(
      async (request: { method: string; hostname: string; path: string }) => ({
        response: {
          statusCode: 200,
          headers: {
            "content-length": String(bytes.length),
            "content-type": "image/png",
          },
          body: Readable.from([bytes]),
        },
      }),
    );
    const provider = createRitualFileR2Storage(environment, {
      requestHandler: { handle } as never,
    });
    providers.push(provider);
    const object = await provider.storage.getObject?.({
      bucket,
      objectKey: record.objectKey,
      record,
    });
    expect(
      new Uint8Array(await new Response(object?.body).arrayBuffer()),
    ).toEqual(bytes);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      hostname: new URL(endpoint).hostname,
      path: `/${bucket}/${record.objectKey}`,
    });
  });

  it("rejects staging, wrong-bucket and generic write requests before I/O", async () => {
    const handle = vi.fn();
    const provider = createRitualFileR2Storage(environment, {
      requestHandler: { handle } as never,
    });
    providers.push(provider);
    for (const changed of [
      { ...record, objectKey: "ritual-staging/operation" },
      { ...record, bucket: "other-bucket" },
      { ...record, storageProvider: "legacy-r2" },
    ])
      await expect(
        provider.storage.getObject?.({
          bucket: changed.bucket,
          objectKey: changed.objectKey,
          record: changed,
        }),
      ).rejects.toThrow("unavailable");
    await expect(
      provider.storage.putObject({
        body: bytes,
        byteSize: bytes.length,
        objectKey: record.objectKey,
        sha256: record.sha256,
      }),
    ).rejects.toThrow("writes are disabled");
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("managed ritual file MinIO storage", () => {
  it("reads only a MinIO-bound canonical record from the loopback endpoint", async () => {
    const handle = vi.fn(async (_request: unknown) => ({
      response: {
        statusCode: 200,
        headers: {
          "content-length": String(bytes.length),
          "content-type": "image/png",
        },
        body: Readable.from([bytes]),
      },
    }));
    const provider = createRitualFileStorage(minioEnvironment, {
      requestHandler: { handle } as never,
    });
    providers.push(provider);
    const localRecord = {
      ...record,
      bucket: minioEnvironment.FILES_S3_BUCKET,
      storageProvider: "minio",
    };
    const object = await provider.storage.getObject?.({
      bucket: localRecord.bucket,
      objectKey: localRecord.objectKey,
      record: localRecord,
    });
    expect(
      new Uint8Array(await new Response(object?.body).arrayBuffer()),
    ).toEqual(bytes);
    expect(provider.storage.provider).toBe("minio");
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      hostname: "127.0.0.1",
      port: 9125,
      path: `/${localRecord.bucket}/${localRecord.objectKey}`,
    });
  });
});
