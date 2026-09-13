import "server-only";
import { createHash } from "node:crypto";
import { isUuidV7 } from "../lib/ids";
import type { RitualBundleAssetMime } from "./ritualBundleManifest";

/** Persisted worker timing; neither interval is an offline authorization lease. */
export const RITUAL_BUNDLE_PUBLICATION_LIMITS = Object.freeze({
  intentMs: 24 * 60 * 60 * 1000,
  claimMs: 120_000,
  planBytes: 16 * 1024 * 1024,
});
/** Fits the reserved PostgreSQL unique destination index and S3/R2 key limits. */
export const RITUAL_BUNDLE_LOCATION_LIMITS = Object.freeze({
  storageProvider: 128,
  bucket: 255,
  objectKey: 1024,
});

/** Explicit, private provider identity. Never return this as a browser asset URL. */
export interface RitualBundleLocation {
  storageProvider: string;
  bucket: string;
  objectKey: string;
}

/** Exact durable reservation, created before provider I/O. No global hash ownership. */
export interface RitualBundleAssetReservation extends RitualBundleLocation {
  operationId: string;
  bundleId: string;
  ritualId: string;
  key: string;
  assetIndex: number;
  reference: string;
  sha256: string;
  mime: RitualBundleAssetMime;
  byteSize: number;
}

/**
 * Trusted storage adapter's byte-verification result. A fresh claim must verify
 * the exact owned object again; a provider ETag or client assertion is not proof.
 * SQL receipt validation does not contact storage or establish continued access.
 */
export interface RitualBundleStorageReceiptV1 extends RitualBundleLocation {
  profile: "magickli-ritual-bundle-object-receipt-v1";
  operationId: string;
  bundleId: string;
  assetKey: string;
  claimId: string;
  sha256: string;
  byteSize: number;
  mime: RitualBundleAssetMime;
  verifiedAtMs: number;
}

/** Explicit server configuration controls which publication generations a reader accepts. */
export function isRitualBundlePublicationPolicyId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)
  );
}

/** Exact UTF-8 text hash shared by persisted payload and receipt checks. */
export function bundleTextSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Immutable retry identity; changing payload or policy requires a new explicit operation. */
export function ritualBundleRequestHash(value: {
  operationId: string;
  actorId: string;
  manifestSha256: string;
  planSha256: string;
  publicationPolicyId: string;
}): string {
  return bundleTextSha256(
    JSON.stringify([
      "magickli-ritual-bundle-publication-request-v1",
      value.operationId,
      value.actorId,
      value.manifestSha256,
      value.planSha256,
      value.publicationPolicyId,
    ]),
  );
}

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
const keys = [
  "profile",
  "operationId",
  "bundleId",
  "assetKey",
  "claimId",
  "storageProvider",
  "bucket",
  "objectKey",
  "sha256",
  "byteSize",
  "mime",
  "verifiedAtMs",
];

/** Complete expected reservation/claim; received JSON never supplies its own authority. */
export type ExpectedRitualBundleStorageReceipt = Pick<
  RitualBundleAssetReservation,
  | "operationId"
  | "bundleId"
  | "key"
  | "storageProvider"
  | "bucket"
  | "objectKey"
  | "sha256"
  | "byteSize"
  | "mime"
> & {
  claimId: string;
  claimStartedAtMs: number;
  claimExpiresAtMs: number;
};

/** Parses bounded exact stored JSON and matches every field to the reservation and current claim. */
export function parseRitualBundleStorageReceipt(
  receiptJson: unknown,
  receiptSha256: unknown,
  expected: ExpectedRitualBundleStorageReceipt,
): RitualBundleStorageReceiptV1 | null {
  try {
    if (
      typeof receiptJson !== "string" ||
      receiptJson.length > 16 * 1024 ||
      !receiptJson.isWellFormed() ||
      Buffer.byteLength(receiptJson) > 16 * 1024 ||
      !digest(receiptSha256) ||
      bundleTextSha256(receiptJson) !== receiptSha256
    )
      return null;
    const row: unknown = JSON.parse(receiptJson);
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      JSON.stringify(row) !== receiptJson ||
      Object.keys(row).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(row, key))
    )
      return null;
    const value = row as Record<string, unknown>;
    if (
      value.profile !== "magickli-ritual-bundle-object-receipt-v1" ||
      !id(value.operationId) ||
      value.operationId !== expected.operationId ||
      !id(value.bundleId) ||
      value.bundleId !== expected.bundleId ||
      !id(value.assetKey) ||
      value.assetKey !== expected.key ||
      !id(value.claimId) ||
      value.claimId !== expected.claimId ||
      !digest(value.sha256) ||
      value.sha256 !== expected.sha256 ||
      !Number.isSafeInteger(value.byteSize) ||
      typeof value.byteSize !== "number" ||
      value.byteSize < 1 ||
      value.byteSize !== expected.byteSize ||
      value.mime !== expected.mime ||
      ![
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml",
      ].includes(value.mime as string) ||
      !instant(value.verifiedAtMs) ||
      !instant(expected.claimStartedAtMs) ||
      !instant(expected.claimExpiresAtMs) ||
      value.verifiedAtMs < expected.claimStartedAtMs ||
      value.verifiedAtMs >= expected.claimExpiresAtMs
    )
      return null;
    for (const key of ["storageProvider", "bucket", "objectKey"] as const) {
      const field = value[key];
      if (
        typeof field !== "string" ||
        !field ||
        !field.isWellFormed() ||
        field.includes("\0") ||
        Buffer.byteLength(field) > RITUAL_BUNDLE_LOCATION_LIMITS[key] ||
        (key !== "objectKey" && !field.trim()) ||
        field !== expected[key]
      )
        return null;
    }
    return Object.freeze({
      ...value,
    }) as unknown as RitualBundleStorageReceiptV1;
  } catch {
    return null;
  }
}

/** Safe operation categories; raw database/provider messages must stay server-side. */
export class RitualBundlePublicationError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "AUTH_REQUIRED"
      | "ACTOR_CHANGED"
      | "FORBIDDEN"
      | "STALE"
      | "EXPIRED"
      | "BUSY"
      | "OPERATION_CONFLICT"
      | "INCOMPLETE"
      | "ABORTED"
      | "UNAVAILABLE",
  ) {
    super(code);
    this.name = "RitualBundlePublicationError";
  }
}

/** Immutable completed publication identity; it carries no offline or file permission. */
export interface RitualBundlePublicationReceipt {
  operationId: string;
  bundleId: string;
  ritualId: string;
  manifestSha256: string;
  descriptorSha256: string;
  publishedAtMs: number;
}

/** Worker fencing token and exact reserved objects; no source text or provider credentials. */
export interface RitualBundlePublicationClaim {
  operationId: string;
  actorId: string;
  bundleId: string;
  ritualId: string;
  manifestSha256: string;
  claimId: string;
  claimStartedAtMs: number;
  claimExpiresAtMs: number;
  intentExpiresAtMs: number;
  assets: readonly RitualBundleAssetReservation[];
}
