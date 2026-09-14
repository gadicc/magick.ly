import "server-only";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createS3FileStorage } from "@gadicc/loom/files/s3";
import { LEGACY_FILE_RELOCATION_BUCKET } from "./legacyFileLocation";
import type { LegacyPublicFile } from "./legacyPublicFiles";

export interface LegacyPublicObject {
  body: BodyInit;
  byteSize?: number;
}

export interface LegacyPublicObjectStorage {
  read(
    file: LegacyPublicFile,
    signal: AbortSignal,
  ): Promise<LegacyPublicObject | null>;
}

export interface LegacyPublicR2Config {
  kind: "r2";
  endpoint: string;
  region: string;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function configured(input: LegacyPublicR2Config) {
  if (
    input?.kind !== "r2" ||
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
      input.endpoint,
    ) ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.region) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
    !text(input.credentials?.accessKeyId) ||
    !text(input.credentials?.secretAccessKey)
  )
    throw new Error("Legacy public file storage is not configured");
  return structuredClone(input);
}

export function readLegacyPublicR2Config(
  env: Readonly<Record<string, string | undefined>>,
): LegacyPublicR2Config {
  const value = (key: string) => env[key]?.trim() ?? "";
  const bucket = value("AWS_S3_DEFAULT_BUCKET");
  let endpoint = value("AWS_S3_ENDPOINT_URL");
  try {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (path !== "" && path !== `/${bucket}`)
    )
      throw new Error();
    endpoint = url.origin;
  } catch {
    throw new Error("Legacy public file storage is not configured");
  }
  return configured({
    kind: "r2",
    endpoint,
    region: value("AWS_REGION_APP") || value("AWS_REGION"),
    bucket,
    credentials: {
      accessKeyId: value("AWS_ACCESS_KEY_ID_APP") || value("AWS_ACCESS_KEY_ID"),
      secretAccessKey:
        value("AWS_SECRET_ACCESS_KEY_APP") || value("AWS_SECRET_ACCESS_KEY"),
    },
  });
}

/** Canonical private Files configuration, accepted only for the fixed relocation bucket. */
export function readLegacyRelocationR2Config(
  env: Readonly<Record<string, string | undefined>>,
): LegacyPublicR2Config | null {
  const value = (key: string) => env[key]?.trim() ?? "";
  if (value("FILES_S3_BUCKET") !== LEGACY_FILE_RELOCATION_BUCKET) return null;
  if (
    value("FILES_STORAGE_PROVIDER") !== "cloudflare-r2" ||
    value("FILES_S3_REGION") !== "auto" ||
    value("FILES_S3_FORCE_PATH_STYLE") !== "true" ||
    value("FILES_S3_BUCKET") !== LEGACY_FILE_RELOCATION_BUCKET
  )
    throw new Error("Legacy relocated file storage is not configured");
  try {
    return configured({
      kind: "r2",
      endpoint: value("FILES_S3_ENDPOINT"),
      region: "auto",
      bucket: value("FILES_S3_BUCKET"),
      credentials: {
        accessKeyId: value("FILES_S3_ACCESS_KEY_ID"),
        secretAccessKey: value("FILES_S3_SECRET_ACCESS_KEY"),
      },
    });
  } catch {
    throw new Error("Legacy relocated file storage is not configured");
  }
}

/**
 * Builds the closed set of configured legacy locations. Either credential
 * family may be absent so a completed relocation can retire the old one.
 */
export function readLegacyPublicR2StorageConfigs(
  env: Readonly<Record<string, string | undefined>>,
) {
  const configs: LegacyPublicR2Config[] = [];
  if (env.AWS_S3_ENDPOINT_URL?.trim() || env.AWS_S3_DEFAULT_BUCKET?.trim())
    configs.push(readLegacyPublicR2Config(env));
  const relocation = readLegacyRelocationR2Config(env);
  if (relocation) configs.push(relocation);
  if (!configs.length)
    throw new Error("Legacy public file storage is not configured");
  return configs;
}

function missing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.$metadata?.httpStatusCode === 404 &&
    (value.name === "NoSuchKey" || value.name === "NotFound")
  );
}

/** Read-only Loom S3 adapter closed over the configured legacy source set. */
export function createLegacyPublicR2Storage(
  input: LegacyPublicR2Config | readonly LegacyPublicR2Config[],
  options: { requestHandler?: S3ClientConfig["requestHandler"] } = {},
) {
  const supplied = Array.isArray(input) ? input : [input];
  if (supplied.length < 1 || supplied.length > 2)
    throw new Error("Legacy public file storage is not configured");
  const configs = supplied.map((value) => configured(value));
  if (new Set(configs.map((config) => config.bucket)).size !== configs.length)
    throw new Error("Legacy public file storage is not configured");
  const providers = configs.map((config) => ({
    config,
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      followRegionRedirects: false,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      ...(options.requestHandler
        ? { requestHandler: options.requestHandler }
        : {}),
    }),
  }));
  const storage: LegacyPublicObjectStorage = {
    async read(file, signal) {
      const provider = providers.find(
        ({ config }) =>
          file.storageProvider === "r2" && file.bucket === config.bucket,
      );
      if (signal.aborted || !provider)
        throw new Error("Legacy public file unavailable");
      const { client, config } = provider;
      const adapter = createS3FileStorage({
        provider: "r2",
        bucket: config.bucket,
        commands: { GetObjectCommand, PutObjectCommand },
        client: {
          async send(command) {
            const active = AbortSignal.any([
              signal,
              AbortSignal.timeout(30_000),
            ]);
            return {
              ...(await client.send(command as GetObjectCommand, {
                abortSignal: active,
              })),
            };
          },
        },
      });
      try {
        const result = await adapter.getObject?.({
          bucket: file.bucket,
          objectKey: file.objectKey,
        });
        return result ? { body: result.body, byteSize: result.byteSize } : null;
      } catch (error) {
        if (missing(error)) return null;
        throw new Error("Legacy public file unavailable");
      }
    },
  };
  return {
    storage,
    destroy: () => {
      for (const { client } of providers) client.destroy();
    },
  };
}
