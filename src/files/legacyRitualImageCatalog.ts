import "server-only";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import {
  GetObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { EJSON } from "bson";
import type { legacyFileSnapshots } from "../db/schema/legacyFiles";
import type { loomFilesTable } from "../db/schema/loomFiles";
import { planLegacyFileImport } from "../migration/planLegacyFileImport";
import type {
  LegacyRitualImageCatalogMetadata,
  LegacyRitualImageEntry,
} from "./legacyRitualImageCatalogTypes";
import type { R2RitualStorageConfig } from "./r2RitualStorage";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import {
  RITUAL_UPLOAD_MAX_BYTES,
  RitualUploadError,
} from "./ritualUploadProtocol";
import type {
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "./staticRitualImageCatalogTypes";
import { createSharpRitualImageValidator } from "./validateRitualImage";
import {
  createRitualSvgValidator,
  RITUAL_SVG_LIMITS,
} from "./validateRitualSvg";

/** Trusted server rows, not request parameters. Both sides must prove the original public import. */
export interface LegacyRitualImageSource {
  file: Pick<
    typeof loomFilesTable.$inferSelect,
    | "id"
    | "sha256"
    | "byteSize"
    | "contentType"
    | "kind"
    | "storageProvider"
    | "bucket"
    | "objectKey"
    | "visibility"
    | "ownerType"
    | "ownerId"
    | "deletedAt"
  >;
  snapshot: typeof legacyFileSnapshots.$inferSelect;
}
/** Only an explicitly configured account origin and static credentials can be used. */
export type LegacyRitualImageStorage = Pick<
  R2RitualStorageConfig,
  "kind" | "endpoint" | "bucket" | "credentials"
>;
/** Bounds compressed captures, archived metadata and elapsed capture time; not total process memory. */
export const LEGACY_IMAGE_CATALOG_LIMITS = Object.freeze({
  files: 128,
  sourceBytes: 1024 * 1024,
  totalSourceBytes: 4 * 1024 * 1024,
  capturedBytes: 64 * 1024 * 1024,
  ioTimeoutMs: 30_000,
  timeoutMs: 120_000,
});
type Limits = Record<keyof typeof LEGACY_IMAGE_CATALOG_LIMITS, number>;
export class LegacyRitualImageCatalogError extends Error {
  constructor(
    readonly code:
      | "INVALID_CONFIGURATION"
      | "INVALID_SOURCE"
      | "CAPTURE_LIMIT"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "LegacyRitualImageCatalogError";
  }
}
/** Owned byte snapshots; metadata is historical evidence and conveys no private-file permission. */
export interface LegacyRitualImageCatalog {
  readonly metadata: LegacyRitualImageCatalogMetadata;
  copyBytes(sha256: string): Uint8Array | null;
  dispose(): void;
}
type Reason = Extract<LegacyRitualImageEntry, { kind: "unresolved" }>["reason"];
class SourceError extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 && !value.includes("\0");
function configured(input: LegacyRitualImageStorage): LegacyRitualImageStorage {
  if (
    !input ||
    input.kind !== "r2" ||
    typeof input.endpoint !== "string" ||
    !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(
      input.endpoint,
    ) ||
    typeof input.bucket !== "string" ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
    !input.credentials ||
    !text(input.credentials.accessKeyId) ||
    !text(input.credentials.secretAccessKey) ||
    (input.credentials.sessionToken !== undefined &&
      !text(input.credentials.sessionToken)) ||
    (input.credentials.expiration !== undefined &&
      (!(input.credentials.expiration instanceof Date) ||
        !Number.isFinite(input.credentials.expiration.getTime())))
  )
    throw new LegacyRitualImageCatalogError("INVALID_CONFIGURATION");
  return {
    kind: "r2",
    endpoint: input.endpoint,
    bucket: input.bucket,
    credentials: {
      accessKeyId: input.credentials.accessKeyId,
      secretAccessKey: input.credentials.secretAccessKey,
      ...(input.credentials.sessionToken !== undefined
        ? { sessionToken: input.credentials.sessionToken }
        : {}),
      ...(input.credentials.expiration !== undefined
        ? { expiration: new Date(input.credentials.expiration) }
        : {}),
    },
  };
}
function sources(
  input: readonly LegacyRitualImageSource[],
  config: LegacyRitualImageStorage,
  limits: Limits,
) {
  const invalid = () => new LegacyRitualImageCatalogError("INVALID_SOURCE");
  if (!Array.isArray(input) || input.length > limits.files) throw invalid();
  let total = 0;
  const identities = new Set<string>(),
    ids = new Set<string>(),
    digests = new Set<string>();
  return Array.from(input, (input) => {
    try {
      const { file, snapshot } = input;
      if (
        !file ||
        !snapshot ||
        typeof snapshot.sourceEjson !== "string" ||
        snapshot.sourceEjson.length > limits.sourceBytes
      )
        throw invalid();
      const size = Buffer.byteLength(snapshot.sourceEjson, "utf8");
      total += size;
      if (
        size > limits.sourceBytes ||
        total > limits.totalSourceBytes ||
        hash(snapshot.sourceEjson) !== snapshot.sourceSha256 ||
        snapshot.sourceSystem !== "mongodb" ||
        snapshot.sourceStorageProvider !== config.kind ||
        snapshot.sourceBucket !== config.bucket
      )
        throw invalid();
      // Reuse the import contract, including BSON identity and lossless EJSON.
      // Matching only the foreign key would permit a subsequently changed file row.
      const plan = planLegacyFileImport(
        [EJSON.parse(snapshot.sourceEjson, { relaxed: true })],
        {
          lookup: (ref) =>
            ref.sourceSystem === snapshot.sourceSystem &&
            ref.legacyIdType === snapshot.legacyIdType &&
            ref.legacyIdValue === snapshot.legacyIdValue
              ? snapshot.fileId
              : null,
          storageProvider: snapshot.sourceStorageProvider,
          sourceBucket: snapshot.sourceBucket,
          sourceObjectKeyPrefix: snapshot.sourceObjectKeyPrefix,
          importedAt: snapshot.importedAt,
        },
      );
      const expected = plan.files[0],
        archive = plan.snapshots[0];
      for (const key of Object.keys(archive) as (keyof typeof archive)[])
        if (!isDeepStrictEqual(archive[key], snapshot[key])) throw invalid();
      for (const key of [
        "id",
        "sha256",
        "byteSize",
        "contentType",
        "kind",
        "storageProvider",
        "bucket",
        "objectKey",
        "visibility",
        "ownerType",
        "ownerId",
        "deletedAt",
      ] as const)
        if (!isDeepStrictEqual(expected[key], file[key])) throw invalid();
      const identity = JSON.stringify([
        snapshot.sourceSystem,
        snapshot.legacyIdType,
        snapshot.legacyIdValue,
      ]);
      if (
        identities.has(identity) ||
        ids.has(file.id) ||
        digests.has(file.sha256)
      )
        throw invalid();
      identities.add(identity);
      ids.add(file.id);
      digests.add(file.sha256);
      return Object.freeze({
        fileId: file.id,
        sha256: file.sha256,
        byteSize: file.byteSize,
        contentType: file.contentType,
        kind: file.kind,
        objectKey: file.objectKey,
        sourceSha256: snapshot.sourceSha256,
        provenanceSha256: hash(JSON.stringify(archive)),
      });
    } catch {
      throw invalid();
    }
  }).sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}
function close(body: unknown) {
  if (body instanceof Readable) {
    body.on("error", () => {});
    body.destroy();
  }
}
/** One bounded allocation, including SDK error XML; always releases/destroys the owned stream. */
async function collect(
  body: unknown,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!(body instanceof Readable)) throw new SourceError("source-unavailable");
  let bytes: Uint8Array | undefined;
  const aborted = () => close(body);
  signal.addEventListener("abort", aborted, { once: true });
  try {
    if (signal.aborted) throw new SourceError("source-unavailable");
    bytes = new Uint8Array(maxBytes);
    let offset = 0;
    for await (const chunk of body) {
      if (
        signal.aborted ||
        !(chunk instanceof Uint8Array) ||
        chunk.length > maxBytes - offset
      )
        throw new SourceError("source-mismatch");
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (signal.aborted) throw new SourceError("source-unavailable");
    const result = bytes.subarray(0, offset);
    bytes = undefined;
    return result;
  } finally {
    bytes?.fill(0);
    signal.removeEventListener("abort", aborted);
    close(body);
  }
}
function wait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new SourceError("source-unavailable"));
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
  });
}
async function read(
  config: LegacyRitualImageStorage,
  entry: ReturnType<typeof sources>[number],
  parent: AbortSignal,
  timeoutMs: number,
  requestHandler?: S3ClientConfig["requestHandler"],
) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = AbortSignal.any([parent, deadline.signal]);
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
    // The SDK consumes error bodies before send() settles. Bound those as well as successful bodies.
    streamCollector: async (body) => {
      try {
        return await collect(body, 4096, signal);
      } catch {
        throw new SourceError("source-unavailable");
      }
    },
    ...(requestHandler ? { requestHandler } : {}),
  });
  let body: unknown;
  let bytes: Uint8Array | undefined;
  let finished = false;
  try {
    const result = await wait(
      client
        .send(
          new GetObjectCommand({ Bucket: config.bucket, Key: entry.objectKey }),
          { abortSignal: signal },
        )
        .then((result) => {
          body = result.Body;
          if (finished || signal.aborted) close(body);
          return result;
        }),
      signal,
    );
    if (signal.aborted) throw new SourceError("source-unavailable");
    if (
      result.ContentLength !== entry.byteSize ||
      (result.ContentEncoding && result.ContentEncoding !== "identity")
    )
      throw new SourceError("source-mismatch");
    const captured = await wait(
      collect(body, entry.byteSize, signal).then((value) => {
        if (finished || signal.aborted) value.fill(0);
        else bytes = value;
        return value;
      }),
      signal,
    );
    if (signal.aborted) throw new SourceError("source-unavailable");
    if (captured.length !== entry.byteSize || hash(captured) !== entry.sha256)
      throw new SourceError("source-mismatch");
    bytes = undefined;
    return captured;
  } finally {
    finished = true;
    deadline.abort();
    clearTimeout(timer);
    close(body);
    bytes?.fill(0);
    client.destroy();
  }
}
function reason(error: unknown): Reason {
  if (error instanceof SourceError) return error.reason;
  if (error instanceof RitualUploadError) {
    if (error.code === "IMAGE_LIMIT") return "image-limit";
    if (error.code === "TIMEOUT") return "validation-timeout";
    if (error.code === "UNSUPPORTED_TYPE") return "unsupported-type";
    return "invalid-image";
  }
  return "source-unavailable";
}

/**
 * Validate the complete trusted import projection before any GET, then capture
 * only its exact R2 keys. Preserves Mongo's served MIME; provider headers are not
 * byte identity. Does not infer a prefix, follow redirects, discover env, mutate
 * storage or grant private access. Late/stalled I/O is closed on a fixed deadline.
 */
export async function createLegacyRitualImageCatalog(options: {
  storage: LegacyRitualImageStorage;
  sources: readonly LegacyRitualImageSource[];
  signal?: AbortSignal;
  limits?: Partial<Limits>;
  /** SDK transport seam for providerless tests; no alternate resolver or URL callback. */
  requestHandler?: S3ClientConfig["requestHandler"];
}): Promise<LegacyRitualImageCatalog> {
  const started = performance.now();
  const config = configured(options.storage);
  const limits: Limits = { ...LEGACY_IMAGE_CATALOG_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits))
    if (
      !Object.hasOwn(LEGACY_IMAGE_CATALOG_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > LEGACY_IMAGE_CATALOG_LIMITS[key as keyof Limits]
    )
      throw new LegacyRitualImageCatalogError("INVALID_CONFIGURATION");
  const selected = sources(options.sources, config, limits);
  const requestHandler = options.requestHandler,
    caller = options.signal;
  const deadline = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, deadline.signal])
    : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(0, limits.timeoutMs - (performance.now() - started)),
  );
  const check = () => {
    if (caller?.aborted) throw new LegacyRitualImageCatalogError("ABORTED");
    if (
      deadline.signal.aborted ||
      performance.now() - started >= limits.timeoutMs
    )
      throw new LegacyRitualImageCatalogError("TIMEOUT");
  };
  const captured = new Map<string, Uint8Array>(),
    entries: LegacyRitualImageEntry[] = [];
  let capturedBytes = 0;
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  try {
    check();
    for (const entry of selected) {
      check();
      const base = {
        fileId: entry.fileId,
        sha256: entry.sha256,
        sourceSha256: entry.sourceSha256,
        provenanceSha256: entry.provenanceSha256,
      };
      let bytes: Uint8Array | undefined, svgBytes: Uint8Array | undefined;
      try {
        const isSvg = entry.contentType === "image/svg+xml";
        if (
          entry.kind !== "image" ||
          ![
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/svg+xml",
          ].includes(entry.contentType ?? "")
        )
          throw new SourceError("unsupported-type");
        if (
          entry.byteSize < 1 ||
          entry.byteSize >
            (isSvg ? RITUAL_SVG_LIMITS.bytes : RITUAL_UPLOAD_MAX_BYTES)
        )
          throw new SourceError("too-large");
        capturedBytes += entry.byteSize;
        if (capturedBytes > limits.capturedBytes)
          throw new LegacyRitualImageCatalogError("CAPTURE_LIMIT");
        bytes = await read(
          config,
          entry,
          signal,
          limits.ioTimeoutMs,
          requestHandler,
        );
        check();
        let facts: StaticRitualRasterFacts | StaticRitualSvgFacts;
        if (isSvg) {
          const svg = await createRitualSvgValidator().validate(bytes, signal);
          if (svg.status === "validated") svgBytes = svg.bytes;
          check();
          if (svg.status !== "validated")
            throw new SourceError(
              svg.code === "TIMEOUT"
                ? "validation-timeout"
                : svg.code === "LIMIT"
                  ? "svg-limit"
                  : svg.status === "incomplete"
                    ? "unsupported-svg"
                    : "invalid-svg",
            );
          if (
            svg.sha256 !== entry.sha256 ||
            svg.byteSize !== entry.byteSize ||
            svgBytes!.length !== entry.byteSize ||
            hash(svgBytes!) !== entry.sha256
          )
            throw new SourceError("source-mismatch");
          facts = {
            validationKind: "svg",
            mime: svg.contentType,
            svgProfile: svg.profile,
            elements: svg.elements,
            localReferences: svg.localReferences,
            expandedElements: svg.expandedElements,
            embeddedRasters: Object.freeze(
              svg.embeddedRasters.map((r) => Object.freeze({ ...r })),
            ),
          };
        } else {
          const image = await createSharpRitualImageValidator().validate(
            bytes,
            signal,
          );
          check();
          if (image.contentType !== entry.contentType)
            throw new SourceError("source-mismatch");
          facts = {
            validationKind: "raster",
            mime: image.contentType,
            width: image.width,
            frameHeight: image.frameHeight,
            frames: image.frames,
            decodedPixels: image.decodedPixels,
          };
        }
        entries.push(
          Object.freeze({
            ...base,
            kind: "available",
            bytes: bytes.length,
            ...facts,
          }),
        );
        captured.set(entry.sha256, bytes);
        bytes = undefined;
      } catch (error) {
        check();
        if (error instanceof LegacyRitualImageCatalogError) throw error;
        entries.push(
          Object.freeze({ ...base, kind: "unresolved", reason: reason(error) }),
        );
      } finally {
        bytes?.fill(0);
        svgBytes?.fill(0);
      }
    }
    const validationSha256 = await getRitualImageValidationSha256();
    check();
    const identity = {
      profile: "magickli-legacy-image-catalog-v1" as const,
      validationSha256,
      entries: Object.freeze(entries),
    };
    const metadata = Object.freeze({
      ...identity,
      sha256: hash(JSON.stringify(identity)),
    });
    return Object.freeze({
      metadata,
      copyBytes: (sha256: string) => {
        const bytes = captured.get(sha256);
        return bytes ? Uint8Array.from(bytes) : null;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}
