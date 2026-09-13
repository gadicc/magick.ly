import "server-only";

import { sha256Hex } from "@gadicc/loom/files/hash";
import type {
  PrivateRitualImageCatalog,
  PrivateRitualImageEntry,
} from "./privateRitualImageCatalogTypes";
import {
  parseRitualFileLocator,
  type RitualFileLocator,
} from "./ritualFileLocator";
import type { AuthorizedRitualFile } from "./ritualFileService";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import { RITUAL_IMAGE_TYPES } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

export type { PrivateRitualImageCatalog } from "./privateRitualImageCatalogTypes";

export const PRIVATE_RITUAL_IMAGE_CATALOG_LIMITS = Object.freeze({
  references: 64,
  referenceBytes: 1024 * 1024,
  capturedBytes: 64 * 1024 * 1024,
  timeoutMs: 30_000,
});
type Limits = Record<keyof typeof PRIVATE_RITUAL_IMAGE_CATALOG_LIMITS, number>;

export class PrivateRitualImageCatalogError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "INVALID_LIMITS"
      | "CAPTURE_LIMIT"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "PrivateRitualImageCatalogError";
  }
}

const hash = (value: string) => sha256Hex(new TextEncoder().encode(value));
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Captures only canonical finalized locators through the current authorized file
 * reader. The reader owns both SQL policy checks and exact object verification.
 */
export async function createPrivateRitualImageCatalog(options: {
  references: readonly string[];
  readAuthorized(
    locator: RitualFileLocator,
  ): Promise<AuthorizedRitualFile | null>;
  signal?: AbortSignal;
  limits?: Partial<Limits>;
}): Promise<PrivateRitualImageCatalog> {
  const started = performance.now();
  const limits: Limits = {
    ...PRIVATE_RITUAL_IMAGE_CATALOG_LIMITS,
    ...options.limits,
  };
  for (const [key, value] of Object.entries(limits))
    if (
      !Object.hasOwn(PRIVATE_RITUAL_IMAGE_CATALOG_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > PRIVATE_RITUAL_IMAGE_CATALOG_LIMITS[key as keyof Limits]
    )
      throw new PrivateRitualImageCatalogError("INVALID_LIMITS");
  if (
    !Array.isArray(options.references) ||
    options.references.length > limits.references ||
    typeof options.readAuthorized !== "function"
  )
    throw new PrivateRitualImageCatalogError("INVALID_INPUT");
  const references = await Promise.all(
    Array.from(options.references, async (reference) => {
      if (
        typeof reference !== "string" ||
        reference.length < 1 ||
        reference.length > limits.referenceBytes ||
        Buffer.byteLength(reference) > limits.referenceBytes
      )
        throw new PrivateRitualImageCatalogError("INVALID_INPUT");
      const locator = parseRitualFileLocator(reference);
      if (!locator) throw new PrivateRitualImageCatalogError("INVALID_INPUT");
      return { reference, referenceSha256: await hash(reference), locator };
    }),
  );
  references.sort((a, b) => (a.referenceSha256 < b.referenceSha256 ? -1 : 1));
  if (
    new Set(references.map((entry) => entry.referenceSha256)).size !==
    references.length
  )
    throw new PrivateRitualImageCatalogError("INVALID_INPUT");
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(),
    Math.max(0, limits.timeoutMs - (performance.now() - started)),
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const captured = new Map<string, Uint8Array>();
  const entries: PrivateRitualImageEntry[] = [];
  let capturedBytes = 0;
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  const check = () => {
    if (options.signal?.aborted)
      throw new PrivateRitualImageCatalogError("ABORTED");
    if (
      deadline.signal.aborted ||
      performance.now() - started >= limits.timeoutMs
    )
      throw new PrivateRitualImageCatalogError("TIMEOUT");
  };
  try {
    check();
    const validationSha256 = await getRitualImageValidationSha256();
    check();
    const validator = createSharpRitualImageValidator();
    for (const item of references) {
      check();
      let bytes: Uint8Array | undefined;
      try {
        const file = await options.readAuthorized(item.locator);
        bytes = file?.bytes;
        check();
        if (!file || !bytes) throw new Error("unavailable");
        if (
          file.record.ritualId !== item.locator.ritualId ||
          file.record.attachmentId !== item.locator.attachmentId ||
          file.record.id !== item.locator.fileId ||
          !RITUAL_IMAGE_TYPES.includes(
            file.record.contentType as (typeof RITUAL_IMAGE_TYPES)[number],
          ) ||
          file.record.sha256 !== (await sha256Hex(bytes)) ||
          file.record.byteSize !== bytes.byteLength
        )
          throw new Error("unavailable");
        capturedBytes += bytes.byteLength;
        if (capturedBytes > limits.capturedBytes)
          throw new PrivateRitualImageCatalogError("CAPTURE_LIMIT");
        const image = await validator.validate(bytes, signal);
        check();
        if (
          image.contentType !== file.record.contentType ||
          file.record.imageMeta?.format !== image.contentType.slice(6) ||
          file.record.imageMeta?.width !== image.width ||
          file.record.imageMeta?.height !== image.frameHeight
        )
          throw new Error("unavailable");
        entries.push(
          Object.freeze({
            kind: "available" as const,
            referenceSha256: item.referenceSha256,
            ritualId: item.locator.ritualId,
            attachmentId: item.locator.attachmentId,
            fileId: item.locator.fileId,
            sourceSha256: file.record.sha256,
            sha256: file.record.sha256,
            bytes: bytes.byteLength,
            validationKind: "raster" as const,
            mime: image.contentType,
            width: image.width,
            frameHeight: image.frameHeight,
            frames: image.frames,
            decodedPixels: image.decodedPixels,
          }),
        );
        captured.set(item.referenceSha256, bytes);
        bytes = undefined;
      } catch (error) {
        check();
        if (error instanceof PrivateRitualImageCatalogError) throw error;
        entries.push(
          Object.freeze({
            kind: "unresolved" as const,
            referenceSha256: item.referenceSha256,
            reason: "unavailable" as const,
          }),
        );
      } finally {
        bytes?.fill(0);
      }
    }
    const identity = {
      profile: "magickli-private-ritual-image-catalog-v1" as const,
      validationSha256,
      entries,
    };
    const sha256 = await hash(JSON.stringify(identity));
    check();
    const metadata = freeze({ ...identity, sha256 });
    return Object.freeze({
      metadata,
      copyBytes(referenceSha256: string) {
        const bytes = captured.get(referenceSha256);
        return bytes ? Uint8Array.from(bytes) : null;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    if (error instanceof PrivateRitualImageCatalogError) throw error;
    throw new PrivateRitualImageCatalogError("INVALID_INPUT");
  } finally {
    clearTimeout(timer);
  }
}
