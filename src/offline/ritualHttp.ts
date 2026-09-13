import "server-only";

import { isUuidV7 } from "../lib/ids";
import type { RitualPermissionResponseV1 } from "./permissionContract";
import { parseRitualPermissionRequest } from "./permissionContract";
import type { AuthorizedRitualBundleAsset } from "./readRitualBundleAsset";
import type { RitualDeliveryResponseV1 } from "./ritualDeliveryContract";
import type {
  RitualBundleAssetReadRequest,
  RitualBundleReadRequest,
  SqlRitualBundleManifest,
} from "./sqlRitualBundleReads";

const MAX_PERMISSION_REQUEST_BYTES = 4096;
const privateHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
});

export interface RitualHttpServices {
  resolveRouteAlias(alias: string): Promise<string | null>;
  checkPermission(input: unknown): Promise<RitualPermissionResponseV1 | null>;
  getManifest(
    input: RitualBundleReadRequest,
  ): Promise<SqlRitualBundleManifest | null>;
  readAsset(
    input: RitualBundleAssetReadRequest,
    signal: AbortSignal,
  ): Promise<AuthorizedRitualBundleAsset | null>;
}

async function boundedJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_PERMISSION_REQUEST_BYTES)
  )
    throw new Error("invalid");
  if (!request.body) throw new Error("invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_PERMISSION_REQUEST_BYTES) throw new Error("invalid");
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: privateHeaders });
}

function sameDescriptor(
  permission: Extract<RitualPermissionResponseV1, { kind: "granted" }>,
  manifest: SqlRitualBundleManifest,
) {
  if (permission.rendered.kind !== "available") return false;
  const left = permission.rendered.descriptor;
  const right = manifest.manifest.descriptor;
  return (
    left.descriptorSha256 === right.descriptorSha256 &&
    left.contentSha256 === right.contentSha256 &&
    left.outputFormat === right.outputFormat &&
    left.outputFormatVersion === right.outputFormatVersion
  );
}

/** Route-handler composition kept separate from live DB/provider construction. */
export function createRitualHttpHandlers(services: RitualHttpServices) {
  return {
    async permission(request: Request): Promise<Response> {
      try {
        if (
          request.method !== "POST" ||
          request.headers
            .get("content-type")
            ?.split(";", 1)[0]
            .trim()
            .toLowerCase() !== "application/json"
        )
          return json({ error: "invalid-request" }, 400);
        const input = parseRitualPermissionRequest(await boundedJson(request));
        if (!input) return json({ error: "invalid-request" }, 400);
        const requestedAlias = request.headers.get("x-magickli-ritual-alias");
        let routeAlias: string | null = null;
        if (requestedAlias !== null) {
          if (!/^[0-9a-f]{24}$/.test(requestedAlias))
            return json({ error: "invalid-request" }, 400);
          const resolved = await services.resolveRouteAlias(requestedAlias);
          if (resolved !== input.ritualId)
            return json({ error: "invalid-request" }, 400);
          routeAlias = requestedAlias;
        }
        let permission = await services.checkPermission(input);
        if (!permission) return json({ error: "invalid-request" }, 400);
        let bundle: RitualDeliveryResponseV1["bundle"] = null;
        if (
          permission.kind === "granted" &&
          permission.rendered.kind === "available"
        ) {
          const manifest = await services.getManifest({
            expectedActorId: input.expectedActorId,
            ritualId: input.ritualId,
          });
          // Manifest lookup performs asynchronous SQL work. Never renew a source
          // lease with the earlier grant if access changed during that lookup.
          const currentPermission = await services.checkPermission(input);
          if (!currentPermission)
            return json({ error: "temporarily-unavailable" }, 503);
          permission = currentPermission;
          if (
            permission.kind === "granted" &&
            manifest &&
            sameDescriptor(permission, manifest)
          )
            bundle = {
              bundleId: manifest.manifest.bundleId,
              manifestJson: manifest.manifestJson,
              manifestSha256: manifest.manifestSha256,
            };
        }
        return json({
          version: 1,
          requestId: input.requestId,
          ownerId: input.expectedActorId,
          ritualId: input.ritualId,
          routeAlias,
          permission,
          bundle,
        } satisfies RitualDeliveryResponseV1);
      } catch {
        return json({ error: "temporarily-unavailable" }, 503);
      }
    },

    async asset(
      request: Request,
      input: {
        expectedActorId: string | null;
        ritualId: string;
        bundleId: string;
        assetKey: string;
      },
    ): Promise<Response> {
      try {
        const canonical = (value: string | null): value is string =>
          typeof value === "string" &&
          isUuidV7(value) &&
          value === value.toLowerCase();
        if (
          request.method !== "GET" ||
          new URL(request.url).search !== "" ||
          !canonical(input.expectedActorId) ||
          !canonical(input.ritualId) ||
          !canonical(input.bundleId) ||
          !canonical(input.assetKey)
        )
          return json({ error: "invalid-request" }, 400);
        const asset = await services.readAsset(
          {
            expectedActorId: input.expectedActorId,
            ritualId: input.ritualId,
            bundleId: input.bundleId,
            assetKey: input.assetKey,
          },
          request.signal,
        );
        if (!asset) return json({ error: "unavailable" }, 404);
        let body: ArrayBuffer;
        try {
          body = Uint8Array.from(asset.body).buffer;
        } finally {
          asset.body.fill(0);
        }
        return new Response(body, {
          status: 200,
          headers: {
            ...privateHeaders,
            "Content-Type": asset.contentType,
            "Content-Length": String(asset.byteSize),
            "X-Content-SHA256": asset.sha256,
          },
        });
      } catch {
        return json({ error: "temporarily-unavailable" }, 503);
      }
    },
  };
}
