import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { RitualBundleAssetMime } from "./ritualBundleManifest";
import type {
  RitualBundleAssetReadRequest,
  SqlRitualBundleAsset,
} from "./sqlRitualBundleReads";

/** SQL verifies the current session, grants, selected output and complete publication. */
export interface RitualBundleAssetReader {
  getAsset(
    request: RitualBundleAssetReadRequest,
  ): Promise<SqlRitualBundleAsset | null>;
}

/** Transfers ownership of fully verified bytes to the caller; no permission is implied. */
export interface RitualBundleAssetStorageReader {
  readAsset(
    asset: SqlRitualBundleAsset,
    signal: AbortSignal,
  ): Promise<Uint8Array | null>;
}

/** Caller owns the byte buffer. This result contains neither a storage URL nor an offline lease. */
export interface AuthorizedRitualBundleAsset {
  body: Uint8Array;
  contentType: RitualBundleAssetMime;
  byteSize: number;
  sha256: string;
}

/**
 * Inactive private download service: authorize, read the exact owned object, then
 * reauthorize the complete binding before exposing bytes. Never stream unverified
 * or formerly authorized bytes. An unsuccessful read returns null, not an offline
 * revocation instruction. HTTP cache/response policy belongs to the later route.
 * All failure, cancellation and late completion paths wipe owned byte buffers.
 */
export async function readRitualBundleAsset(
  reader: RitualBundleAssetReader,
  storage: RitualBundleAssetStorageReader,
  input: RitualBundleAssetReadRequest,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AuthorizedRitualBundleAsset | null> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw new RangeError("Invalid ritual asset read timeout");
  const controller = new AbortController();
  const parent = options.signal;
  const abort = () => controller.abort();
  const started = performance.now();
  const timer = setTimeout(abort, timeoutMs);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  let finished = false;
  const owned: { bytes: Uint8Array | null } = { bytes: null };
  const active = () => {
    if (performance.now() - started >= timeoutMs) abort();
    return !controller.signal.aborted;
  };
  function wait<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new Error("Asset read interrupted"));
      promise
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", aborted));
      if (!active()) aborted();
      else controller.signal.addEventListener("abort", aborted, { once: true });
    });
  }
  try {
    const bound = structuredClone(input);
    if (!active()) return null;
    const selected = await wait(reader.getAsset(structuredClone(bound)));
    if (!selected || !active()) return null;
    const before = structuredClone(selected);
    if (
      before.expectedActorId !== bound.expectedActorId ||
      before.ritualId !== bound.ritualId ||
      before.bundleId !== bound.bundleId ||
      before.assetKey !== bound.assetKey
    )
      return null;
    const received = await wait(
      storage
        .readAsset(structuredClone(before), controller.signal)
        .then((value) => {
          if (finished || !active()) value?.fill(0);
          else owned.bytes = value;
          return value;
        }),
    );
    if (
      !received ||
      !active() ||
      received.byteLength !== before.byteSize ||
      createHash("sha256").update(received).digest("hex") !== before.sha256
    )
      return null;
    const after = await wait(reader.getAsset(structuredClone(bound)));
    if (!active() || !after || !isDeepStrictEqual(before, after)) return null;
    // Transfer ownership only after the second current-access check succeeds.
    owned.bytes = null;
    return {
      body: received,
      contentType: before.mime,
      byteSize: before.byteSize,
      sha256: before.sha256,
    };
  } catch {
    return null;
  } finally {
    finished = true;
    controller.abort();
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    owned.bytes?.fill(0);
  }
}
