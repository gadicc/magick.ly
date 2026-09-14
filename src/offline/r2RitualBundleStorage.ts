import "server-only";

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { LoomFileDuplicateError } from "@gadicc/loom/files";
import { createS3FileStorage } from "@gadicc/loom/files/s3";
import { isUuidV7 } from "../lib/ids";
import {
  RITUAL_BUNDLE_MANIFEST_LIMITS,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";
import {
  RITUAL_BUNDLE_LOCATION_LIMITS,
  RITUAL_BUNDLE_PUBLICATION_LIMITS,
  type RitualBundleAssetReservation,
  type RitualBundleLocation,
  type RitualBundlePublicationClaim,
  type RitualBundleStorageReceiptV1,
} from "./ritualBundlePublication";
import type { SqlRitualBundleAsset } from "./sqlRitualBundleReads";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0) &&
  value <= 8_640_000_000_000_000;
const text = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxBytes &&
  value.isWellFormed() &&
  !value.includes("\0") &&
  Buffer.byteLength(value) <= maxBytes;
const namespace = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 512 &&
  /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/.test(value);
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const MAX_OPERATIONS = 4;
const MAX_IO_MS = 30_000;
const MAX_ERROR_BYTES = 4096;

/** Explicit server-only configuration; this does not establish bucket privacy. */
export interface R2RitualBundleStorageConfig {
  kind: "r2";
  /** Standard account HTTPS origin, with no bucket path or ambient discovery. */
  endpoint: string;
  bucket: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
  };
  bundlePrefix: string;
  /** Other configured namespaces in this bucket; empty only for a dedicated configuration. */
  reservedPrefixes: readonly string[];
}
export interface MinioRitualBundleStorageConfig
  extends Omit<R2RitualBundleStorageConfig, "kind"> {
  kind: "minio";
}

/** Safe diagnostics; no provider response, credentials, references or image bytes. */
export class R2RitualBundleStorageError extends Error {
  constructor(
    readonly code:
      | "INVALID_CONFIGURATION"
      | "INVALID_REQUEST"
      | "BUSY"
      | "EXPIRED"
      | "ABORTED"
      | "TIMEOUT"
      | "MISSING_BYTES"
      | "OBJECT_MISMATCH"
      | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "R2RitualBundleStorageError";
  }
}
function fail(code: R2RitualBundleStorageError["code"]): never {
  throw new R2RitualBundleStorageError(code);
}

/** Private locations and receipts only; no public URLs, presigning, copying or deletion. */
export interface R2RitualBundleStorage {
  locations(input: {
    operationId: string;
    bundleId: string;
    ritualId: string;
    asset: RitualBundleManifestV1["assets"][number];
  }): RitualBundleLocation;
  /**
   * Accept only a persisted SQL claim and bytes from its trusted owned preparation.
   * A missing object requires bytes; an existing owned object can be reverified
   * without them. Current authorization and SQL publication remain with the caller.
   */
  ensureAsset(
    input: {
      claim: RitualBundlePublicationClaim;
      assetKey: string;
      bytes?: Uint8Array;
    },
    signal?: AbortSignal,
  ): Promise<RitualBundleStorageReceiptV1>;
  /**
   * Server-only lookup snapshot, never authority by itself. Caller must recheck
   * the complete SQL binding after I/O before exposing bytes, and owns wiping
   * returned bytes. Null means a genuine absent object, not revoked permission.
   */
  readAsset(
    descriptor: SqlRitualBundleAsset,
    signal?: AbortSignal,
  ): Promise<Uint8Array | null>;
  destroy(): void;
}
export type MinioRitualBundleStorage = R2RitualBundleStorage;
export type RitualBundleStorage = R2RitualBundleStorage;

function configured(
  input: R2RitualBundleStorageConfig | MinioRitualBundleStorageConfig,
) {
  try {
    const endpoint = new URL(input.endpoint);
    const validEndpoint =
      input.kind === "r2"
        ? /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
            input.endpoint,
          )
        : input.kind === "minio" &&
          endpoint.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
          Boolean(endpoint.port) &&
          input.endpoint === endpoint.origin;
    if (
      !input ||
      (input.kind !== "r2" && input.kind !== "minio") ||
      typeof input.endpoint !== "string" ||
      !validEndpoint ||
      typeof input.bucket !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
      !namespace(input.bundlePrefix) ||
      !Array.isArray(input.reservedPrefixes) ||
      input.reservedPrefixes.length > 32 ||
      Array.from(input.reservedPrefixes).some(
        (prefix) => !namespace(prefix) || overlaps(input.bundlePrefix, prefix),
      ) ||
      !input.credentials ||
      !text(input.credentials.accessKeyId, 8192) ||
      !text(input.credentials.secretAccessKey, 8192) ||
      (input.credentials.sessionToken !== undefined &&
        !text(input.credentials.sessionToken, 8192)) ||
      (input.credentials.expiration !== undefined &&
        (!(input.credentials.expiration instanceof Date) ||
          !instant(input.credentials.expiration.getTime())))
    )
      fail("INVALID_CONFIGURATION");
    return {
      kind: input.kind,
      endpoint: input.endpoint,
      bucket: input.bucket,
      bundlePrefix: input.bundlePrefix,
      provider: `${input.kind}:${hash(input.endpoint)}`,
      credentials: {
        accessKeyId: input.credentials.accessKeyId,
        secretAccessKey: input.credentials.secretAccessKey,
        ...(input.credentials.sessionToken === undefined
          ? {}
          : { sessionToken: input.credentials.sessionToken }),
        ...(input.credentials.expiration === undefined
          ? {}
          : { expiration: new Date(input.credentials.expiration) }),
      },
    };
  } catch {
    return fail("INVALID_CONFIGURATION");
  }
}

function close(body: unknown) {
  if (body instanceof Readable) {
    body.on("error", () => {});
    body.destroy();
  }
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
function image(mime: unknown, bytes: unknown) {
  return (
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes > 0 &&
    (mime === "image/svg+xml"
      ? bytes <= RITUAL_BUNDLE_MANIFEST_LIMITS.svgBytes
      : ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          mime as string,
        ) && bytes <= RITUAL_BUNDLE_MANIFEST_LIMITS.rasterBytes)
  );
}

/** One pre-bounded buffer; closes the SDK body on success, failure or cancellation. */
async function collect(body: unknown, maxBytes: number, signal: AbortSignal) {
  if (!(body instanceof Readable)) fail("UNAVAILABLE");
  const aborted = () => close(body);
  let buffer: Uint8Array | undefined;
  signal.addEventListener("abort", aborted, { once: true });
  try {
    if (signal.aborted) fail("ABORTED");
    buffer = new Uint8Array(maxBytes);
    let offset = 0;
    for await (const chunk of body) {
      if (signal.aborted) fail("ABORTED");
      if (!(chunk instanceof Uint8Array) || chunk.length > maxBytes - offset)
        fail("OBJECT_MISMATCH");
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    if (signal.aborted) fail("ABORTED");
    const result = buffer.subarray(0, offset);
    buffer = undefined;
    return result;
  } finally {
    buffer?.fill(0);
    signal.removeEventListener("abort", aborted);
    close(body);
  }
}

/**
 * Inactive app-owned R2 storage. SQL reserves every destination before this runs
 * and rechecks grants/selection/claim after provider I/O. Byte identity never
 * grants access. Unknown writes retain their exact key for later reconciliation.
 * Bounds cover owned captures and pending operations, not total SDK/process RSS.
 */
function createS3RitualBundleStorage(
  input: R2RitualBundleStorageConfig | MinioRitualBundleStorageConfig,
  options: {
    /** Only tighten the per-asset transport budget; claim/credential expiry clips it further. */
    ioTimeoutMs?: number;
    /** Real SDK transport seam for providerless tests. No arbitrary URL resolver. */
    requestHandler?: S3ClientConfig["requestHandler"];
    now?: () => number;
  } = {},
): R2RitualBundleStorage {
  const config = configured(input);
  const timeoutMs = options.ioTimeoutMs ?? MAX_IO_MS;
  const requestHandler = options.requestHandler;
  const clock = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_IO_MS ||
    typeof clock !== "function"
  )
    fail("INVALID_CONFIGURATION");
  const lifetime = new AbortController();
  const running = new Set<{ client: S3Client }>();
  const now = () => {
    const value = clock();
    if (!instant(value)) fail("UNAVAILABLE");
    return value;
  };
  const locations: R2RitualBundleStorage["locations"] = ({
    operationId,
    bundleId,
    ritualId,
    asset,
  }) => {
    if (
      !id(operationId) ||
      !id(bundleId) ||
      !id(ritualId) ||
      !asset ||
      !id(asset.key) ||
      asset.key === bundleId ||
      asset.purpose !== "read" ||
      !digest(asset.sha256) ||
      !image(asset.mime, asset.bytes)
    )
      fail("INVALID_REQUEST");
    const objectKey = `${config.bundlePrefix}/${bundleId}/${asset.key}`;
    if (Buffer.byteLength(objectKey) > RITUAL_BUNDLE_LOCATION_LIMITS.objectKey)
      fail("INVALID_CONFIGURATION");
    return {
      storageProvider: config.provider,
      bucket: config.bucket,
      objectKey,
    };
  };

  type Binding = {
    operationId: string;
    bundleId: string;
    ritualId: string;
    assetKey: string;
    manifestSha256: string;
    sha256: string;
    mime: RitualBundleManifestV1["assets"][number]["mime"];
    byteSize: number;
    location: RitualBundleLocation;
  };
  function validateBinding(value: Binding) {
    if (
      ![
        value.operationId,
        value.bundleId,
        value.ritualId,
        value.assetKey,
      ].every(id) ||
      !digest(value.manifestSha256) ||
      !digest(value.sha256) ||
      !image(value.mime, value.byteSize)
    )
      fail("INVALID_REQUEST");
    const expected = locations({
      ...value,
      asset: {
        key: value.assetKey,
        reference: "",
        sha256: value.sha256,
        mime: value.mime,
        bytes: value.byteSize,
        purpose: "read",
      },
    });
    if (
      !value.location ||
      value.location.storageProvider !== expected.storageProvider ||
      value.location.bucket !== expected.bucket ||
      value.location.objectKey !== expected.objectKey
    )
      fail("INVALID_REQUEST");
  }

  // Each active or unsettled operation keeps a slot. Four retained PUT snapshots
  // are at most 80 MiB per instance; GET captures/preparations/SDK memory coexist.
  async function transfer(
    binding: Binding,
    caller: AbortSignal,
    mode: { write: boolean; notBeforeMs: number; expiresAtMs: number },
    inputBytes?: Uint8Array,
  ): Promise<{ bytes: Uint8Array; verifiedAtMs: number } | null> {
    let ownedBytes = inputBytes,
      resultBytes: Uint8Array | undefined;
    let client: S3Client | undefined;
    let operation: { client: S3Client } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new AbortController();
    const signal = AbortSignal.any([caller, lifetime.signal, deadline.signal]);
    const pending = new Set<Promise<unknown>>();
    let finished = false,
      expired = false,
      timedOut = false;
    let started = 0,
      elapsedStart = 0,
      expires = Infinity,
      budget = 0;
    function check() {
      if (caller.aborted || lifetime.signal.aborted) fail("ABORTED");
      const time = now();
      if (expired || time < mode.notBeforeMs || time >= expires)
        fail("EXPIRED");
      if (timedOut || performance.now() - elapsedStart >= budget)
        fail("TIMEOUT");
      if (signal.aborted) fail("ABORTED");
    }
    function wait<T>(promise: Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        const abort = () => {
          try {
            check();
          } catch (error) {
            reject(error);
            return;
          }
          reject(new R2RitualBundleStorageError("ABORTED"));
        };
        promise
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    function track<T>(promise: Promise<T>) {
      pending.add(promise);
      const settled = () => {
        pending.delete(promise);
        if (finished && pending.size === 0 && operation)
          running.delete(operation);
      };
      promise.then(settled, settled);
      return promise;
    }
    const metadata = {
      "magickli-profile": "magickli-ritual-bundle-object-v1",
      "magickli-operation-id": binding.operationId,
      "magickli-bundle-id": binding.bundleId,
      "magickli-ritual-id": binding.ritualId,
      "magickli-asset-id": binding.assetKey,
      "magickli-manifest-sha256": binding.manifestSha256,
      sha256: binding.sha256,
    };
    async function verify(): Promise<Uint8Array | null> {
      check();
      let body: unknown, bytes: Uint8Array | undefined;
      try {
        let response: GetObjectCommandOutput;
        try {
          response = await wait(
            track(
              client!
                .send(
                  new GetObjectCommand({
                    Bucket: config.bucket,
                    Key: binding.location.objectKey,
                  }),
                  { abortSignal: signal },
                )
                .then((result) => {
                  body = result.Body;
                  if (finished || signal.aborted) close(body);
                  return result;
                }),
            ),
          );
        } catch (error) {
          check();
          if (missing(error)) return null;
          throw error;
        }
        check();
        if (
          response.ContentLength !== binding.byteSize ||
          response.ContentType !== binding.mime ||
          (response.ContentEncoding &&
            response.ContentEncoding !== "identity") ||
          Object.entries(metadata).some(
            ([key, expected]) => response.Metadata?.[key] !== expected,
          )
        )
          fail("OBJECT_MISMATCH");
        const captured = await wait(
          track(
            collect(body, binding.byteSize, signal).then((result) => {
              if (finished || signal.aborted) result.fill(0);
              else bytes = result;
              return result;
            }),
          ),
        );
        check();
        if (
          captured.length !== binding.byteSize ||
          hash(captured) !== binding.sha256
        )
          fail("OBJECT_MISMATCH");
        check();
        bytes = undefined;
        return captured;
      } finally {
        close(body);
        bytes?.fill(0);
      }
    }
    try {
      if (caller.aborted || lifetime.signal.aborted) fail("ABORTED");
      if (running.size >= MAX_OPERATIONS) fail("BUSY");
      started = now();
      expires = Math.min(
        mode.expiresAtMs,
        config.credentials.expiration?.getTime() ?? Infinity,
      );
      if (started < mode.notBeforeMs || started >= expires) fail("EXPIRED");
      elapsedStart = performance.now();
      budget = Math.min(timeoutMs, expires - started);
      client = new S3Client({
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
        // SDK error XML is consumed before send() resolves, so it needs its own bound.
        streamCollector: async (body) => {
          try {
            return await collect(body, MAX_ERROR_BYTES, signal);
          } catch {
            check();
            return fail("UNAVAILABLE");
          }
        },
        ...(requestHandler
          ? { requestHandler }
          : config.kind === "minio"
            ? // A 412 closes MinIO's socket; immutable-object recheck needs a new one.
              { requestHandler: { httpAgent: { keepAlive: false } } }
            : {}),
      });
      operation = { client };
      running.add(operation);
      timer = setTimeout(
        () => {
          expired = expires - started <= timeoutMs;
          timedOut = !expired;
          deadline.abort();
        },
        Math.max(0, budget - (performance.now() - elapsedStart)),
      );
      resultBytes = (await verify()) ?? undefined;
      if (!resultBytes) {
        if (!mode.write) return null;
        if (!ownedBytes) fail("MISSING_BYTES");
        check();
        const shared = createS3FileStorage({
          bucket: config.bucket,
          provider: config.provider,
          preventOverwrite: true,
          commands: { GetObjectCommand, PutObjectCommand },
          client: {
            send(command) {
              const wire = new PutObjectCommand({
                ...(command as PutObjectCommand).input,
                ChecksumSHA256: Buffer.from(binding.sha256, "hex").toString(
                  "base64",
                ),
                Metadata: metadata,
              });
              const bytes = ownedBytes!;
              const sent = track(client!.send(wire, { abortSignal: signal }));
              // Transport retains these bytes beyond an outer abort/timeout race.
              // Only actual send settlement transfers cleanup back to us.
              ownedBytes = undefined;
              sent.then(
                () => bytes.fill(0),
                () => bytes.fill(0),
              );
              return wait(sent).then((result) => ({ ...result }));
            },
          },
        });
        try {
          await shared.putObject({
            body: ownedBytes,
            objectKey: binding.location.objectKey,
            sha256: binding.sha256,
            byteSize: binding.byteSize,
            detectedContentType: binding.mime,
            contentType: binding.mime,
            metadata,
          });
        } catch (error) {
          check();
          if (!(error instanceof LoomFileDuplicateError)) throw error;
        }
        check();
        resultBytes = (await verify()) ?? undefined;
        if (!resultBytes) fail("UNAVAILABLE");
      }
      check();
      const verifiedAtMs = now();
      if (verifiedAtMs < mode.notBeforeMs || verifiedAtMs >= expires)
        fail("EXPIRED");
      const result = { bytes: resultBytes, verifiedAtMs };
      resultBytes = undefined;
      return result;
    } catch (error) {
      // Check the deadline only after it is initialized; invalid startup failures
      // must not be reclassified as timeouts because the initial budget is zero.
      if (budget > 0) check();
      if (error instanceof R2RitualBundleStorageError) throw error;
      return fail("UNAVAILABLE");
    } finally {
      finished = true;
      clearTimeout(timer);
      deadline.abort();
      client?.destroy();
      if (pending.size === 0 && operation) running.delete(operation);
      ownedBytes?.fill(0);
      resultBytes?.fill(0);
    }
  }

  return {
    locations,
    async ensureAsset(value, caller = new AbortController().signal) {
      let ownedBytes: Uint8Array | undefined;
      try {
        if (caller.aborted || lifetime.signal.aborted) fail("ABORTED");
        if (running.size >= MAX_OPERATIONS) fail("BUSY");
        const claim = structuredClone(value.claim),
          assetKey = value.assetKey;
        if (
          !claim ||
          ![
            claim.operationId,
            claim.actorId,
            claim.bundleId,
            claim.ritualId,
            claim.claimId,
            assetKey,
          ].every(id) ||
          !digest(claim.manifestSha256) ||
          !instant(claim.claimStartedAtMs) ||
          !instant(claim.claimExpiresAtMs) ||
          !instant(claim.intentExpiresAtMs) ||
          claim.claimExpiresAtMs <= claim.claimStartedAtMs ||
          claim.claimExpiresAtMs - claim.claimStartedAtMs >
            RITUAL_BUNDLE_PUBLICATION_LIMITS.claimMs ||
          claim.claimExpiresAtMs > claim.intentExpiresAtMs ||
          !Array.isArray(claim.assets) ||
          claim.assets.length > RITUAL_BUNDLE_MANIFEST_LIMITS.assets
        )
          fail("INVALID_REQUEST");
        const matches = claim.assets.filter((row) => row?.key === assetKey);
        if (matches.length !== 1) fail("INVALID_REQUEST");
        const asset: RitualBundleAssetReservation = matches[0];
        if (
          asset.operationId !== claim.operationId ||
          asset.bundleId !== claim.bundleId ||
          asset.ritualId !== claim.ritualId ||
          !Number.isSafeInteger(asset.assetIndex) ||
          asset.assetIndex < 0 ||
          asset.assetIndex >= claim.assets.length ||
          claim.assets[asset.assetIndex].key !== asset.key ||
          !text(
            asset.reference,
            RITUAL_BUNDLE_MANIFEST_LIMITS.referenceBytes,
          ) ||
          asset.reference.includes("#")
        )
          fail("INVALID_REQUEST");
        const binding: Binding = {
          operationId: claim.operationId,
          bundleId: claim.bundleId,
          ritualId: claim.ritualId,
          assetKey,
          manifestSha256: claim.manifestSha256,
          sha256: asset.sha256,
          mime: asset.mime,
          byteSize: asset.byteSize,
          location: {
            storageProvider: asset.storageProvider,
            bucket: asset.bucket,
            objectKey: asset.objectKey,
          },
        };
        validateBinding(binding);
        if (value.bytes !== undefined) {
          if (
            !(value.bytes instanceof Uint8Array) ||
            value.bytes.length !== asset.byteSize
          )
            fail("OBJECT_MISMATCH");
          ownedBytes = Uint8Array.from(value.bytes);
          if (hash(ownedBytes) !== asset.sha256) fail("OBJECT_MISMATCH");
        }
        const captured = ownedBytes;
        ownedBytes = undefined;
        const result = await transfer(
          binding,
          caller,
          {
            write: true,
            notBeforeMs: claim.claimStartedAtMs,
            expiresAtMs: Math.min(
              claim.claimExpiresAtMs,
              claim.intentExpiresAtMs,
            ),
          },
          captured,
        );
        if (!result) fail("UNAVAILABLE");
        result.bytes.fill(0);
        if (caller.aborted || lifetime.signal.aborted) fail("ABORTED");
        return Object.freeze({
          profile: "magickli-ritual-bundle-object-receipt-v1" as const,
          operationId: claim.operationId,
          bundleId: claim.bundleId,
          assetKey,
          claimId: claim.claimId,
          ...binding.location,
          sha256: binding.sha256,
          byteSize: binding.byteSize,
          mime: binding.mime,
          verifiedAtMs: result.verifiedAtMs,
        });
      } catch (error) {
        // Smithy can decorate a collector error with raw provider diagnostics.
        // Recreate the public error rather than retaining its message/response.
        if (error instanceof R2RitualBundleStorageError) fail(error.code);
        return fail("UNAVAILABLE");
      } finally {
        ownedBytes?.fill(0);
      }
    },
    async readAsset(input, caller = new AbortController().signal) {
      try {
        if (caller.aborted || lifetime.signal.aborted) fail("ABORTED");
        const descriptor = structuredClone(input);
        if (
          !descriptor ||
          !id(descriptor.expectedActorId) ||
          !digest(descriptor.receiptSha256)
        )
          fail("INVALID_REQUEST");
        const binding: Binding = {
          operationId: descriptor.operationId,
          bundleId: descriptor.bundleId,
          ritualId: descriptor.ritualId,
          assetKey: descriptor.assetKey,
          manifestSha256: descriptor.manifestSha256,
          sha256: descriptor.sha256,
          byteSize: descriptor.byteSize,
          mime: descriptor.mime,
          location: {
            storageProvider: descriptor.location?.provider,
            bucket: descriptor.location?.bucket,
            objectKey: descriptor.location?.objectKey,
          },
        };
        validateBinding(binding);
        const result = await transfer(binding, caller, {
          write: false,
          notBeforeMs: 0,
          expiresAtMs: Infinity,
        });
        if (caller.aborted || lifetime.signal.aborted) {
          result?.bytes.fill(0);
          fail("ABORTED");
        }
        return result?.bytes ?? null;
      } catch (error) {
        if (error instanceof R2RitualBundleStorageError) fail(error.code);
        return fail("UNAVAILABLE");
      }
    },
    destroy() {
      lifetime.abort();
      for (const operation of running) operation.client.destroy();
    },
  };
}

export function createR2RitualBundleStorage(
  input: R2RitualBundleStorageConfig,
  options: Parameters<typeof createS3RitualBundleStorage>[1] = {},
): R2RitualBundleStorage {
  if (!input || input.kind !== "r2") fail("INVALID_CONFIGURATION");
  return createS3RitualBundleStorage(input, options);
}

export function createMinioRitualBundleStorage(
  input: MinioRitualBundleStorageConfig,
  options: Parameters<typeof createS3RitualBundleStorage>[1] = {},
): MinioRitualBundleStorage {
  if (!input || input.kind !== "minio") fail("INVALID_CONFIGURATION");
  return createS3RitualBundleStorage(input, options);
}
