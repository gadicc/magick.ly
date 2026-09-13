"use client";

import { isUuidV7 } from "../lib/ids";
import {
  parseRitualPermissionRequest,
  type RitualPermissionRequestV1,
} from "./permissionContract";
import {
  RITUAL_BUNDLE_MANIFEST_LIMITS,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";
import {
  type AcceptedRitualDelivery,
  parseRitualDeliveryResponse,
} from "./ritualDeliveryContract";

const DELIVERY_PATH = "/api/rituals/permission";
const MAX_DELIVERY_BYTES = 17 * 1024 * 1024;

function noStore(response: Response): boolean {
  return (
    response.headers
      .get("cache-control")
      ?.toLowerCase()
      .split(",")
      .some((value) => value.trim() === "no-store") === true
  );
}

function exactResponse(response: Response, path: string): boolean {
  try {
    const url = new URL(response.url);
    return (
      !response.redirected &&
      url.origin === location.origin &&
      url.pathname === path &&
      url.search === "" &&
      noStore(response)
    );
  } catch {
    return false;
  }
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new Error("Response too large");
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("Response too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

/** Fetch and validate the one permission/manifest envelope; failures do not revoke. */
export async function fetchRitualDelivery(
  request: RitualPermissionRequestV1,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  routeAlias: string | null = null,
): Promise<AcceptedRitualDelivery | null> {
  const input = parseRitualPermissionRequest(request);
  if (!input) return null;
  try {
    const response = await fetcher(DELIVERY_PATH, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(routeAlias ? { "X-Magickli-Ritual-Alias": routeAlias } : {}),
      },
      body: JSON.stringify(input),
    });
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    const exact =
      exactResponse(response, DELIVERY_PATH) &&
      mediaType === "application/json";
    const body = exact
      ? JSON.parse(await boundedText(response, MAX_DELIVERY_BYTES))
      : null;
    return parseRitualDeliveryResponse(
      input,
      body,
      {
        status: response.status,
        sameOrigin: exact,
        uncached: exact,
      },
      routeAlias,
    );
  } catch {
    return parseRitualDeliveryResponse(
      input,
      null,
      {
        status: 0,
        sameOrigin: false,
        uncached: false,
      },
      routeAlias,
    );
  }
}

async function sha256(blob: Blob): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function assetBlob(
  response: Response,
  bytes: number,
  mime: string,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (signal.aborted || size > bytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Uint8Array.from(next.value).buffer);
    }
    return size === bytes && !signal.aborted
      ? new Blob(chunks, { type: mime })
      : null;
  } finally {
    reader.releaseLock();
  }
}

/** Fetch one exact manifest member. Original ritual URLs are never network inputs here. */
export async function fetchRitualAsset(
  ownerId: string,
  ritualId: string,
  bundleId: string,
  asset: RitualBundleManifestV1["assets"][number],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Blob | null> {
  const canonical = (value: unknown): value is string =>
    typeof value === "string" &&
    isUuidV7(value) &&
    value === value.toLowerCase();
  if (
    !canonical(ownerId) ||
    !canonical(ritualId) ||
    !canonical(bundleId) ||
    !canonical(asset.key) ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    ![
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ].includes(asset.mime) ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 1 ||
    asset.bytes >
      (asset.mime === "image/svg+xml"
        ? RITUAL_BUNDLE_MANIFEST_LIMITS.svgBytes
        : RITUAL_BUNDLE_MANIFEST_LIMITS.rasterBytes) ||
    asset.purpose !== "read"
  )
    return null;
  const path = `/api/rituals/assets/${ritualId}/${bundleId}/${asset.key}`;
  try {
    const response = await fetcher(path, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        Accept: asset.mime,
        "X-Magickli-Expected-Actor": ownerId,
      },
    });
    if (
      response.status !== 200 ||
      !exactResponse(response, path) ||
      response.headers.get("content-type") !== asset.mime ||
      // Fetch decodes gzip/br bodies, while Content-Length may still describe
      // their wire representation. Bound and hash the decoded bytes below.
      (response.headers.get("content-encoding") === null &&
        response.headers.get("content-length") !== String(asset.bytes)) ||
      response.headers.get("x-content-sha256") !== asset.sha256
    )
      return null;
    const blob = await assetBlob(response, asset.bytes, asset.mime, signal);
    if (
      !blob ||
      signal.aborted ||
      blob.size !== asset.bytes ||
      blob.type !== asset.mime ||
      (await sha256(blob)) !== asset.sha256
    )
      return null;
    return blob;
  } catch {
    return null;
  }
}
