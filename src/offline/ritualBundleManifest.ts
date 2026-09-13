import { sha256Hex } from "@gadicc/loom/files/hash";
import { isUuidV7 } from "../lib/ids";
import type { RitualRenderDescriptorV1 } from "./permissionContract";
import {
  inventoryRitualAssetJson,
  RITUAL_ASSET_INVENTORY_LIMITS,
} from "./ritualAssetInventory";

/** Wire/capture bounds, independent of authorization or image-decoder working memory. */
export const RITUAL_BUNDLE_MANIFEST_LIMITS = Object.freeze({
  manifestBytes: 16 * 1024 * 1024,
  titleBytes: 64 * 1024,
  renderedBytes: 4 * 1024 * 1024,
  referenceBytes: 1024 * 1024,
  assets: 512,
  occurrences: 512,
  capturedBytes: 64 * 1024 * 1024,
  rasterBytes: 20 * 1024 * 1024,
  svgBytes: 4 * 1024 * 1024,
});

export type RitualBundleAssetMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml";

/** Immutable read payload. A manifest alone grants no access or download readiness. */
export interface RitualBundleManifestV1 {
  readonly version: 1;
  readonly bundleId: string;
  readonly ritualId: string;
  readonly descriptor: RitualRenderDescriptorV1;
  readonly title: string;
  readonly renderedJson: string;
  readonly assets: readonly Readonly<{
    key: string;
    reference: string;
    sha256: string;
    mime: RitualBundleAssetMime;
    bytes: number;
    purpose: "read";
  }>[];
  readonly occurrences: readonly Readonly<{
    /** Original child indices, not DOM image positions. */
    path: readonly number[];
    src: string;
    displayFragment: string;
    assetKey: string;
  }>[];
}

/** Expected binding comes from the separately validated authorized delivery envelope. */
export interface ExpectedRitualBundleManifest {
  manifestSha256: string;
  bundleId: string;
  ritualId: string;
  descriptor: RitualRenderDescriptorV1;
}

type RecordValue = Record<string, unknown>;
const encoder = new TextEncoder();
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const mime = (value: unknown): value is RitualBundleAssetMime =>
  value === "image/png" ||
  value === "image/jpeg" ||
  value === "image/gif" ||
  value === "image/webp" ||
  value === "image/svg+xml";

function shape(value: unknown, keys: readonly string[]): value is RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return !!property?.enumerable && "value" in property;
    })
  );
}

function boundedString(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= bytes &&
    value.isWellFormed() &&
    encoder.encode(value).byteLength <= bytes
  );
}

function descriptor(value: unknown): RitualRenderDescriptorV1 | null {
  if (
    !shape(value, [
      "descriptorSha256",
      "contentSha256",
      "outputFormat",
      "outputFormatVersion",
    ]) ||
    !hash(value.descriptorSha256) ||
    !hash(value.contentSha256) ||
    value.outputFormat !== "json-rich-text" ||
    value.outputFormatVersion !== "1"
  )
    return null;
  return {
    descriptorSha256: value.descriptorSha256,
    contentSha256: value.contentSha256,
    outputFormat: value.outputFormat,
    outputFormatVersion: value.outputFormatVersion,
  };
}

/**
 * Validate exact JSON.stringify envelope bytes and independently enumerate the
 * unchanged rendered body. Source references are display identities, never fetch
 * instructions. Declared local paths establish display-only catalog membership;
 * they do not establish storage provenance, byte validity or private-file access.
 * Expected bindings are copied before the first await. Every failure returns null.
 */
export async function parseRitualBundleManifest(
  manifestJson: unknown,
  expected: ExpectedRitualBundleManifest,
): Promise<RitualBundleManifestV1 | null> {
  try {
    if (
      !shape(expected, [
        "manifestSha256",
        "bundleId",
        "ritualId",
        "descriptor",
      ]) ||
      !hash(expected.manifestSha256) ||
      !id(expected.bundleId) ||
      !id(expected.ritualId)
    )
      return null;
    const expectedDescriptor = descriptor(expected.descriptor);
    if (!expectedDescriptor) return null;
    const binding = {
      manifestSha256: expected.manifestSha256,
      bundleId: expected.bundleId,
      ritualId: expected.ritualId,
      descriptor: expectedDescriptor,
    };
    const limits = RITUAL_BUNDLE_MANIFEST_LIMITS;
    if (!boundedString(manifestJson, limits.manifestBytes)) return null;
    const value: unknown = JSON.parse(manifestJson);
    // Reject duplicate keys/alternate escaping without touching nested body bytes.
    if (JSON.stringify(value) !== manifestJson) return null;
    if (
      !shape(value, [
        "version",
        "bundleId",
        "ritualId",
        "descriptor",
        "title",
        "renderedJson",
        "assets",
        "occurrences",
      ]) ||
      value.version !== 1 ||
      value.bundleId !== binding.bundleId ||
      value.ritualId !== binding.ritualId ||
      !boundedString(value.title, limits.titleBytes) ||
      !boundedString(value.renderedJson, limits.renderedBytes) ||
      !Array.isArray(value.assets) ||
      value.assets.length > limits.assets ||
      !Array.isArray(value.occurrences) ||
      value.occurrences.length > limits.occurrences
    )
      return null;
    const rendered = descriptor(value.descriptor);
    if (
      !rendered ||
      rendered.descriptorSha256 !== binding.descriptor.descriptorSha256 ||
      rendered.contentSha256 !== binding.descriptor.contentSha256
    )
      return null;
    const assets: RitualBundleManifestV1["assets"][number][] = [];
    const byKey = new Map<string, RitualBundleManifestV1["assets"][number]>();
    const references = new Set<string>();
    const staticPaths = new Set<string>();
    let capturedBytes = 0;
    for (const asset of value.assets) {
      if (
        !shape(asset, [
          "key",
          "reference",
          "sha256",
          "mime",
          "bytes",
          "purpose",
        ]) ||
        !id(asset.key) ||
        !boundedString(asset.reference, limits.referenceBytes) ||
        !asset.reference ||
        asset.reference.includes("#") ||
        !hash(asset.sha256) ||
        !mime(asset.mime) ||
        typeof asset.bytes !== "number" ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 1 ||
        asset.bytes >
          (asset.mime === "image/svg+xml"
            ? limits.svgBytes
            : limits.rasterBytes) ||
        asset.purpose !== "read" ||
        byKey.has(asset.key) ||
        references.has(asset.reference)
      )
        return null;
      capturedBytes += asset.bytes;
      if (capturedBytes > limits.capturedBytes) return null;
      const row = Object.freeze({
        key: asset.key,
        reference: asset.reference,
        sha256: asset.sha256,
        mime: asset.mime,
        bytes: asset.bytes,
        purpose: asset.purpose,
      });
      assets.push(row);
      byKey.set(row.key, row);
      references.add(row.reference);
      if (row.reference.startsWith("/") && !row.reference.startsWith("//"))
        staticPaths.add(row.reference.split("?", 1)[0]);
    }
    const inventory = inventoryRitualAssetJson(value.renderedJson, {
      knownAppOrigins: [],
      staticPaths: [...staticPaths],
    });
    if (
      !inventory.enumerationComplete ||
      inventory.issues.length !== 0 ||
      inventory.occurrences.length !== value.occurrences.length
    )
      return null;
    const actual = new Map(
      inventory.occurrences.map((row) => [JSON.stringify(row.path), row]),
    );
    const used = new Set<string>();
    const occurrences: RitualBundleManifestV1["occurrences"][number][] = [];
    for (const occurrence of value.occurrences) {
      if (
        !shape(occurrence, ["path", "src", "displayFragment", "assetKey"]) ||
        !Array.isArray(occurrence.path) ||
        occurrence.path.length > RITUAL_ASSET_INVENTORY_LIMITS.depth ||
        !occurrence.path.every(
          (index) => Number.isSafeInteger(index) && index >= 0,
        ) ||
        !boundedString(occurrence.src, limits.referenceBytes) ||
        !boundedString(occurrence.displayFragment, limits.referenceBytes) ||
        !id(occurrence.assetKey)
      )
        return null;
      const path = JSON.stringify(occurrence.path);
      const observed = actual.get(path);
      const asset = byKey.get(occurrence.assetKey);
      if (
        !observed ||
        !asset ||
        observed.src !== occurrence.src ||
        observed.displayFragment !== occurrence.displayFragment ||
        observed.networkReference !== asset.reference
      )
        return null;
      actual.delete(path);
      used.add(asset.key);
      occurrences.push(
        Object.freeze({
          path: Object.freeze([...occurrence.path]),
          src: occurrence.src,
          displayFragment: occurrence.displayFragment,
          assetKey: occurrence.assetKey,
        }),
      );
    }
    if (actual.size !== 0 || used.size !== assets.length) return null;
    if (
      (await sha256Hex(encoder.encode(manifestJson))) !==
        binding.manifestSha256 ||
      (await sha256Hex(encoder.encode(value.renderedJson))) !==
        rendered.contentSha256
    )
      return null;
    return Object.freeze({
      version: 1,
      bundleId: binding.bundleId,
      ritualId: binding.ritualId,
      descriptor: Object.freeze(rendered),
      title: value.title,
      renderedJson: value.renderedJson,
      assets: Object.freeze(assets),
      occurrences: Object.freeze(occurrences),
    });
  } catch {
    return null;
  }
}
