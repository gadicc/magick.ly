import "server-only";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  type LoomFileStorageAdapter,
  readLoomFileBodyBytes,
} from "@gadicc/loom/files";
import { createS3FileStorage } from "@gadicc/loom/files/s3";
import { RITUAL_UPLOAD_MAX_BYTES } from "./ritualUploadProtocol";
import { readRitualUploadStorageConfig } from "./ritualUploadRuntime";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function loomBody(body: BodyInit) {
  if (
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  )
    return body;
  throw new TypeError("Unsupported ritual file body");
}

function missing(error: unknown) {
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return (
    value?.$metadata?.httpStatusCode === 404 &&
    (value.name === "NoSuchKey" || value.name === "NotFound")
  );
}

/** Closed read-only Loom S3 adapter for finalized canonical ritual objects. */
export function createRitualFileR2Storage(
  environment: RuntimeEnvironment,
  options: { requestHandler?: S3ClientConfig["requestHandler"] } = {},
) {
  const config = readRitualUploadStorageConfig(environment);
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: config.credentials,
    forcePathStyle: true,
    maxAttempts: 1,
    followRegionRedirects: false,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(options.requestHandler
      ? { requestHandler: options.requestHandler }
      : {}),
  });
  const storage: LoomFileStorageAdapter = {
    provider: "r2",
    bucket: config.bucket,
    async getObject(input) {
      const record = input.record;
      if (
        !record ||
        record.storageProvider !== "r2" ||
        record.bucket !== config.bucket ||
        input.bucket !== config.bucket ||
        input.objectKey !== record.objectKey ||
        !record.objectKey.startsWith(`${config.canonicalPrefix}/`) ||
        record.byteSize < 1 ||
        record.byteSize > RITUAL_UPLOAD_MAX_BYTES
      )
        throw new Error("Ritual file unavailable");
      const signal = AbortSignal.timeout(30_000);
      const adapter = createS3FileStorage({
        provider: "r2",
        bucket: config.bucket,
        commands: { GetObjectCommand, PutObjectCommand },
        client: {
          async send(command) {
            return {
              ...(await client.send(command as GetObjectCommand, {
                abortSignal: signal,
              })),
            };
          },
        },
      });
      try {
        const result = await adapter.getObject?.(input);
        if (!result) return null;
        try {
          const bytes = await readLoomFileBodyBytes(loomBody(result.body), {
            maxBytes: Math.min(record.byteSize, RITUAL_UPLOAD_MAX_BYTES),
          });
          return {
            ...result,
            body: bytes,
            byteSize: result.byteSize ?? bytes.byteLength,
          };
        } finally {
          if (result.body instanceof ReadableStream)
            void result.body.cancel().catch(() => {});
        }
      } catch (error) {
        if (missing(error)) return null;
        throw new Error("Ritual file unavailable");
      }
    },
    async putObject() {
      throw new Error("Generic ritual file writes are disabled");
    },
  };
  return { storage, destroy: () => client.destroy() };
}

let configured: ReturnType<typeof createRitualFileR2Storage> | undefined;

function runtimeStorage() {
  configured ??= createRitualFileR2Storage(process.env);
  return configured.storage;
}

/** Loom manifest entrypoint. Writes remain denied; upload uses its signer/finalizer. */
export const filesStorage: LoomFileStorageAdapter = {
  provider: "r2",
  get bucket() {
    return runtimeStorage().bucket;
  },
  getObject(input) {
    return runtimeStorage().getObject?.(input) ?? Promise.resolve(null);
  },
  async putObject() {
    throw new Error("Generic ritual file writes are disabled");
  },
};
