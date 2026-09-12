import "server-only";

import { Readable } from "node:stream";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  LoomFileDuplicateError,
  type LoomFileStorageAdapter,
  readLoomFileBodyBytes,
  sha256Hex,
} from "@gadicc/loom/files";
import { createS3FileStorage } from "@gadicc/loom/files/s3";
import type {
  RitualStagingObject,
  RitualUploadClaim,
  RitualUploadLocation,
  RitualUploadStorage,
} from "./ritualUploadContracts";
import {
  type DirectRitualUpload,
  type InitiateRitualUpload,
  isCanonicalUploadId,
  parseInitiateRitualUpload,
  RitualUploadError,
} from "./ritualUploadProtocol";

/** Explicit server configuration; presence alone does not prove bucket privacy or CORS. */
export interface R2RitualStorageConfig {
  kind: "r2";
  /** Standard account HTTPS origin only; legacy endpoint/key normalization is separate. */
  endpoint: string;
  bucket: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
  };
  stagingPrefix: string;
  canonicalPrefix: string;
}
/** Structural subset of the SQL RitualUploadIntentDescriptor, including its issued capability bound. */
export type R2RitualStorageIntent = Pick<
  RitualUploadClaim,
  | "request"
  | "fileId"
  | "attachmentId"
  | "staging"
  | "canonical"
  | "intentExpiresAtMs"
> & { capabilityExpiresAtMs: number };
/** Locations are computed synchronously inside SQL initiation, then persisted unchanged. */
export interface R2RitualStorage {
  locations(input: {
    request: InitiateRitualUpload;
    fileId: string;
    attachmentId: string;
  }): {
    staging: RitualUploadLocation;
    canonical: RitualUploadLocation;
  };
  directUpload(
    intent: R2RitualStorageIntent,
    signal: AbortSignal,
  ): Promise<DirectRitualUpload>;
  storage: RitualUploadStorage;
  destroy(): void;
}

function fail(code: ConstructorParameters<typeof RitualUploadError>[0]): never {
  throw new RitualUploadError(code);
}
const instant = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !value.includes("\0");
function configured(input: R2RitualStorageConfig): R2RitualStorageConfig {
  const namespace = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;
  if (
    !input ||
    input.kind !== "r2" ||
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
      input.endpoint,
    ) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
    !namespace.test(input.stagingPrefix) ||
    !namespace.test(input.canonicalPrefix) ||
    input.stagingPrefix.length > 512 ||
    input.canonicalPrefix.length > 512 ||
    input.stagingPrefix === input.canonicalPrefix ||
    input.stagingPrefix.startsWith(`${input.canonicalPrefix}/`) ||
    input.canonicalPrefix.startsWith(`${input.stagingPrefix}/`) ||
    !input.credentials ||
    !text(input.credentials.accessKeyId) ||
    !text(input.credentials.secretAccessKey) ||
    (input.credentials.sessionToken !== undefined &&
      !text(input.credentials.sessionToken)) ||
    (input.credentials.expiration !== undefined &&
      (!(input.credentials.expiration instanceof Date) ||
        !instant(input.credentials.expiration.getTime())))
  )
    throw new Error("Invalid R2 ritual storage configuration");
  return {
    kind: "r2",
    endpoint: input.endpoint,
    bucket: input.bucket,
    stagingPrefix: input.stagingPrefix,
    canonicalPrefix: input.canonicalPrefix,
    credentials: {
      ...input.credentials,
      ...(input.credentials.expiration
        ? { expiration: new Date(input.credentials.expiration) }
        : {}),
    },
  };
}
function destroyBody(body: unknown, error?: Error) {
  if (body instanceof Readable) {
    body.on("error", () => {});
    body.destroy(error);
  }
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
function scope(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const error = () => new RitualUploadError(timedOut ? "TIMEOUT" : "ABORTED");
  const abort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  if (parent.aborted) abort();
  else parent.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    error,
    wait<T>(promise: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(error());
        promise
          .then(resolve, reject)
          .finally(() =>
            controller.signal.removeEventListener("abort", onAbort),
          );
        if (controller.signal.aborted) onAbort();
        else
          controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}
const provenance = (claim: Pick<RitualUploadClaim, "request" | "fileId">) => ({
  sha256: claim.request.sha256,
  "magickli-operation-id": claim.request.operationId,
  "magickli-file-id": claim.fileId,
});
function matchesObject(
  response: GetObjectCommandOutput,
  claim: RitualUploadClaim,
) {
  return (
    response.ContentLength === claim.request.byteSize &&
    response.ContentType === claim.request.contentType &&
    Object.entries(provenance(claim)).every(
      ([key, value]) => response.Metadata?.[key] === value,
    )
  );
}

/**
 * Closed R2 implementation using Loom's conditional storage. Performs no env
 * discovery, provisioning, policy changes, public URL generation or CopyObject.
 * Caller owns SQL authorization; only its persisted descriptor may be signed.
 */
export function createR2RitualStorage(
  input: R2RitualStorageConfig,
  options: {
    /** SDK HTTP transport injection for providerless tests. Signing never calls it. */
    requestHandler?: S3ClientConfig["requestHandler"];
    ioTimeoutMs?: number;
  } = {},
): R2RitualStorage {
  const config = configured(input);
  const timeoutMs = options.ioTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new Error("Invalid storage timeout");
  const sdk: S3ClientConfig = {
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
  };
  const client = new S3Client(sdk);
  // Provider clock-skew retries must never mutate the signing clock/configuration.
  const signer = new S3Client(sdk);
  const lifetime = new AbortController();
  const signalOf = (signal: AbortSignal) =>
    AbortSignal.any([signal, lifetime.signal]);
  const locations: R2RitualStorage["locations"] = ({
    request,
    fileId,
    attachmentId,
  }) => {
    if (
      !parseInitiateRitualUpload(request) ||
      !isCanonicalUploadId(fileId) ||
      !isCanonicalUploadId(attachmentId)
    )
      fail("INVALID_REQUEST");
    return {
      staging: {
        provider: "r2",
        bucket: config.bucket,
        objectKey: `${config.stagingPrefix}/${request.operationId}`,
      },
      canonical: {
        provider: "r2",
        bucket: config.bucket,
        objectKey: `${config.canonicalPrefix}/${fileId}/${request.sha256}`,
      },
    };
  };
  function snapshot<
    T extends Omit<R2RitualStorageIntent, "capabilityExpiresAtMs">,
  >(value: T) {
    const request = parseInitiateRitualUpload(value.request);
    if (!request) fail("INVALID_REQUEST");
    const expected = locations(value);
    for (const key of ["staging", "canonical"] as const) {
      const a = value[key],
        b = expected[key];
      if (
        !a ||
        a.provider !== b.provider ||
        a.bucket !== b.bucket ||
        a.objectKey !== b.objectKey
      )
        fail("UNAVAILABLE");
    }
    const result = {
      request,
      fileId: value.fileId,
      attachmentId: value.attachmentId,
      ...expected,
      intentExpiresAtMs: value.intentExpiresAtMs,
    };
    if (!instant(result.intentExpiresAtMs)) fail("UNAVAILABLE");
    if (result.intentExpiresAtMs <= Date.now()) fail("EXPIRED");
    return result;
  }
  function assertClaim(claim: RitualUploadClaim) {
    if (!isCanonicalUploadId(claim.claimId) || !instant(claim.claimExpiresAtMs))
      fail("UNAVAILABLE");
    if (Math.min(claim.intentExpiresAtMs, claim.claimExpiresAtMs) <= Date.now())
      fail("EXPIRED");
  }
  function snapshotClaim(value: RitualUploadClaim): RitualUploadClaim {
    const claim = {
      ...snapshot(value),
      claimId: value.claimId,
      claimExpiresAtMs: value.claimExpiresAtMs,
    };
    assertClaim(claim);
    return claim;
  }
  async function read(
    location: RitualUploadLocation,
    signal: AbortSignal,
  ): Promise<
    (RitualStagingObject & { response: GetObjectCommandOutput }) | null
  > {
    if (signal.aborted) fail("ABORTED");
    const active = scope(signal, timeoutMs);
    let response: GetObjectCommandOutput | undefined;
    try {
      const received = await active.wait(
        client
          .send(
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: location.objectKey,
            }),
            { abortSignal: active.signal },
          )
          .then((value) => {
            response = value;
            if (active.signal.aborted) destroyBody(value.Body);
            return value;
          }),
      );
      if (active.signal.aborted) throw active.error();
      if (!(received.Body instanceof Readable)) fail("UNAVAILABLE");
      const body = received.Body;
      const finish = () => {
        active.signal.removeEventListener("abort", aborted);
        active.dispose();
      };
      const close = () => {
        body.destroy();
        finish();
      };
      const aborted = () => {
        destroyBody(body, active.error());
        finish();
      };
      active.signal.addEventListener("abort", aborted, { once: true });
      body.once("end", finish);
      body.once("error", finish);
      return {
        body: Readable.toWeb(body) as ReadableStream<Uint8Array>,
        byteSize: received.ContentLength,
        close,
        response: received,
      };
    } catch (error) {
      destroyBody(response?.Body);
      active.dispose();
      if (active.signal.aborted) throw active.error();
      if (missing(error)) return null;
      if (error instanceof RitualUploadError) throw error;
      return fail("UNAVAILABLE");
    }
  }
  return {
    locations,
    async directUpload(value, parent) {
      const intent = snapshot(value),
        capabilityExpiresAtMs = value.capabilityExpiresAtMs;
      if (!instant(capabilityExpiresAtMs)) fail("UNAVAILABLE");
      const signal = signalOf(parent);
      if (signal.aborted) fail("ABORTED");
      const expiry = Math.min(
        intent.intentExpiresAtMs,
        capabilityExpiresAtMs,
        config.credentials.expiration?.getTime() ?? Number.POSITIVE_INFINITY,
      );
      const started = Date.now();
      const seconds = Math.min(600, Math.floor((expiry - started) / 1000));
      if (seconds < 1) fail("EXPIRED");
      const active = scope(signal, timeoutMs);
      const metadata = provenance(intent);
      const headers = {
        "content-type": intent.request.contentType,
        "x-amz-checksum-sha256": Buffer.from(
          intent.request.sha256,
          "hex",
        ).toString("base64"),
        "if-none-match": "*",
        ...Object.fromEntries(
          Object.entries(metadata).map(([key, v]) => [`x-amz-meta-${key}`, v]),
        ),
      };
      try {
        // R2 drops query-hoisted metadata: every provenance/checksum field must
        // remain in signed request headers. Browser controls Content-Length.
        const url = await active.wait(
          getSignedUrl(
            signer,
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: intent.staging.objectKey,
              ContentLength: intent.request.byteSize,
              ContentType: intent.request.contentType,
              ChecksumSHA256: headers["x-amz-checksum-sha256"],
              IfNoneMatch: "*",
              Metadata: metadata,
            }),
            {
              expiresIn: seconds,
              signingDate: new Date(started),
              signableHeaders: new Set([
                "content-length",
                ...Object.keys(headers),
              ]),
              unhoistableHeaders: new Set(Object.keys(headers)),
            },
          ),
        );
        const expiresAtMs = Math.floor(started / 1000) * 1000 + seconds * 1000;
        if (expiresAtMs <= Date.now()) fail("EXPIRED");
        return { kind: "presigned-put", url, headers, expiresAtMs };
      } catch (error) {
        if (active.signal.aborted) throw active.error();
        if (error instanceof RitualUploadError) throw error;
        return fail("UNAVAILABLE");
      } finally {
        active.dispose();
      }
    },
    storage: {
      async readStaging(value, parent) {
        const claim = snapshotClaim(value);
        const object = await read(claim.staging, signalOf(parent));
        if (!object) return null;
        if (!matchesObject(object.response, claim)) {
          object.close();
          fail("UNAVAILABLE");
        }
        return {
          body: object.body,
          byteSize: object.byteSize,
          close: object.close,
        };
      },
      canonicalStorage(value, parent): LoomFileStorageAdapter {
        const claim = snapshotClaim(value),
          signal = signalOf(parent);
        return {
          provider: "r2",
          bucket: config.bucket,
          async putObject(value) {
            assertClaim(claim);
            if (signal.aborted) fail("ABORTED");
            if (
              value.objectKey !== claim.canonical.objectKey ||
              value.sha256 !== claim.request.sha256 ||
              value.byteSize !== claim.request.byteSize ||
              value.body.byteLength !== value.byteSize ||
              value.detectedContentType !== claim.request.contentType
            )
              fail("UNAVAILABLE");
            // The verified finalizer buffer may be caller-owned; snapshot it before
            // asynchronous transport so an in-flight mutation cannot change bytes.
            const put = {
              ...value,
              body: new Uint8Array(value.body),
              metadata: provenance(claim),
            };
            const active = scope(signal, timeoutMs);
            const shared = createS3FileStorage({
              bucket: config.bucket,
              provider: "r2",
              preventOverwrite: true,
              commands: { GetObjectCommand, PutObjectCommand },
              client: {
                async send(command) {
                  // Loom putObject issues this constructor; no copy/delete command is exposed.
                  const scoped = new PutObjectCommand({
                    ...(command as PutObjectCommand).input,
                    ChecksumSHA256: Buffer.from(
                      claim.request.sha256,
                      "hex",
                    ).toString("base64"),
                    Metadata: provenance(claim),
                  });
                  return {
                    ...(await active.wait(
                      client.send(scoped, { abortSignal: active.signal }),
                    )),
                  };
                },
              },
            });
            try {
              return await shared.putObject(put);
            } catch (error) {
              if (active.signal.aborted) throw active.error();
              if (!(error instanceof LoomFileDuplicateError)) {
                if (error instanceof RitualUploadError) throw error;
                return fail("UNAVAILABLE");
              }
              assertClaim(claim);
              const existing = await read(claim.canonical, active.signal);
              if (!existing) fail("UNAVAILABLE");
              try {
                if (!matchesObject(existing.response, claim)) fail("DUPLICATE");
                const bytes = await active.wait(
                  readLoomFileBodyBytes(existing.body, {
                    maxBytes: claim.request.byteSize,
                  }),
                );
                if (
                  bytes.byteLength !== claim.request.byteSize ||
                  (await active.wait(sha256Hex(bytes))) !== claim.request.sha256
                )
                  fail("DUPLICATE");
                return {
                  bucket: config.bucket,
                  objectKey: claim.canonical.objectKey,
                  storageProvider: "r2",
                };
              } catch (error) {
                if (active.signal.aborted) throw active.error();
                if (error instanceof RitualUploadError) throw error;
                return fail("UNAVAILABLE");
              } finally {
                existing.close();
              }
            } finally {
              active.dispose();
            }
          },
        };
      },
    },
    destroy() {
      lifetime.abort();
      client.destroy();
      signer.destroy();
    },
  };
}
