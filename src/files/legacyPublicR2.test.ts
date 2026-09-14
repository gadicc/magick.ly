import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  createLegacyPublicR2Storage,
  type LegacyPublicR2Config,
} from "./legacyPublicR2";

vi.mock("server-only", () => ({}));

const bytes = new TextEncoder().encode("legacy-object");
const sha256 = "a".repeat(64);
const config: LegacyPublicR2Config = {
  kind: "r2",
  endpoint: "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
  region: "weur",
  bucket: "legacy-bucket",
  credentials: { accessKeyId: "EXAMPLE", secretAccessKey: "synthetic-only" },
};
const relocationConfig: LegacyPublicR2Config = {
  ...config,
  region: "auto",
  bucket: "magickli-files-production",
  credentials: {
    accessKeyId: "NEWEXAMPLE",
    secretAccessKey: "new-synthetic-only",
  },
};

afterEach(() => vi.restoreAllMocks());

describe("legacy public Loom R2 reader", () => {
  it("reads the exact snapshot key from the closed bucket without using provider MIME", async () => {
    const handle = vi.fn(
      async (_request: { method: string; hostname: string; path: string }) => ({
        response: {
          statusCode: 200,
          headers: {
            "content-length": String(bytes.byteLength),
            "content-type": "application/octet-stream",
          },
          body: Readable.from([bytes]),
        },
      }),
    );
    const provider = createLegacyPublicR2Storage(config, {
      requestHandler: { handle } as never,
    });

    const object = await provider.storage.read(
      {
        id: createUuidV7(),
        sha256,
        byteSize: bytes.byteLength,
        contentType: "image/svg+xml",
        originalFilename: "legacy.svg",
        storageProvider: "r2",
        bucket: config.bucket,
        objectKey: `${config.bucket}/${sha256}`,
      },
      new AbortController().signal,
    );

    expect(object?.byteSize).toBe(bytes.byteLength);
    expect(
      new Uint8Array(await new Response(object?.body).arrayBuffer()),
    ).toEqual(bytes);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      hostname: new URL(config.endpoint).hostname,
      path: `/${config.bucket}/${config.bucket}/${sha256}`,
    });
    provider.destroy();
  });

  it("reads a verified relocation with only the replacement credentials", async () => {
    const handle = vi.fn(
      async (_request: { method: string; hostname: string; path: string }) => ({
        response: {
          statusCode: 200,
          headers: { "content-length": String(bytes.byteLength) },
          body: Readable.from([bytes]),
        },
      }),
    );
    const provider = createLegacyPublicR2Storage([relocationConfig], {
      requestHandler: { handle } as never,
    });
    const object = await provider.storage.read(
      {
        id: createUuidV7(),
        sha256,
        byteSize: bytes.byteLength,
        contentType: "image/svg+xml",
        originalFilename: "legacy.svg",
        storageProvider: "r2",
        bucket: relocationConfig.bucket,
        objectKey: `legacy-file2/${sha256}`,
      },
      new AbortController().signal,
    );

    expect(
      new Uint8Array(await new Response(object?.body).arrayBuffer()),
    ).toEqual(bytes);
    expect(handle.mock.calls[0]?.[0]).toMatchObject({
      path: `/${relocationConfig.bucket}/legacy-file2/${sha256}`,
    });
    provider.destroy();
  });

  it("does not use a configured replacement bucket for an unrelocated row", async () => {
    const provider = createLegacyPublicR2Storage([relocationConfig], {
      requestHandler: { handle: vi.fn() } as never,
    });
    await expect(
      provider.storage.read(
        {
          id: createUuidV7(),
          sha256,
          byteSize: bytes.byteLength,
          contentType: "image/svg+xml",
          originalFilename: null,
          storageProvider: "r2",
          bucket: config.bucket,
          objectKey: `${config.bucket}/${sha256}`,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("unavailable");
    provider.destroy();
  });
});
