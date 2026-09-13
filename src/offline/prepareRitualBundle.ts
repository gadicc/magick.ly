import "server-only";
import { createHash } from "node:crypto";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import type { RitualRenderDescriptorV1 } from "./permissionContract";
import type { RitualAssetPlan } from "./ritualAssetPlan";
import type { RitualAssetPlanMetadata } from "./ritualAssetPlanTypes";
import {
  parseRitualBundleManifest,
  RITUAL_BUNDLE_MANIFEST_LIMITS,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";

const TIMEOUT_MS = 30_000;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Persist these identities before provider writes; retries must reuse them. */
export interface RitualBundleIdentity {
  bundleId: string;
  /** Corresponds to the immutable plan's asset order. */
  assetKeys: readonly string[];
}

/**
 * Owned server preparation, never proof of publication, permission or download
 * readiness. The private plan includes provenance that must stay out of delivery.
 */
export interface PreparedRitualBundle {
  readonly kind: "prepared";
  readonly manifest: RitualBundleManifestV1;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly plan: RitualAssetPlanMetadata;
  copyBytes(assetKey: string): Uint8Array | null;
  dispose(): void;
}

/** Safe preparation failures contain no protected text, references or byte content. */
export class PrepareRitualBundleError extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "INCOMPLETE"
      | "SNAPSHOT_MISMATCH"
      | "ABORTED"
      | "TIMEOUT",
  ) {
    super(code);
    this.name = "PrepareRitualBundleError";
  }
}
function fail(code: PrepareRitualBundleError["code"]): never {
  throw new PrepareRitualBundleError(code);
}

/**
 * Bind a trusted owned image plan to the exact selected-render descriptor and
 * recheck all copied bytes. The caller selects content in an authorized SQL
 * snapshot; this helper neither authenticates nor invents a grant. A publisher
 * must recheck that selection and current access after durable object writes.
 *
 * Omit identity only for a new preparation. Capture its IDs before starting
 * durable work; an uncertain publication must not allocate a replacement bundle.
 * The deadline is cooperative and does not interrupt synchronous hashing.
 */
export async function prepareRitualBundle(options: {
  ritualId: string;
  descriptor: RitualRenderDescriptorV1;
  title: string;
  contentJson: string;
  plan: RitualAssetPlan;
  identity?: RitualBundleIdentity;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PreparedRitualBundle> {
  const captured = new Map<string, Uint8Array>();
  const dispose = () => {
    for (const bytes of captured.values()) bytes.fill(0);
    captured.clear();
  };
  try {
    const started = performance.now();
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    const signal = options.signal;
    const check = () => {
      if (signal?.aborted) fail("ABORTED");
      if (performance.now() - started >= timeoutMs) fail("TIMEOUT");
    };
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > TIMEOUT_MS ||
      !id(options.ritualId) ||
      typeof options.title !== "string" ||
      !options.title.isWellFormed() ||
      Buffer.byteLength(options.title) >
        RITUAL_BUNDLE_MANIFEST_LIMITS.titleBytes ||
      typeof options.contentJson !== "string" ||
      !options.contentJson.isWellFormed() ||
      Buffer.byteLength(options.contentJson) >
        RITUAL_BUNDLE_MANIFEST_LIMITS.renderedBytes
    )
      fail("INVALID_INPUT");
    check();
    // Nothing supplied by the caller may change across an await, including nested
    // provenance and explicitly reserved UUIDs. Do not freeze the caller's objects.
    const ritualId = options.ritualId;
    const title = options.title;
    const contentJson = options.contentJson;
    const descriptor = structuredClone(options.descriptor);
    const sourcePlan = options.plan;
    const plan = structuredClone(sourcePlan.metadata);
    if (
      plan.profile !== "magickli-ritual-asset-plan-v4" ||
      plan.inventoryProfile !== "magickli-jrt-assets-v2" ||
      !digest(plan.sha256) ||
      !digest(plan.validationSha256) ||
      !Array.isArray(plan.assets) ||
      plan.assets.length > RITUAL_BUNDLE_MANIFEST_LIMITS.assets ||
      !Array.isArray(plan.occurrences) ||
      plan.occurrences.length > RITUAL_BUNDLE_MANIFEST_LIMITS.occurrences ||
      !Array.isArray(plan.issues)
    )
      fail("INVALID_INPUT");
    if (plan.resolutionComplete !== true || plan.issues.length)
      fail("INCOMPLETE");
    const { sha256: planSha256, ...planIdentity } = plan;
    if (
      hash(JSON.stringify(planIdentity)) !== planSha256 ||
      hash(contentJson) !== plan.contentSha256 ||
      descriptor?.contentSha256 !== plan.contentSha256
    )
      fail("SNAPSHOT_MISMATCH");
    const identity = options.identity
      ? structuredClone(options.identity)
      : {
          bundleId: createUuidV7(),
          assetKeys: plan.assets.map(() => createUuidV7()),
        };
    if (
      !id(identity.bundleId) ||
      !Array.isArray(identity.assetKeys) ||
      identity.assetKeys.length !== plan.assets.length ||
      Array.from(identity.assetKeys).some((key) => !id(key)) ||
      new Set([identity.bundleId, ...identity.assetKeys]).size !==
        plan.assets.length + 1
    )
      fail("INVALID_INPUT");
    const manifestInput: RitualBundleManifestV1 = {
      version: 1,
      bundleId: identity.bundleId,
      ritualId,
      descriptor,
      title,
      renderedJson: contentJson,
      assets: plan.assets.map((asset, index) => ({
        key: identity.assetKeys[index],
        reference: asset.networkReference,
        sha256: asset.sha256,
        mime: asset.mime,
        bytes: asset.bytes,
        purpose: "read",
      })),
      occurrences: plan.occurrences.map((item) => {
        if (
          item.assetIndex === null ||
          !Number.isSafeInteger(item.assetIndex) ||
          item.assetIndex < 0 ||
          item.assetIndex >= plan.assets.length
        )
          fail("INCOMPLETE");
        return {
          path: item.path,
          src: item.src,
          displayFragment: item.displayFragment,
          assetKey: identity.assetKeys[item.assetIndex],
        };
      }),
    };
    const manifestJson = JSON.stringify(manifestInput);
    if (
      Buffer.byteLength(manifestJson) >
      RITUAL_BUNDLE_MANIFEST_LIMITS.manifestBytes
    )
      fail("INVALID_INPUT");
    const manifestSha256 = hash(manifestJson);
    const manifest = await parseRitualBundleManifest(manifestJson, {
      manifestSha256,
      bundleId: identity.bundleId,
      ritualId,
      descriptor,
    });
    check();
    if (!manifest) fail("INCOMPLETE");
    // The parser already bounds the complete declared batch before any copy.
    for (let index = 0; index < manifest.assets.length; index++) {
      check();
      const asset = manifest.assets[index];
      let bytes: Uint8Array | undefined;
      try {
        let copied: Uint8Array | null;
        try {
          copied = sourcePlan.copyBytes(index);
        } catch {
          fail("INCOMPLETE");
        }
        if (!(copied instanceof Uint8Array)) fail("INCOMPLETE");
        bytes = copied;
        if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
          fail("SNAPSHOT_MISMATCH");
        check();
        captured.set(asset.key, bytes);
        bytes = undefined;
      } finally {
        bytes?.fill(0);
      }
    }
    check();
    return Object.freeze({
      kind: "prepared" as const,
      manifest: freeze(manifest),
      manifestJson,
      manifestSha256,
      plan: freeze(plan),
      copyBytes(assetKey: string) {
        const bytes = captured.get(assetKey);
        return bytes ? Uint8Array.from(bytes) : null;
      },
      dispose,
    });
  } catch (error) {
    dispose();
    if (error instanceof PrepareRitualBundleError) throw error;
    fail("INVALID_INPUT");
  }
}
