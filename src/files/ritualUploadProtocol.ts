import { isSha256Hex } from "@gadicc/loom/files/hash";
import { isUuidV7 } from "../lib/ids";

export const RITUAL_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const RITUAL_IMAGE_LIMITS = Object.freeze({
  maxDimension: 16_384,
  maxPixels: 64_000_000,
  maxFrames: 256,
  decodeSeconds: 15,
});
export const RITUAL_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type RitualImageType = (typeof RITUAL_IMAGE_TYPES)[number];
/** Immutable client claims; storage locations, owners and grants are never client fields. */
export interface InitiateRitualUpload {
  version: 1;
  operationId: string;
  expectedActorId: string;
  ritualId: string;
  filename: string;
  byteSize: number;
  contentType: RitualImageType;
  sha256: string;
}
/** Retain this request over an uncertain response; it never identifies a client-selected storage key. */
export interface FinalizeRitualUpload {
  version: 1;
  operationId: string;
  expectedActorId: string;
}
/** A short-lived bearer credential; never persist in ritual source, receipts or offline bundles. */
export type DirectRitualUpload =
  | {
      kind: "presigned-post";
      url: string;
      fields: Record<string, string>;
      expiresAtMs: number;
    }
  | {
      kind: "presigned-put";
      url: string;
      headers: Record<string, string>;
      expiresAtMs: number;
    };
/** Stable command outcome. An existing receipt never restores a removed attachment or access. */
export interface RitualUploadReceipt {
  operationId: string;
  actorId: string;
  ritualId: string;
  fileId: string;
  attachmentId: string;
  sha256: string;
  byteSize: number;
  contentType: RitualImageType;
  completedAtMs: number;
}
export type RitualUploadCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "ACTOR_CHANGED"
  | "FORBIDDEN"
  | "EXPIRED"
  | "BUSY"
  | "NOT_UPLOADED"
  | "TOO_LARGE"
  | "SIZE_MISMATCH"
  | "DIGEST_MISMATCH"
  | "UNSUPPORTED_TYPE"
  | "UNSUPPORTED_ANIMATION"
  | "INVALID_IMAGE"
  | "IMAGE_LIMIT"
  | "DUPLICATE"
  | "ABORTED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "OPERATION_CONFLICT";
export type RitualUploadResult =
  | { ok: true; replayed: boolean; receipt: RitualUploadReceipt }
  | { ok: false; code: RitualUploadCode; retryable: boolean };
/** Initiation returns either an expiring bearer capability or an authorized completed replay. */
export type RitualUploadInitiateResult =
  | {
      ok: true;
      state: "upload";
      replayed: boolean;
      upload: DirectRitualUpload;
    }
  | {
      ok: true;
      state: "completed";
      replayed: true;
      receipt: RitualUploadReceipt;
    }
  | { ok: false; code: RitualUploadCode; retryable: boolean };
/** Safe domain failure. Provider/decoder exceptions and their messages must never reach callers. */
export class RitualUploadError extends Error {
  constructor(public readonly code: RitualUploadCode) {
    super(code);
    this.name = "RitualUploadError";
  }
}
export function isCanonicalUploadId(value: unknown): value is string {
  return isUuidV7(value) && value === value.toLowerCase();
}
export function isRitualImageType(value: unknown): value is RitualImageType {
  return RITUAL_IMAGE_TYPES.includes(value as RitualImageType);
}
function record(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const names = Object.getOwnPropertyNames(value);
  return (
    names.length === keys.length &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    names.every(
      (key) =>
        keys.includes(key) &&
        Object.hasOwn(
          Object.getOwnPropertyDescriptor(value, key) ?? {},
          "value",
        ),
    )
  );
}
export function parseFinalizeRitualUpload(
  value: unknown,
): FinalizeRitualUpload | null {
  if (
    !record(value, ["version", "operationId", "expectedActorId"]) ||
    value.version !== 1 ||
    !isCanonicalUploadId(value.operationId) ||
    !isCanonicalUploadId(value.expectedActorId)
  )
    return null;
  return {
    version: 1,
    operationId: value.operationId,
    expectedActorId: value.expectedActorId,
  };
}
/** Performs request-shape validation only; the verified actor and current SQL policy remain authoritative. */
export function parseInitiateRitualUpload(
  value: unknown,
): InitiateRitualUpload | null {
  if (
    !record(value, [
      "version",
      "operationId",
      "expectedActorId",
      "ritualId",
      "filename",
      "byteSize",
      "contentType",
      "sha256",
    ]) ||
    value.version !== 1 ||
    !isCanonicalUploadId(value.operationId) ||
    !isCanonicalUploadId(value.expectedActorId) ||
    !isCanonicalUploadId(value.ritualId) ||
    typeof value.filename !== "string" ||
    !value.filename.trim() ||
    value.filename.length > 1024 ||
    !value.filename.isWellFormed() ||
    value.filename.includes("\0") ||
    typeof value.byteSize !== "number" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > RITUAL_UPLOAD_MAX_BYTES ||
    !isRitualImageType(value.contentType) ||
    typeof value.sha256 !== "string" ||
    !isSha256Hex(value.sha256) ||
    value.sha256 !== value.sha256.toLowerCase()
  )
    return null;
  return {
    version: 1,
    operationId: value.operationId,
    expectedActorId: value.expectedActorId,
    ritualId: value.ritualId,
    filename: value.filename,
    byteSize: value.byteSize,
    contentType: value.contentType,
    sha256: value.sha256,
  };
}
