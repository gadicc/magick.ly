import "server-only";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createS3FileStorage } from "@gadicc/loom/files/s3";
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

/** Read-only Loom S3 adapter closed over one verified legacy R2 bucket. */
export function createLegacyPublicR2Storage(
  input: LegacyPublicR2Config,
  options: { requestHandler?: S3ClientConfig["requestHandler"] } = {},
) {
  const config = configured(input);
  const client = new S3Client({
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
  });
  const storage: LegacyPublicObjectStorage = {
    async read(file, signal) {
      if (
        signal.aborted ||
        file.storageProvider !== "r2" ||
        file.bucket !== config.bucket
      )
        throw new Error("Legacy public file unavailable");
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
  return { storage, destroy: () => client.destroy() };
}
