import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readLoomFileBodyBytes, sha256Hex } from "@gadicc/loom/files";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { createMinioRitualBundleStorage } from "../offline/r2RitualBundleStorage";
import type { RitualBundlePublicationClaim } from "../offline/ritualBundlePublication";
import {
  createMinioRitualStorage,
  type MinioRitualStorage,
} from "./r2RitualStorage";
import type { RitualFileRecord } from "./repository";
import { readRitualStorageConfig } from "./ritualStorageConfig";
import { createRitualFileStorage } from "./storage";

vi.mock("server-only", () => ({}));

const settingsPath = process.env.MAGICKLI_LOCAL_MINIO_SETTINGS;
const local = describe.runIf(Boolean(settingsPath));
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

type Settings = {
  appOrigin: string;
  databaseUrl: string;
  storageAccessKey: string;
  storageBucket: string;
  storageEndpoint: string;
  storageSecretKey: string;
};

function exactSettings(value: unknown): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("LOCAL_MINIO_SETTINGS_INVALID");
  const row = value as Record<string, unknown>;
  const keys = [
    "appOrigin",
    "databaseUrl",
    "storageAccessKey",
    "storageBucket",
    "storageEndpoint",
    "storageSecretKey",
  ] as const;
  if (keys.some((key) => typeof row[key] !== "string" || !row[key]))
    throw new Error("LOCAL_MINIO_SETTINGS_INVALID");
  if (
    row.appOrigin !== "http://127.0.0.1:3115" ||
    row.storageEndpoint !== "http://127.0.0.1:9125" ||
    row.storageBucket !== "magickli-local-acceptance"
  )
    throw new Error("LOCAL_MINIO_TARGET_INVALID");
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Settings;
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z_]+$/.test(error.code)
        ? error.code
        : "FAILED";
    throw new Error(`LOCAL_MINIO_PROTOCOL_${code}`);
  }
}

local("real local MinIO ritual protocol", () => {
  let uploadStorage: MinioRitualStorage;
  let bundleStorage: ReturnType<typeof createMinioRitualBundleStorage>;
  let fileStorage: ReturnType<typeof createRitualFileStorage>;
  let settings: Settings;
  let environment: Record<string, string>;

  beforeAll(async () => {
    settings = exactSettings(
      JSON.parse(await readFile(settingsPath as string, "utf8")),
    );
    environment = {
      NODE_ENV: "production",
      MAGICKLI_LOCAL_ACCEPTANCE: "1",
      BETTER_AUTH_URL: settings.appOrigin,
      DATABASE_URL: settings.databaseUrl,
      FILES_STORAGE_PROVIDER: "minio",
      FILES_S3_REGION: "auto",
      FILES_S3_FORCE_PATH_STYLE: "true",
      FILES_S3_ENDPOINT: settings.storageEndpoint,
      FILES_S3_BUCKET: settings.storageBucket,
      FILES_S3_ACCESS_KEY_ID: settings.storageAccessKey,
      FILES_S3_SECRET_ACCESS_KEY: settings.storageSecretKey,
    };
    const config = readRitualStorageConfig(environment);
    if (config.kind !== "minio") throw new Error("LOCAL_MINIO_CONFIG_INVALID");
    uploadStorage = createMinioRitualStorage(config);
    bundleStorage = createMinioRitualBundleStorage({
      kind: "minio",
      endpoint: config.endpoint,
      bucket: config.bucket,
      credentials: config.credentials,
      bundlePrefix: "ritual-bundles",
      reservedPrefixes: [config.stagingPrefix, config.canonicalPrefix],
    });
    fileStorage = createRitualFileStorage(environment);
  });

  afterAll(() => {
    uploadStorage?.destroy();
    bundleStorage?.destroy();
    fileStorage?.destroy();
  });

  it("preserves browser signing, absence, finalization and canonical reads", async () => {
    const bytes = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4,
    ]);
    const request = {
      version: 1 as const,
      operationId: createUuidV7(),
      expectedActorId: createUuidV7(),
      ritualId: createUuidV7(),
      filename: "local.png",
      byteSize: bytes.byteLength,
      contentType: "image/png" as const,
      sha256: await sha256Hex(bytes),
    };
    const identity = {
      request,
      fileId: createUuidV7(),
      attachmentId: createUuidV7(),
    };
    const claim = {
      ...identity,
      ...uploadStorage.locations(identity),
      intentExpiresAtMs: Date.now() + 86_400_000,
      capabilityExpiresAtMs: Date.now() + 300_000,
      claimId: createUuidV7(),
      claimExpiresAtMs: Date.now() + 120_000,
    };
    const preflight = await safe(() =>
      fetch(
        `${settings.storageEndpoint}/${settings.storageBucket}/${claim.staging.objectKey}`,
        {
          method: "OPTIONS",
          headers: {
            Origin: settings.appOrigin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers":
              "content-type,if-none-match,x-amz-checksum-sha256,x-amz-meta-magickli-file-id,x-amz-meta-magickli-operation-id,x-amz-meta-sha256",
          },
        },
      ),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      settings.appOrigin,
    );
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "PUT",
    );
    const allowedHeaders = new Set(
      (preflight.headers.get("access-control-allow-headers") ?? "")
        .toLowerCase()
        .split(",")
        .map((value) => value.trim()),
    );
    for (const header of [
      "content-type",
      "if-none-match",
      "x-amz-checksum-sha256",
      "x-amz-meta-magickli-file-id",
      "x-amz-meta-magickli-operation-id",
      "x-amz-meta-sha256",
    ])
      expect(allowedHeaders).toContain(header);

    const upload = await uploadStorage.directUpload(
      claim,
      new AbortController().signal,
    );
    if (upload.kind !== "presigned-put")
      throw new Error("LOCAL_MINIO_PROTOCOL_FAILED");
    const put = () =>
      safe(() =>
        fetch(upload.url, {
          method: "PUT",
          headers: { ...upload.headers, Origin: settings.appOrigin },
          body: bytes,
        }),
      );
    const uploaded = await put();
    expect(uploaded.status).toBe(200);
    expect(uploaded.headers.get("access-control-allow-origin")).toBe(
      settings.appOrigin,
    );
    expect((await put()).status).toBe(412);

    const staged = await safe(() =>
      uploadStorage.storage.readStaging(claim, new AbortController().signal),
    );
    expect(staged).not.toBeNull();
    const stagedBytes = await readLoomFileBodyBytes(staged!.body, {
      maxBytes: bytes.byteLength,
    });
    staged!.close();
    expect(stagedBytes).toEqual(bytes);

    const finalized = await safe(() =>
      uploadStorage.storage
        .canonicalStorage(claim, new AbortController().signal)
        .putObject({
          body: bytes,
          byteSize: bytes.byteLength,
          contentType: request.contentType,
          detectedContentType: request.contentType,
          objectKey: claim.canonical.objectKey,
          sha256: request.sha256,
          metadata: {},
        }),
    );
    expect(finalized).toMatchObject({
      storageProvider: "minio",
      bucket: settings.storageBucket,
      objectKey: claim.canonical.objectKey,
    });
    const inspection = new S3Client({
      region: "auto",
      endpoint: settings.storageEndpoint,
      credentials: {
        accessKeyId: settings.storageAccessKey,
        secretAccessKey: settings.storageSecretKey,
      },
      forcePathStyle: true,
      maxAttempts: 1,
    });
    const stored = await safe(() =>
      inspection.send(
        new GetObjectCommand({
          Bucket: settings.storageBucket,
          Key: claim.canonical.objectKey,
        }),
      ),
    );
    try {
      expect({
        byteSize: stored.ContentLength,
        contentType: stored.ContentType,
        metadata: stored.Metadata,
      }).toEqual({
        byteSize: bytes.byteLength,
        contentType: request.contentType,
        metadata: {
          sha256: request.sha256,
          "magickli-operation-id": request.operationId,
          "magickli-file-id": identity.fileId,
        },
      });
      let duplicate: { name?: string; status?: number } | undefined;
      try {
        await inspection.send(
          new PutObjectCommand({
            Bucket: settings.storageBucket,
            Key: claim.canonical.objectKey,
            Body: bytes,
            ContentLength: bytes.byteLength,
            ContentType: request.contentType,
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        const value = error as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        duplicate = {
          name: value.name,
          status: value.$metadata?.httpStatusCode,
        };
      }
      expect(duplicate).toEqual({ name: "PreconditionFailed", status: 412 });
    } finally {
      if (stored.Body && "destroy" in stored.Body) stored.Body.destroy();
      inspection.destroy();
    }
    await expect(
      safe(() =>
        uploadStorage.storage
          .canonicalStorage(claim, new AbortController().signal)
          .putObject({
            body: bytes,
            byteSize: bytes.byteLength,
            contentType: request.contentType,
            detectedContentType: request.contentType,
            objectKey: claim.canonical.objectKey,
            sha256: request.sha256,
            metadata: {},
          }),
      ),
    ).resolves.toMatchObject({ storageProvider: "minio" });

    const record = {
      id: identity.fileId,
      ritualId: request.ritualId,
      attachmentId: identity.attachmentId,
      operationId: request.operationId,
      audioMeta: null,
      bucket: settings.storageBucket,
      byteSize: bytes.byteLength,
      contentType: request.contentType,
      detectedContentType: request.contentType,
      imageMeta: { format: "png", width: 1, height: 1 },
      kind: "image",
      meta: {},
      objectKey: claim.canonical.objectKey,
      originalFilename: request.filename,
      ownerId: request.expectedActorId,
      ownerType: "user",
      sha256: request.sha256,
      storageProvider: "minio",
      visibility: "private",
    } satisfies RitualFileRecord;
    const object = await safe(async () => {
      const result = await fileStorage.storage.getObject?.({
        bucket: record.bucket,
        objectKey: record.objectKey,
        record,
      });
      if (!result) throw new Error();
      return result;
    });
    expect(
      new Uint8Array(await new Response(object.body).arrayBuffer()),
    ).toEqual(bytes);
  });

  it("preserves immutable bundle storage and authorized-reader bytes", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const now = Date.now();
    const operationId = createUuidV7();
    const bundleId = createUuidV7();
    const ritualId = createUuidV7();
    const actorId = createUuidV7();
    const assetKey = createUuidV7();
    const asset = {
      key: assetKey,
      reference: "/pics/local.png",
      sha256: hash(bytes),
      mime: "image/png" as const,
      bytes: bytes.byteLength,
      purpose: "read" as const,
    };
    const location = bundleStorage.locations({
      operationId,
      bundleId,
      ritualId,
      asset,
    });
    const claim: RitualBundlePublicationClaim = {
      operationId,
      actorId,
      bundleId,
      ritualId,
      manifestSha256: hash("local manifest"),
      claimId: createUuidV7(),
      claimStartedAtMs: now - 1_000,
      claimExpiresAtMs: now + 119_000,
      intentExpiresAtMs: now + 86_400_000,
      assets: [
        {
          operationId,
          bundleId,
          ritualId,
          key: assetKey,
          assetIndex: 0,
          reference: asset.reference,
          sha256: asset.sha256,
          mime: asset.mime,
          byteSize: asset.bytes,
          ...location,
        },
      ],
    };
    const receipt = await safe(() =>
      bundleStorage.ensureAsset({ claim, assetKey, bytes }),
    );
    expect(receipt.storageProvider).toBe(
      `minio:${hash(settings.storageEndpoint)}`,
    );
    await expect(
      safe(() => bundleStorage.ensureAsset({ claim, assetKey, bytes })),
    ).resolves.toMatchObject({
      operationId,
      bundleId,
      assetKey,
      storageProvider: receipt.storageProvider,
    });
    const read = await safe(() =>
      bundleStorage.readAsset({
        expectedActorId: actorId,
        operationId,
        ritualId,
        bundleId,
        assetKey,
        manifestSha256: claim.manifestSha256,
        descriptor: {} as never,
        publicationPolicyId: "local-v1",
        sha256: asset.sha256,
        mime: asset.mime,
        byteSize: asset.bytes,
        location: {
          provider: location.storageProvider,
          bucket: location.bucket,
          objectKey: location.objectKey,
        },
        receiptSha256: hash("local receipt"),
      }),
    );
    expect(read).toEqual(bytes);
    read?.fill(0);
  });
});
