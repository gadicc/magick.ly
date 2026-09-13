import "server-only";
import { createHash } from "node:crypto";
import { inventoryRitualAssets } from "../offline/ritualAssetInventory";
import { renderComponentImage } from "../render/componentImage";
import {
  InvalidComponentImageRequest,
  parseComponentImageRequest,
} from "../render/componentImageRequest";
import type {
  GeneratedRitualImageCatalog,
  GeneratedRitualImageEntry,
} from "./generatedRitualImageCatalogTypes";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import { RitualUploadError } from "./ritualUploadProtocol";
import type {
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "./staticRitualImageCatalogTypes";
import { createSharpRitualImageValidator } from "./validateRitualImage";
import { createRitualSvgValidator } from "./validateRitualSvg";

export type { GeneratedRitualImageCatalog } from "./generatedRitualImageCatalogTypes";

/** Render-count/retained-byte bounds, with a cooperative overall deadline. */
export const GENERATED_RITUAL_IMAGE_LIMITS = Object.freeze({
  references: 32,
  referenceBytes: 16 * 1024,
  imageBytes: 4 * 1024 * 1024,
  capturedBytes: 32 * 1024 * 1024,
  timeoutMs: 30_000,
});
type Limits = Record<keyof typeof GENERATED_RITUAL_IMAGE_LIMITS, number>;
export class GeneratedRitualImageCatalogError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "INVALID_LIMITS"
      | "CAPTURE_LIMIT"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "GeneratedRitualImageCatalogError";
  }
}
type Reason = Extract<
  GeneratedRitualImageEntry,
  { kind: "unresolved" }
>["reason"];
class CaptureError extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Resolve approved local component references by calling the closed renderer in
 * process. No URL is fetched and no caller-supplied renderer/SVG is accepted.
 * Current ritual authorization and durable publication are separate operations.
 */
export async function createGeneratedRitualImageCatalog(options: {
  references: readonly string[];
  knownAppOrigins: readonly string[];
  signal?: AbortSignal;
  limits?: Partial<Limits>;
}): Promise<GeneratedRitualImageCatalog> {
  const started = performance.now();
  const limits: Limits = {
    ...GENERATED_RITUAL_IMAGE_LIMITS,
    ...options.limits,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (
      !Object.hasOwn(GENERATED_RITUAL_IMAGE_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > GENERATED_RITUAL_IMAGE_LIMITS[key as keyof Limits]
    ) {
      throw new GeneratedRitualImageCatalogError("INVALID_LIMITS");
    }
  }
  if (
    !Array.isArray(options.references) ||
    options.references.length > limits.references ||
    !Array.isArray(options.knownAppOrigins) ||
    options.knownAppOrigins.length > 16 ||
    Array.from(options.knownAppOrigins).some(
      (value) => typeof value !== "string" || value.length > 2048,
    )
  ) {
    throw new GeneratedRitualImageCatalogError("INVALID_INPUT");
  }
  // Array.from visits holes too; validate/snapshot the whole batch before I/O.
  const references = Array.from(options.references, (value) => {
    if (
      typeof value !== "string" ||
      !value ||
      !value.isWellFormed() ||
      value.includes("#") ||
      value.length > limits.referenceBytes ||
      Buffer.byteLength(value) > limits.referenceBytes
    ) {
      throw new GeneratedRitualImageCatalogError("INVALID_INPUT");
    }
    return value;
  });
  if (new Set(references).size !== references.length)
    throw new GeneratedRitualImageCatalogError("INVALID_INPUT");
  const inventory = inventoryRitualAssets(
    { children: references.map((src) => ({ type: "img", src })) },
    {
      knownAppOrigins: [...options.knownAppOrigins],
      staticPaths: [],
    },
  );
  if (
    inventory.occurrences.length !== references.length ||
    inventory.issues.some((issue) => issue.code === "invalid-inventory-input")
  ) {
    throw new GeneratedRitualImageCatalogError("INVALID_INPUT");
  }
  const selected = inventory.occurrences
    .map((item) => ({ ...item, referenceSha256: hash(item.networkReference) }))
    .sort((a, b) => (a.referenceSha256 < b.referenceSha256 ? -1 : 1));
  const caller = options.signal;
  const deadline = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, deadline.signal])
    : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(0, limits.timeoutMs - (performance.now() - started)),
  );
  const check = () => {
    if (caller?.aborted) throw new GeneratedRitualImageCatalogError("ABORTED");
    if (
      deadline.signal.aborted ||
      performance.now() - started >= limits.timeoutMs
    )
      throw new GeneratedRitualImageCatalogError("TIMEOUT");
  };
  const entries: GeneratedRitualImageEntry[] = [];
  const captured = new Map<string, Uint8Array>();
  let capturedBytes = 0;
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  try {
    check();
    for (const item of selected) {
      check();
      let bytes: Uint8Array | undefined;
      let validatedBytes: Uint8Array | undefined;
      try {
        if (item.reference.kind !== "generated-tree-of-life")
          throw new CaptureError("unsupported-reference");
        const searchParams = new URL(
          item.networkReference,
          "https://inventory.invalid",
        ).searchParams;
        const request = parseComponentImageRequest(
          "tree-of-life",
          searchParams,
        );
        if (capturedBytes >= limits.capturedBytes)
          throw new GeneratedRitualImageCatalogError("CAPTURE_LIMIT");
        const rendered = await renderComponentImage(
          "tree-of-life",
          searchParams,
        );
        bytes = rendered.bytes;
        check();
        capturedBytes += bytes.length;
        if (capturedBytes > limits.capturedBytes)
          throw new GeneratedRitualImageCatalogError("CAPTURE_LIMIT");
        if (bytes.length > limits.imageBytes)
          throw new CaptureError("image-limit");
        if (
          rendered.byteSize !== bytes.length ||
          rendered.sha256 !== hash(bytes) ||
          JSON.stringify(rendered.request) !== JSON.stringify(request) ||
          rendered.contentType !==
            (request.format === "svg" ? "image/svg+xml" : "image/png")
        ) {
          throw new CaptureError("render-mismatch");
        }
        let facts: StaticRitualSvgFacts | StaticRitualRasterFacts;
        if (rendered.contentType === "image/svg+xml") {
          const svg = await createRitualSvgValidator().validate(bytes, signal);
          if (svg.status === "validated") validatedBytes = svg.bytes;
          check();
          if (svg.status !== "validated")
            throw new CaptureError("invalid-image");
          if (
            svg.sha256 !== rendered.sha256 ||
            svg.byteSize !== bytes.length ||
            hash(svg.bytes) !== rendered.sha256
          )
            throw new CaptureError("render-mismatch");
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
          validatedBytes = undefined;
        } else {
          const image = await createSharpRitualImageValidator().validate(
            bytes,
            signal,
          );
          check();
          if (image.contentType !== "image/png")
            throw new CaptureError("render-mismatch");
          facts = {
            validationKind: "raster",
            mime: image.contentType,
            width: image.width,
            frameHeight: image.frameHeight,
            frames: image.frames,
            decodedPixels: image.decodedPixels,
          };
        }
        entries.push({
          kind: "available",
          referenceSha256: item.referenceSha256,
          sourceSha256: rendered.sourceSha256,
          request,
          renderer: structuredClone(rendered.identity),
          sha256: rendered.sha256,
          bytes: bytes.length,
          ...facts,
        });
        captured.set(item.referenceSha256, bytes);
        bytes = undefined;
      } catch (error) {
        check();
        if (error instanceof GeneratedRitualImageCatalogError) throw error;
        const reason: Reason =
          error instanceof InvalidComponentImageRequest
            ? "unsupported-query"
            : error instanceof CaptureError
              ? error.reason
              : error instanceof RitualUploadError
                ? "invalid-image"
                : "render-unavailable";
        entries.push({
          kind: "unresolved",
          referenceSha256: item.referenceSha256,
          reason,
        });
      } finally {
        bytes?.fill(0);
        validatedBytes?.fill(0);
      }
    }
    const validationSha256 = await getRitualImageValidationSha256();
    check();
    const identity = {
      profile: "magickli-generated-image-catalog-v1" as const,
      validationSha256,
      entries,
    };
    return Object.freeze({
      metadata: freeze({ ...identity, sha256: hash(JSON.stringify(identity)) }),
      copyBytes(referenceSha256: string) {
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
