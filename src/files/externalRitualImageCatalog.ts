import "server-only";
import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIPv4 } from "node:net";
import type {
  ExternalRitualImageCatalogMetadata,
  ExternalRitualImageEntry,
} from "./externalRitualImageCatalogTypes";
import { EXTERNAL_RITUAL_IMAGE_POLICY } from "./externalRitualImagePolicy";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import { RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

/** Tighten only; this is a fixed-reference image migration, not a URL proxy. */
export const EXTERNAL_IMAGE_CATALOG_LIMITS = Object.freeze({
  references: 64,
  referenceBytes: 16 * 1024,
  capturedBytes: 1024 * 1024,
  ioTimeoutMs: 20_000,
  timeoutMs: 90_000,
});
type Limits = Record<keyof typeof EXTERNAL_IMAGE_CATALOG_LIMITS, number>;
type Policy = (typeof EXTERNAL_RITUAL_IMAGE_POLICY)[number];
type Reason = Extract<
  ExternalRitualImageEntry,
  { kind: "unresolved" }
>["reason"];
export class ExternalRitualImageCatalogError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "INVALID_LIMITS"
      | "CAPTURE_LIMIT"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "ExternalRitualImageCatalogError";
  }
}
class SourceError extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
/** Owns byte snapshots. Copies survive disposal; no subsequent network or validation takes place. */
export interface ExternalRitualImageCatalog {
  readonly metadata: ExternalRitualImageCatalogMetadata;
  copyBytes(referenceSha256: string): Uint8Array | null;
  dispose(): void;
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
// Conservative IPv4-only acquisition. No alternate family, private/link-local,
// documentation, benchmarking, multicast or reserved destinations are contacted.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");

function acquisition(reference: string, policy: Policy): URL {
  const url = new URL(reference);
  if (
    url.href !== reference ||
    url.protocol !== "https:" ||
    url.hostname !== policy.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search
  )
    throw new SourceError("unapproved-reference");
  if (policy.representation === "same-file-standard-thumbnail") {
    const parts = url.pathname.split("/").filter(Boolean),
      match = /^800px-(.+)$/.exec(parts.at(-1) ?? "");
    if (
      policy.hostname !== "upload.wikimedia.org" ||
      parts.length !== 7 ||
      parts.slice(0, 3).join("/") !== "wikipedia/commons/thumb" ||
      !match ||
      match[1] !== parts.at(-2)
    )
      throw new SourceError("unapproved-reference");
    // Only the pinned unavailable 800px reference qualifies. The original source
    // remains unchanged; this is explicitly a same-file replacement representation.
    return new URL(
      reference.slice(0, reference.lastIndexOf("/") + 1) + "960px-" + match[1],
    );
  }
  return url;
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
  url: URL,
  policy: Policy,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<Uint8Array> {
  const deadline = new AbortController(),
    timer = setTimeout(() => deadline.abort(), timeoutMs);
  const signal = AbortSignal.any([parent, deadline.signal]);
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  let request: ClientRequest | undefined,
    response: IncomingMessage | undefined,
    bytes: Uint8Array | undefined;
  let finished = false;
  const cancel = () => {
    resolver.cancel();
    response?.destroy();
    request?.destroy();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new SourceError("source-unavailable");
    const addresses = await wait(resolver.resolve4(url.hostname), signal);
    if (signal.aborted) throw new SourceError("source-unavailable");
    if (
      addresses.length < 1 ||
      addresses.some((ip) => !isIPv4(ip) || blocked.check(ip, "ipv4"))
    )
      throw new SourceError("unsafe-address");
    // Own one exact, pre-budgeted allocation. Error responses are closed without
    // collecting their bodies. No global connection/proxy pool can bypass lookup.
    bytes = new Uint8Array(policy.byteSize);
    const allocated = bytes;
    let offset = 0;
    await wait(
      new Promise<void>((resolve, reject) => {
        request = https.get(
          url,
          {
            agent: false,
            family: 4,
            // Node forwards this net option; the installed HTTP types omit it.
            ...({ autoSelectFamily: false } satisfies Pick<
              import("node:net").TcpNetConnectOpts,
              "autoSelectFamily"
            >),
            servername: url.hostname,
            rejectUnauthorized: true,
            maxHeaderSize: 16 * 1024,
            signal,
            lookup(hostname, _options, callback) {
              if (signal.aborted || hostname !== url.hostname)
                return callback(new SourceError("unsafe-address"), "", 4);
              callback(null, addresses[0], 4);
            },
            headers: {
              Accept: "image/png,image/jpeg,image/gif,image/webp",
              "Accept-Encoding": "identity",
              "User-Agent":
                "MagicklyOfflineMigrationBot/1.0 (+https://magick.ly)",
            },
          },
          (received) => {
            response = received;
            received.on("error", () =>
              reject(new SourceError("source-unavailable")),
            );
            // A callback can race abort/deadline. Own and close even a late response.
            if (finished || signal.aborted) {
              received.destroy();
              reject(new SourceError("source-unavailable"));
              return;
            }
            const length = received.headers["content-length"],
              encoding = received.headers["content-encoding"];
            if (received.statusCode !== 200) {
              received.destroy();
              reject(new SourceError("source-unavailable"));
              return;
            }
            if (
              (encoding && encoding !== "identity") ||
              (length !== undefined &&
                (!/^\d+$/.test(length) || Number(length) !== policy.byteSize))
            ) {
              received.destroy();
              reject(new SourceError("source-mismatch"));
              return;
            }
            received.on("data", (chunk: unknown) => {
              if (
                finished ||
                signal.aborted ||
                !(chunk instanceof Uint8Array) ||
                chunk.length > allocated.length - offset
              ) {
                received.destroy();
                reject(new SourceError("source-mismatch"));
                return;
              }
              allocated.set(chunk, offset);
              offset += chunk.length;
            });
            received.on("end", () =>
              offset === policy.byteSize
                ? resolve()
                : reject(new SourceError("source-mismatch")),
            );
            received.on("close", () => {
              if (!received.complete)
                reject(new SourceError("source-unavailable"));
            });
          },
        );
        request.on("error", () =>
          reject(new SourceError("source-unavailable")),
        );
      }),
      signal,
    );
    if (signal.aborted || hash(allocated) !== policy.sha256)
      throw new SourceError("source-mismatch");
    bytes = undefined;
    return allocated;
  } finally {
    finished = true;
    deadline.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    cancel();
    bytes?.fill(0);
  }
}
function reason(error: unknown): Reason {
  if (error instanceof SourceError) return error.reason;
  if (error instanceof RitualUploadError) {
    if (error.code === "IMAGE_LIMIT") return "image-limit";
    if (error.code === "TIMEOUT") return "validation-timeout";
    return "invalid-image";
  }
  return "source-unavailable";
}

/**
 * Captures only the app's four reviewed reference/byte pairs. Unknown URLs cause
 * no DNS/HTTP call. Approved acquisitions use public IPv4 with pinned lookup, TLS
 * verification, no redirect/retry/auth/referrer, bounded DNS/headers/body and full
 * raster validation. No callbacks can expand the policy; callers supply original
 * network references after fragment separation. This does not publish a bundle.
 */
export async function createExternalRitualImageCatalog(options: {
  references: readonly string[];
  signal?: AbortSignal;
  limits?: Partial<Limits>;
}): Promise<ExternalRitualImageCatalog> {
  const started = performance.now();
  const limits: Limits = {
    ...EXTERNAL_IMAGE_CATALOG_LIMITS,
    ...options.limits,
  };
  for (const [key, value] of Object.entries(limits))
    if (
      !Object.hasOwn(EXTERNAL_IMAGE_CATALOG_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > EXTERNAL_IMAGE_CATALOG_LIMITS[key as keyof Limits]
    )
      throw new ExternalRitualImageCatalogError("INVALID_LIMITS");
  if (
    !Array.isArray(options.references) ||
    options.references.length > limits.references
  )
    throw new ExternalRitualImageCatalogError("INVALID_INPUT");
  const references = Array.from(options.references, (value) => {
    if (
      typeof value !== "string" ||
      !value ||
      !value.isWellFormed() ||
      value.includes("#") ||
      value.length > limits.referenceBytes ||
      Buffer.byteLength(value) > limits.referenceBytes
    )
      throw new ExternalRitualImageCatalogError("INVALID_INPUT");
    return { reference: value, referenceSha256: hash(value) };
  }).sort((a, b) => (a.referenceSha256 < b.referenceSha256 ? -1 : 1));
  if (
    new Set(references.map((row) => row.referenceSha256)).size !==
    references.length
  )
    throw new ExternalRitualImageCatalogError("INVALID_INPUT");
  const caller = options.signal,
    deadline = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, deadline.signal])
    : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(0, limits.timeoutMs - (performance.now() - started)),
  );
  const check = () => {
    if (caller?.aborted) throw new ExternalRitualImageCatalogError("ABORTED");
    if (
      deadline.signal.aborted ||
      performance.now() - started >= limits.timeoutMs
    )
      throw new ExternalRitualImageCatalogError("TIMEOUT");
  };
  const entries: ExternalRitualImageEntry[] = [],
    captured = new Map<string, Uint8Array>();
  let capturedBytes = 0;
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  try {
    check();
    for (const { reference, referenceSha256 } of references) {
      check();
      let bytes: Uint8Array | undefined;
      try {
        const policy = EXTERNAL_RITUAL_IMAGE_POLICY.find(
          (row) => row.referenceSha256 === referenceSha256,
        );
        if (!policy) throw new SourceError("unapproved-reference");
        const url = acquisition(reference, policy);
        capturedBytes += policy.byteSize;
        if (capturedBytes > limits.capturedBytes)
          throw new ExternalRitualImageCatalogError("CAPTURE_LIMIT");
        bytes = await read(url, policy, signal, limits.ioTimeoutMs);
        check();
        const image = await createSharpRitualImageValidator().validate(
          bytes,
          signal,
        );
        check();
        if (image.contentType !== policy.contentType)
          throw new SourceError("source-mismatch");
        entries.push(
          Object.freeze({
            kind: "available",
            referenceSha256,
            acquisitionReferenceSha256: hash(url.href),
            representation: policy.representation,
            sha256: policy.sha256,
            bytes: bytes.length,
            validationKind: "raster",
            mime: image.contentType,
            width: image.width,
            frameHeight: image.frameHeight,
            frames: image.frames,
            decodedPixels: image.decodedPixels,
          }),
        );
        captured.set(referenceSha256, bytes);
        bytes = undefined;
      } catch (error) {
        check();
        if (error instanceof ExternalRitualImageCatalogError) throw error;
        entries.push(
          Object.freeze({
            kind: "unresolved",
            referenceSha256,
            reason: reason(error),
          }),
        );
      } finally {
        bytes?.fill(0);
      }
    }
    const validationSha256 = await getRitualImageValidationSha256();
    check();
    const identity = {
      profile: "magickli-external-image-catalog-v1" as const,
      policySha256: hash(JSON.stringify(EXTERNAL_RITUAL_IMAGE_POLICY)),
      validationSha256,
      entries: Object.freeze(entries),
    };
    const metadata = Object.freeze({
      ...identity,
      sha256: hash(JSON.stringify(identity)),
    });
    return Object.freeze({
      metadata,
      copyBytes: (referenceSha256: string) => {
        const bytes = captured.get(referenceSha256);
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
