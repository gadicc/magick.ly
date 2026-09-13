import "server-only";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "@gadicc/loom/files/hash";
import sharp from "sharp";
import { DATA_IMAGE_LIMITS } from "./dataImage";
import { legacyStaticImageAliases } from "./legacyStaticImages";
import {
  RITUAL_IMAGE_LIMITS,
  RITUAL_UPLOAD_MAX_BYTES,
  RitualUploadError,
} from "./ritualUploadProtocol";
import type {
  StaticRitualImageCatalogMetadata,
  StaticRitualImageEntry,
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "./staticRitualImageCatalogTypes";
import { createSharpRitualImageValidator } from "./validateRitualImage";
import {
  createRitualSvgValidator,
  RITUAL_SVG_LIMITS,
  RITUAL_SVG_PROFILE,
} from "./validateRitualSvg";

/** Changes require a new validation identity; regression tests bind the actual installed implementation. */
export const STATIC_RASTER_VALIDATION_COMPONENTS = Object.freeze({
  validateRitualImageSha256:
    "6d8f1da45ed0293b6e5d9c1f058f63fe7f017d07704135bb00e407ae4c2abb49",
  ritualImageFramesSha256:
    "629fb0130e13e5a9eba479d01ccfbd368f883d767c3731d62b6842d83bd627e0",
  ritualUploadProtocolSha256:
    "d8a8ebc12df7638de1e62f89b47ed642f1424797e28ea8438cd93d75f23c9a4a",
  sharp: "0.35.4",
  "file-type": "19.0.0",
});
/** Added SVG/parser semantics are independently pinned alongside the unchanged raster contract. */
export const STATIC_SVG_VALIDATION_COMPONENTS = Object.freeze({
  validateRitualSvgSha256:
    "4ebcd8a6648145b2d9098c626d2abe23fd027099a00ec4cb578f6d2ddb01989f",
  dataImageSha256:
    "1d8273b4d29bb8e00c8a5c716f7fd2759ed938082231f3eddba66c98f65a1e60",
  "css-tree": "3.2.1",
  "mdn-data": "2.27.1",
  "source-map-js": "1.2.1",
  saxes: "6.0.0",
  xmlchars: "2.2.0",
});
/** Retained export name for existing callers; the aggregate bound covers raster and SVG captures. */
export const STATIC_RASTER_CATALOG_LIMITS = Object.freeze({
  paths: 128,
  capturedBytes: 64 * 1024 * 1024,
});

/** Configuration errors/whole-build cancellation never expose filesystem paths or decoder diagnostics. */
export class StaticRitualImageCatalogError extends Error {
  constructor(
    readonly code: "INVALID_CONFIGURATION" | "CAPTURE_LIMIT" | "ABORTED",
  ) {
    super(code);
    this.name = "StaticRitualImageCatalogError";
  }
}
/** Files are read only under this trusted, quiescent build root; no ambient directory or network lookup. */
export interface StaticRitualImageCatalogOptions {
  publicDirectory: string;
  /** Exact canonical /pics paths. Alias source paths are supplied by the shared fixed map. */
  paths: readonly string[];
  signal?: AbortSignal;
  /** May tighten the aggregate maxima only. */
  limits?: { paths?: number; capturedBytes?: number };
}
/** Metadata may cross the browser boundary; the retained byte store and these methods are server-only. */
export interface StaticRitualImageCatalog {
  metadata: StaticRitualImageCatalogMetadata;
  /** Returns a fresh owned copy of captured bytes; never reads the filesystem again. */
  copyBytes(pathname: string): Uint8Array | null;
  /** Clears retained snapshots; metadata remains historical evidence and copyBytes then returns null. */
  dispose(): void;
}

type Reason = Extract<StaticRitualImageEntry, { kind: "unresolved" }>["reason"];
class SourceError extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
const aliasPairs = Object.entries(legacyStaticImageAliases).sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0,
);
const ordered = (values: readonly string[]) => [...values].sort();
const validPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 1024 &&
  value.startsWith("/pics/") &&
  /^[A-Za-z0-9._/-]+$/.test(value) &&
  value
    .split("/")
    .slice(1)
    .every((s) => s && s !== "." && s !== "..");
function abort(signal: AbortSignal) {
  if (signal.aborted) throw new StaticRitualImageCatalogError("ABORTED");
}
function sameFile(
  a: import("node:fs").BigIntStats,
  b: import("node:fs").BigIntStats,
) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
/** Reject all directory symlinks, including a symlink used as the configured build root. */
async function directories(directory: string) {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new SourceError("unsafe-file");
  }
  if ((await fs.realpath(directory)) !== directory)
    throw new SourceError("unsafe-file");
}
function reason(error: unknown): Reason {
  if (error instanceof SourceError) return error.reason;
  if (error instanceof RitualUploadError) {
    switch (error.code) {
      case "UNSUPPORTED_TYPE":
        return "unsupported-type";
      case "IMAGE_LIMIT":
        return "image-limit";
      case "TIMEOUT":
        return "validation-timeout";
      case "TOO_LARGE":
        return "too-large";
      default:
        return "invalid-image";
    }
  }
  return "source-unavailable";
}

/**
 * Captures and validates compressed bytes sequentially, then publishes an immutable
 * catalog. SVG uses its closed dependency profile, not a raster-decode promise.
 * Aggregate reads are bounded before buffer
 * allocation, including invalid files. A single open file handle, identity/change
 * checks and O_NOFOLLOW reject symlinks/replacements; this is not a sandbox against
 * an attacker concurrently modifying the trusted build filesystem. Build from a
 * quiescent checkout. Disk edits after success cannot change captured bytes/hash.
 */
export async function createStaticRitualImageCatalog(
  options: StaticRitualImageCatalogOptions,
): Promise<StaticRitualImageCatalog> {
  const invalid = () =>
    new StaticRitualImageCatalogError("INVALID_CONFIGURATION");
  if (
    !options ||
    typeof options.publicDirectory !== "string" ||
    !path.isAbsolute(options.publicDirectory) ||
    path.resolve(options.publicDirectory) !== options.publicDirectory ||
    !Array.isArray(options.paths) ||
    options.paths.some(
      (p) => !validPath(p) || Object.hasOwn(legacyStaticImageAliases, p),
    ) ||
    new Set(options.paths).size !== options.paths.length
  )
    throw invalid();
  const limits: { paths: number; capturedBytes: number } = {
    ...STATIC_RASTER_CATALOG_LIMITS,
  };
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (
      !Object.hasOwn(limits, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key as keyof typeof limits]
    )
      throw invalid();
    limits[key as keyof typeof limits] = value;
  }
  if (options.paths.length > limits.paths) throw invalid();
  const paths = ordered(options.paths);
  const publicDirectory = options.publicDirectory;
  const signal = options.signal ?? new AbortController().signal;
  const captured = new Map<string, Uint8Array>();
  const entries: StaticRitualImageEntry[] = [];
  const validator = createSharpRitualImageValidator();
  const svgValidator = createRitualSvgValidator();
  let capturedBytes = 0;
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  try {
    abort(signal);
    for (const pathname of paths) {
      abort(signal);
      const file = path.join(publicDirectory, pathname.slice(1));
      const parent = path.dirname(file);
      let bytes: Uint8Array | undefined;
      let svgBytes: Uint8Array | undefined;
      try {
        await directories(parent);
        abort(signal);
        const before = await fs.lstat(file, { bigint: true });
        abort(signal);
        if (before.isSymbolicLink() || !before.isFile())
          throw new SourceError("unsafe-file");
        // The explicit .svg catalog path chooses the closed XML validator; bytes
        // must still validate as SVG. Other configured files retain raster detection.
        const isSvg = pathname.toLowerCase().endsWith(".svg");
        if (
          before.size < BigInt(1) ||
          before.size >
            BigInt(isSvg ? RITUAL_SVG_LIMITS.bytes : RITUAL_UPLOAD_MAX_BYTES)
        )
          throw new SourceError("too-large");
        const size = Number(before.size);
        if (capturedBytes + size > limits.capturedBytes)
          throw new StaticRitualImageCatalogError("CAPTURE_LIMIT");
        capturedBytes += size;
        const handle = await fs.open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (!sameFile(before, await handle.stat({ bigint: true })))
            throw new SourceError("source-changed");
          abort(signal);
          bytes = new Uint8Array(size);
          let offset = 0;
          while (offset < size) {
            abort(signal);
            const read = await handle.read(
              bytes,
              offset,
              size - offset,
              offset,
            );
            if (read.bytesRead === 0) throw new SourceError("source-changed");
            offset += read.bytesRead;
          }
          if (!sameFile(before, await handle.stat({ bigint: true })))
            throw new SourceError("source-changed");
        } finally {
          await handle.close();
        }
        await directories(parent);
        if (!sameFile(before, await fs.lstat(file, { bigint: true })))
          throw new SourceError("source-changed");
        abort(signal);
        let facts: StaticRitualRasterFacts | StaticRitualSvgFacts;
        let sha256: string;
        if (isSvg) {
          const svg = await svgValidator.validate(bytes, signal);
          // Own a successful returned snapshot before checking a racing abort so
          // the failure cleanup also clears this validator-created allocation.
          if (svg.status === "validated") svgBytes = svg.bytes;
          abort(signal);
          if (svg.status !== "validated") {
            throw new SourceError(
              svg.code === "TIMEOUT"
                ? "validation-timeout"
                : svg.code === "LIMIT"
                  ? "svg-limit"
                  : svg.status === "incomplete"
                    ? "unsupported-svg"
                    : "invalid-svg",
            );
          }
          svgBytes = svg.bytes;
          sha256 = await sha256Hex(bytes);
          abort(signal);
          if (
            svg.sha256 !== sha256 ||
            svg.byteSize !== bytes.byteLength ||
            svgBytes.byteLength !== bytes.byteLength ||
            !bytes.every((byte, index) => byte === svgBytes![index])
          )
            throw new SourceError("source-changed");
          facts = {
            validationKind: "svg",
            mime: svg.contentType,
            svgProfile: svg.profile,
            elements: svg.elements,
            localReferences: svg.localReferences,
            expandedElements: svg.expandedElements,
            embeddedRasters: Object.freeze(
              svg.embeddedRasters.map((raster) => Object.freeze({ ...raster })),
            ),
          };
          // Retain exactly the validator-owned bytes whose facts were checked.
          bytes.fill(0);
          bytes = svgBytes;
          svgBytes = undefined;
        } else {
          const image = await validator.validate(bytes, signal);
          abort(signal);
          sha256 = await sha256Hex(bytes);
          facts = {
            validationKind: "raster",
            mime: image.contentType,
            width: image.width,
            frameHeight: image.frameHeight,
            frames: image.frames,
            decodedPixels: image.decodedPixels,
          };
        }
        abort(signal);
        captured.set(pathname, bytes);
        entries.push(
          Object.freeze({
            kind: "available",
            pathname,
            canonicalPathname: pathname,
            sha256,
            bytes: bytes.byteLength,
            ...facts,
          }),
        );
        bytes = undefined;
      } catch (error) {
        abort(signal);
        if (error instanceof StaticRitualImageCatalogError) throw error;
        entries.push(
          Object.freeze({
            kind: "unresolved",
            pathname,
            canonicalPathname: pathname,
            reason: reason(error),
          }),
        );
      } finally {
        bytes?.fill(0);
        svgBytes?.fill(0);
      }
    }
    for (const [pathname, canonicalPathname] of aliasPairs) {
      const target = entries.find(
        (entry) => entry.pathname === canonicalPathname,
      );
      if (target)
        entries.push(Object.freeze({ ...target, pathname, canonicalPathname }));
    }
    entries.sort((a, b) =>
      a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0,
    );
    const validationSha256 = await sha256Hex(
      new TextEncoder().encode(
        JSON.stringify([
          STATIC_RASTER_VALIDATION_COMPONENTS,
          STATIC_SVG_VALIDATION_COMPONENTS,
          RITUAL_SVG_PROFILE,
          RITUAL_SVG_LIMITS,
          DATA_IMAGE_LIMITS,
          RITUAL_IMAGE_LIMITS,
          RITUAL_UPLOAD_MAX_BYTES,
          Object.entries(sharp.versions).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        ]),
      ),
    );
    const identity = {
      profile: "magickli-static-image-catalog-v2" as const,
      validationProfile: "magickli-static-image-validation-v2" as const,
      validationSha256,
      aliases: aliasPairs,
      entries,
    };
    const sha256 = await sha256Hex(
      new TextEncoder().encode(JSON.stringify(identity)),
    );
    abort(signal);
    const metadata: StaticRitualImageCatalogMetadata = Object.freeze({
      profile: identity.profile,
      validationProfile: identity.validationProfile,
      validationSha256,
      sha256,
      entries: Object.freeze(entries),
      availablePaths: Object.freeze(
        entries.filter((e) => e.kind === "available").map((e) => e.pathname),
      ),
    });
    return Object.freeze({
      metadata,
      copyBytes(pathname: string): Uint8Array | null {
        const entry = entries.find(
          (e) => e.pathname === pathname && e.kind === "available",
        );
        const bytes = entry && captured.get(entry.canonicalPathname);
        return bytes ? Uint8Array.from(bytes) : null;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
