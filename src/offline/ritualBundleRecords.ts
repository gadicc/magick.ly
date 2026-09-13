import "server-only";
import type {
  ritualBundleAssets,
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../db/schema/ritualBundles";
import { RITUAL_IMAGE_LIMITS } from "../files/ritualUploadProtocol";
import {
  RITUAL_SVG_LIMITS,
  RITUAL_SVG_PROFILE,
} from "../files/validateRitualSvg";
import { isUuidV7 } from "../lib/ids";
import {
  parseRitualBundleManifest,
  RITUAL_BUNDLE_MANIFEST_LIMITS,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";
import {
  bundleTextSha256,
  isRitualBundlePublicationPolicyId,
  parseRitualBundleStorageReceipt,
  RITUAL_BUNDLE_LOCATION_LIMITS,
  RITUAL_BUNDLE_PUBLICATION_LIMITS,
  type RitualBundleAssetReservation,
  ritualBundleRequestHash,
} from "./ritualBundlePublication";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

type Intent = typeof ritualBundlePublicationIntents.$inferSelect;
type AssetRow = typeof ritualBundleAssets.$inferSelect;
type Completed = typeof ritualBundles.$inferSelect;
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  !Object.is(value, -0) &&
  value >= minimum &&
  value <= maximum;
const dateMs = (value: unknown): number | null =>
  value instanceof Date && integer(value.getTime()) ? value.getTime() : null;
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.length <= maximum &&
  value.isWellFormed() &&
  Buffer.byteLength(value) <= maximum;

function raster(row: Row) {
  return (
    integer(row.width, 1, RITUAL_IMAGE_LIMITS.maxDimension) &&
    integer(row.frameHeight, 1, RITUAL_IMAGE_LIMITS.maxDimension) &&
    integer(row.frames, 1, RITUAL_IMAGE_LIMITS.maxFrames) &&
    integer(row.decodedPixels, 1, RITUAL_IMAGE_LIMITS.maxPixels) &&
    row.decodedPixels === row.width * row.frameHeight * row.frames
  );
}
function imageFacts(row: Row) {
  if (row.validationKind === "raster")
    return row.mime !== "image/svg+xml" && raster(row);
  if (
    row.validationKind !== "svg" ||
    row.mime !== "image/svg+xml" ||
    row.svgProfile !== RITUAL_SVG_PROFILE ||
    !integer(row.elements, 1, RITUAL_SVG_LIMITS.elements) ||
    !integer(row.localReferences, 0, RITUAL_SVG_LIMITS.references) ||
    !integer(row.expandedElements, 1, RITUAL_SVG_LIMITS.expandedElements) ||
    !Array.isArray(row.embeddedRasters) ||
    row.embeddedRasters.length > RITUAL_SVG_LIMITS.embeddedImages ||
    row.localReferences + row.embeddedRasters.length >
      RITUAL_SVG_LIMITS.references
  )
    return false;
  let bytes = 0,
    pixels = 0;
  for (const item of row.embeddedRasters) {
    if (
      !record(item) ||
      !hash(item.sha256) ||
      !integer(item.byteSize, 1, RITUAL_SVG_LIMITS.embeddedBytes) ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        item.contentType as string,
      ) ||
      !raster(item)
    )
      return false;
    bytes += item.byteSize;
    pixels += item.decodedPixels as number;
    if (
      bytes > RITUAL_SVG_LIMITS.embeddedBytes ||
      pixels > RITUAL_SVG_LIMITS.embeddedPixels
    )
      return false;
  }
  return true;
}

/**
 * Decode stored evidence without authorization, image redecoding or provider I/O.
 * Pending reservations require all receipt fields null; completed records require
 * the full historically fenced receipt set. Snapshot inputs before async hashing.
 * The private plan stays private and never enters the returned wire projection.
 */
export async function decodeRitualBundleRecords(
  sourceIntent: Intent,
  sourceRows: AssetRow[],
  sourceCompleted?: Completed,
): Promise<{
  manifest: RitualBundleManifestV1;
  reservations: RitualBundleAssetReservation[];
} | null> {
  try {
    if (
      !sourceIntent ||
      !Array.isArray(sourceRows) ||
      sourceRows.length > RITUAL_BUNDLE_MANIFEST_LIMITS.assets ||
      !text(
        sourceIntent.manifestJson,
        RITUAL_BUNDLE_MANIFEST_LIMITS.manifestBytes,
      ) ||
      !text(sourceIntent.planJson, RITUAL_BUNDLE_PUBLICATION_LIMITS.planBytes)
    )
      return null;
    const intent = structuredClone(sourceIntent),
      rows = structuredClone(sourceRows),
      completed = structuredClone(sourceCompleted);
    if (
      ![
        intent.operationId,
        intent.actorId,
        intent.bundleId,
        intent.ritualId,
        intent.currentRevisionId,
      ].every(id) ||
      (intent.currentCompiledArtifactId !== null &&
        !id(intent.currentCompiledArtifactId)) ||
      !integer(intent.parentVersion) ||
      !isRitualBundlePublicationPolicyId(intent.publicationPolicyId) ||
      ![
        intent.descriptorSha256,
        intent.contentSha256,
        intent.manifestSha256,
        intent.planSha256,
        intent.requestHash,
      ].every(hash) ||
      ritualBundleRequestHash(intent) !== intent.requestHash ||
      bundleTextSha256(intent.planJson) !== intent.planSha256
    )
      return null;
    const createdAt = dateMs(intent.createdAt),
      expiresAt = dateMs(intent.expiresAt),
      claimStartedAt = dateMs(intent.claimStartedAt),
      claimExpiresAt = dateMs(intent.claimExpiresAt);
    if (
      createdAt === null ||
      expiresAt === null ||
      expiresAt <= createdAt ||
      expiresAt - createdAt > RITUAL_BUNDLE_PUBLICATION_LIMITS.intentMs
    )
      return null;
    const unclaimed =
      intent.claimId === null &&
      intent.claimStartedAt === null &&
      intent.claimExpiresAt === null;
    if (
      !unclaimed &&
      (!id(intent.claimId) ||
        claimStartedAt === null ||
        claimExpiresAt === null ||
        claimStartedAt < createdAt ||
        claimExpiresAt <= claimStartedAt ||
        claimExpiresAt > expiresAt ||
        claimExpiresAt - claimStartedAt >
          RITUAL_BUNDLE_PUBLICATION_LIMITS.claimMs)
    )
      return null;
    const descriptor = createRitualRenderDescriptor(
      {
        id: intent.ritualId,
        currentRevisionId: intent.currentRevisionId,
        currentCompiledArtifactId: intent.currentCompiledArtifactId,
        version: intent.parentVersion,
      },
      { contentSha256: intent.contentSha256 },
    );
    if (descriptor.descriptorSha256 !== intent.descriptorSha256) return null;
    const manifest = await parseRitualBundleManifest(intent.manifestJson, {
      manifestSha256: intent.manifestSha256,
      bundleId: intent.bundleId,
      ritualId: intent.ritualId,
      descriptor,
    });
    if (!manifest) return null;
    const plan: unknown = JSON.parse(intent.planJson);
    if (
      !record(plan) ||
      JSON.stringify(plan) !== intent.planJson ||
      Object.hasOwn(plan, "sha256") ||
      plan.profile !== "magickli-ritual-asset-plan-v4" ||
      plan.inventoryProfile !== "magickli-jrt-assets-v2" ||
      plan.contentSha256 !== intent.contentSha256 ||
      !hash(plan.staticCatalogSha256) ||
      !hash(plan.validationSha256) ||
      ![
        plan.legacyCatalogSha256,
        plan.externalCatalogSha256,
        plan.generatedCatalogSha256,
      ].every((v) => v === null || hash(v)) ||
      plan.resolutionComplete !== true ||
      !Array.isArray(plan.issues) ||
      plan.issues.length !== 0 ||
      !Array.isArray(plan.assets) ||
      plan.assets.length !== manifest.assets.length ||
      !Array.isArray(plan.occurrences) ||
      plan.occurrences.length !== manifest.occurrences.length
    )
      return null;
    for (let index = 0; index < plan.assets.length; index++) {
      const asset = plan.assets[index],
        expected = manifest.assets[index];
      if (
        !record(asset) ||
        asset.networkReference !== expected.reference ||
        asset.sha256 !== expected.sha256 ||
        asset.mime !== expected.mime ||
        asset.bytes !== expected.bytes ||
        !imageFacts(asset) ||
        !record(asset.provenance) ||
        ![
          "static",
          "inline",
          "legacy-public",
          "external",
          "generated",
        ].includes(asset.provenance.kind as string)
      )
        return null;
    }
    for (let index = 0; index < plan.occurrences.length; index++) {
      const occurrence = plan.occurrences[index],
        expected = manifest.occurrences[index];
      if (
        !record(occurrence) ||
        !integer(occurrence.assetIndex, 0, manifest.assets.length - 1) ||
        manifest.assets[occurrence.assetIndex].key !== expected.assetKey ||
        occurrence.src !== expected.src ||
        occurrence.displayFragment !== expected.displayFragment ||
        JSON.stringify(occurrence.path) !== JSON.stringify(expected.path)
      )
        return null;
    }
    let publishedAt: number | null = null;
    if (completed !== undefined) {
      publishedAt = dateMs(completed.publishedAt);
      if (
        completed.operationId !== intent.operationId ||
        completed.bundleId !== intent.bundleId ||
        completed.ritualId !== intent.ritualId ||
        completed.currentRevisionId !== intent.currentRevisionId ||
        dateMs(intent.completedAt) !== publishedAt ||
        publishedAt === null ||
        claimStartedAt === null ||
        claimExpiresAt === null ||
        !id(intent.claimId) ||
        publishedAt < claimStartedAt ||
        publishedAt >= claimExpiresAt
      )
        return null;
    } else if (intent.completedAt !== null) return null;
    if (rows.length !== manifest.assets.length) return null;
    const reservations: RitualBundleAssetReservation[] = [];
    const locations = new Set<string>();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index],
        expected = manifest.assets[index];
      if (
        !row ||
        row.operationId !== intent.operationId ||
        row.bundleId !== intent.bundleId ||
        row.ritualId !== intent.ritualId ||
        row.assetIndex !== index ||
        row.key !== expected.key ||
        row.key === intent.bundleId ||
        row.reference !== expected.reference ||
        row.sha256 !== expected.sha256 ||
        row.mime !== expected.mime ||
        row.byteSize !== expected.bytes
      )
        return null;
      for (const field of ["storageProvider", "bucket", "objectKey"] as const)
        if (
          !text(row[field], RITUAL_BUNDLE_LOCATION_LIMITS[field]) ||
          !row[field] ||
          row[field].includes("\0") ||
          (field !== "objectKey" && !row[field].trim())
        )
          return null;
      const location = JSON.stringify([
        row.storageProvider,
        row.bucket,
        row.objectKey,
      ]);
      if (locations.has(location)) return null;
      locations.add(location);
      if (completed === undefined) {
        if (
          row.receiptJson !== null ||
          row.receiptSha256 !== null ||
          row.verifiedAt !== null
        )
          return null;
      } else {
        const receipt = parseRitualBundleStorageReceipt(
          row.receiptJson,
          row.receiptSha256,
          {
            ...row,
            claimId: intent.claimId!,
            claimStartedAtMs: claimStartedAt!,
            claimExpiresAtMs: claimExpiresAt!,
          },
        );
        if (
          !receipt ||
          dateMs(row.verifiedAt) !== receipt.verifiedAtMs ||
          receipt.verifiedAtMs > publishedAt!
        )
          return null;
      }
      reservations.push({
        operationId: row.operationId,
        bundleId: row.bundleId,
        ritualId: row.ritualId,
        key: row.key,
        assetIndex: row.assetIndex,
        reference: row.reference,
        sha256: row.sha256,
        mime: row.mime,
        byteSize: row.byteSize,
        storageProvider: row.storageProvider,
        bucket: row.bucket,
        objectKey: row.objectKey,
      });
    }
    return { manifest, reservations };
  } catch {
    return null;
  }
}
