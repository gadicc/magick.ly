import { createHash } from "node:crypto";
import { isUuidV7 } from "../lib/ids";
import type { RitualBundleIdentity } from "./prepareRitualBundle";

const canonical = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

function bytes(value: string) {
  return Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
}

function format(value: Uint8Array) {
  const hex = Buffer.from(value).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derives stable UUIDv7 identities from a durable publication operation. The
 * timestamp bits remain those of the operation; SHA-256 supplies distinct random
 * fields for the bundle and every ordered asset.
 */
export function deriveRitualPublicationIdentity(
  operationId: string,
  assetCount: number,
): RitualBundleIdentity {
  if (
    !canonical(operationId) ||
    !Number.isSafeInteger(assetCount) ||
    assetCount < 0 ||
    assetCount > 512
  )
    throw new TypeError("Invalid ritual publication identity input");
  const timestamp = bytes(operationId).subarray(0, 6);
  const derive = (label: string) => {
    const value = Uint8Array.from(
      createHash("sha256")
        .update("magickli-ritual-publication-identity-v1\0")
        .update(operationId)
        .update("\0")
        .update(label)
        .digest()
        .subarray(0, 16),
    );
    value.set(timestamp, 0);
    value[6] = 0x70 | (value[6] & 0x0f);
    value[8] = 0x80 | (value[8] & 0x3f);
    const id = format(value);
    if (!canonical(id) || id === operationId)
      throw new Error("Ritual publication identity unavailable");
    return id;
  };
  const identity = {
    bundleId: derive("bundle"),
    assetKeys: Array.from({ length: assetCount }, (_, index) =>
      derive(`asset:${index}`),
    ),
  };
  if (
    new Set([identity.bundleId, ...identity.assetKeys]).size !==
    assetCount + 1
  )
    throw new Error("Ritual publication identity unavailable");
  return Object.freeze({
    bundleId: identity.bundleId,
    assetKeys: Object.freeze(identity.assetKeys),
  });
}
