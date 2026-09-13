import "server-only";
import { sha256Hex } from "@gadicc/loom/files/hash";
import {
  DATA_IMAGE_LIMITS,
  DataImageError,
  decodeDataImage,
} from "../files/dataImage";
import {
  RITUAL_IMAGE_LIMITS,
  RitualUploadError,
} from "../files/ritualUploadProtocol";
import type { StaticRitualImageCatalog } from "../files/staticRitualImageCatalog";
import type {
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "../files/staticRitualImageCatalogTypes";
import { createSharpRitualImageValidator } from "../files/validateRitualImage";
import { createRitualSvgValidator } from "../files/validateRitualSvg";
import {
  inventoryRitualAssetJson,
  RITUAL_ASSET_INVENTORY_LIMITS,
  type RitualAssetOccurrence,
} from "./ritualAssetInventory";
import type {
  RitualAssetPlanMetadata,
  RitualResolvedAsset,
} from "./ritualAssetPlanTypes";

/** Compressed captures and newly decoded inline pixels, not total process memory or SVG paint cost. */
export const RITUAL_ASSET_PLAN_LIMITS = Object.freeze({
  capturedBytes: 64 * 1024 * 1024,
  inlineImages: 64,
  inlinePixels: 64_000_000,
  timeoutMs: 30_000,
});
type Limits = Record<keyof typeof RITUAL_ASSET_PLAN_LIMITS, number>;
export class RitualAssetPlanError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "CONTENT_MISMATCH"
      | "INVALID_LIMITS"
      | "CAPTURE_LIMIT"
      | "INLINE_LIMIT"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "RitualAssetPlanError";
  }
}
/** Returned copies belong to the caller. Dispose clears only this plan's retained captures. */
export interface RitualAssetPlan {
  readonly metadata: RitualAssetPlanMetadata;
  copyBytes(assetIndex: number): Uint8Array | null;
  dispose(): void;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function rasterFacts(image: {
  contentType: StaticRitualRasterFacts["mime"];
  width: number;
  frameHeight: number;
  frames: number;
  decodedPixels: number;
}): StaticRitualRasterFacts {
  const { contentType: mime, ...dimensions } = image;
  return { validationKind: "raster", mime, ...dimensions };
}

/**
 * Enumerate the exact selected-render JSON internally and resolve only captured
 * static images and closed, validated inline images. No network requests or
 * caller-supplied occurrence/manifest callbacks are accepted. The caller must
 * authorize and select content separately; even a complete plan grants no access.
 *
 * Unsupported sources remain explicit gaps. A later bundle publisher must bind
 * this evidence to the selected SQL descriptor and assign durable UUIDv7 IDs.
 */
export async function createRitualAssetPlan(
  contentJson: string,
  options: {
    contentSha256: string;
    knownAppOrigins: readonly string[];
    /** Trusted server-built catalog; never deserialize this capability from a request. */
    staticCatalog: StaticRitualImageCatalog;
    signal?: AbortSignal;
    limits?: Partial<Limits>;
  },
): Promise<RitualAssetPlan> {
  const startedAt = performance.now();
  const limits: Limits = { ...RITUAL_ASSET_PLAN_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits))
    if (
      !Object.hasOwn(RITUAL_ASSET_PLAN_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > RITUAL_ASSET_PLAN_LIMITS[key as keyof Limits]
    )
      throw new RitualAssetPlanError("INVALID_LIMITS");
  const contentSha256 = options.contentSha256;
  if (
    typeof contentJson !== "string" ||
    contentJson.length > RITUAL_ASSET_INVENTORY_LIMITS.jsonBytes ||
    typeof contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(contentSha256)
  )
    throw new RitualAssetPlanError("INVALID_INPUT");
  const encoded = new TextEncoder().encode(contentJson);
  if (encoded.length > RITUAL_ASSET_INVENTORY_LIMITS.jsonBytes)
    throw new RitualAssetPlanError("INVALID_INPUT");
  // Take the trusted catalog/config snapshot before yielding to the caller.
  const catalog = options.staticCatalog;
  const catalogMetadata = structuredClone(catalog.metadata);
  if (
    catalogMetadata.profile !== "magickli-static-image-catalog-v2" ||
    catalogMetadata.validationProfile !== "magickli-static-image-validation-v2"
  )
    throw new RitualAssetPlanError("INVALID_INPUT");
  const inventory = inventoryRitualAssetJson(contentJson, {
    knownAppOrigins: [...options.knownAppOrigins],
    staticPaths: catalogMetadata.entries.map((entry) => entry.pathname),
  });
  const entries = new Map(
    catalogMetadata.entries.map((entry) => [entry.pathname, entry]),
  );
  const captured: Uint8Array[] = [];
  const assets: RitualResolvedAsset[] = [];
  const resolved = new Map<string, number | string>();
  const occurrences: Array<{
    path: number[];
    src: string;
    displayFragment: string;
    assetIndex: number | null;
  }> = [];
  const issues = [...inventory.issues];
  let capturedBytes = 0;
  let inlineImages = 0;
  let inlinePixels = 0;
  const dispose = () => {
    for (const bytes of captured) bytes.fill(0);
    captured.length = 0;
  };
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(),
    Math.max(0, limits.timeoutMs - (performance.now() - startedAt)),
  );
  const callerSignal = options.signal;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeout.signal])
    : timeout.signal;
  const check = () => {
    if (callerSignal?.aborted) throw new RitualAssetPlanError("ABORTED");
    if (
      timeout.signal.aborted ||
      performance.now() - startedAt >= limits.timeoutMs
    )
      throw new RitualAssetPlanError("TIMEOUT");
  };
  const charge = (size: number) => {
    capturedBytes += size;
    if (capturedBytes > limits.capturedBytes)
      throw new RitualAssetPlanError("CAPTURE_LIMIT");
  };
  async function resolveImage(
    item: RitualAssetOccurrence,
  ): Promise<number | string> {
    const reference = item.reference;
    let bytes: Uint8Array | undefined;
    let svgBytes: Uint8Array | undefined;
    try {
      let facts: StaticRitualRasterFacts | StaticRitualSvgFacts;
      let provenance: RitualResolvedAsset["provenance"];
      if (reference.kind === "local-static") {
        const entry = entries.get(reference.pathname);
        if (!entry || entry.kind !== "available") return "static-unavailable";
        charge(entry.bytes);
        bytes = catalog.copyBytes(reference.pathname) ?? undefined;
        if (!bytes) return "static-unavailable";
        if (
          bytes.length !== entry.bytes ||
          (await sha256Hex(bytes)) !== entry.sha256
        )
          return "static-snapshot-mismatch";
        const {
          kind: _kind,
          pathname,
          canonicalPathname,
          sha256: _sha,
          bytes: _size,
          ...imageFacts
        } = entry;
        facts = imageFacts;
        provenance = { kind: "static", pathname, canonicalPathname };
      } else if (reference.kind === "inline-image") {
        if (++inlineImages > limits.inlineImages)
          throw new RitualAssetPlanError("INLINE_LIMIT");
        if (capturedBytes >= limits.capturedBytes)
          return "capture-budget-exhausted";
        // Conservatively defer any further inline image, including a vector-only
        // SVG, rather than giving another decoder an already exhausted budget.
        if (inlinePixels >= limits.inlinePixels)
          return "inline-pixel-budget-exhausted";
        const decoded = decodeDataImage(item.networkReference, {
          maxBytes: Math.min(
            DATA_IMAGE_LIMITS.maxBytes,
            limits.capturedBytes - capturedBytes,
          ),
        });
        bytes = decoded.bytes;
        charge(bytes.length);
        if (decoded.declaredMime === "image/svg+xml") {
          const svg = await createRitualSvgValidator({
            embeddedPixels: limits.inlinePixels - inlinePixels,
          }).validate(bytes, signal);
          if (svg.status === "validated") svgBytes = svg.bytes;
          check();
          if (svg.status !== "validated") {
            // A failed SVG can have decoded embedded images before discovering
            // another problem. Reserve its remaining budget, since no complete
            // pixel receipt exists, before inspecting later occurrences.
            inlinePixels = limits.inlinePixels;
            return "inline-svg-" + svg.code.toLowerCase().replaceAll("_", "-");
          }
          inlinePixels += svg.embeddedRasters.reduce(
            (sum, image) => sum + image.decodedPixels,
            0,
          );
          facts = {
            validationKind: "svg",
            mime: "image/svg+xml",
            svgProfile: svg.profile,
            elements: svg.elements,
            localReferences: svg.localReferences,
            expandedElements: svg.expandedElements,
            embeddedRasters: svg.embeddedRasters,
          };
          bytes.fill(0);
          bytes = svg.bytes;
          svgBytes = undefined;
        } else {
          const image = await createSharpRitualImageValidator({
            ...RITUAL_IMAGE_LIMITS,
            maxPixels: limits.inlinePixels - inlinePixels,
          }).validate(bytes, signal);
          check();
          inlinePixels += image.decodedPixels;
          if (image.contentType !== decoded.declaredMime)
            return "inline-mime-mismatch";
          facts = rasterFacts(image);
        }
        provenance = { kind: "inline" };
      } else {
        return reference.kind === "invalid" || reference.kind === "unresolved"
          ? "unresolved-reference"
          : reference.kind + "-pending";
      }
      check();
      const sha256 = await sha256Hex(bytes);
      check();
      const index = assets.length;
      assets.push({
        networkReference: item.networkReference,
        sha256,
        bytes: bytes.length,
        provenance,
        ...facts,
      });
      captured.push(bytes);
      bytes = undefined;
      return index;
    } catch (error) {
      check();
      if (error instanceof RitualAssetPlanError) throw error;
      if (error instanceof DataImageError)
        return "inline-" + error.code.toLowerCase().replaceAll("_", "-");
      if (error instanceof RitualUploadError) {
        inlinePixels = limits.inlinePixels;
        return "inline-" + error.code.toLowerCase().replaceAll("_", "-");
      }
      if (reference.kind === "inline-image") inlinePixels = limits.inlinePixels;
      return "image-unavailable";
    } finally {
      bytes?.fill(0);
      svgBytes?.fill(0);
    }
  }
  try {
    check();
    if ((await sha256Hex(encoded)) !== contentSha256)
      throw new RitualAssetPlanError("CONTENT_MISMATCH");
    check();
    for (const item of inventory.occurrences) {
      let result = resolved.get(item.networkReference);
      if (result === undefined) {
        result = await resolveImage(item);
        resolved.set(item.networkReference, result);
      }
      check();
      occurrences.push({
        path: [...item.path],
        src: item.src,
        displayFragment: item.displayFragment,
        assetIndex: typeof result === "number" ? result : null,
      });
      if (typeof result === "string")
        issues.push({ code: result, path: [...item.path], field: "src" });
    }
    const identity = {
      profile: "magickli-ritual-asset-plan-v1" as const,
      contentSha256,
      inventoryProfile: inventory.profile,
      staticCatalogSha256: catalogMetadata.sha256,
      validationSha256: catalogMetadata.validationSha256,
      limits,
      resolutionComplete: inventory.enumerationComplete && issues.length === 0,
      assets,
      occurrences,
      issues,
    };
    const sha256 = await sha256Hex(
      new TextEncoder().encode(JSON.stringify(identity)),
    );
    check();
    const metadata = freeze({ ...identity, sha256 });
    return Object.freeze({
      metadata,
      copyBytes(index: number) {
        return Number.isSafeInteger(index) && index >= 0 && captured[index]
          ? Uint8Array.from(captured[index])
          : null;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
