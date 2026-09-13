import type { RitualPermissionResponseV1 } from "./permissionContract";
import {
  type PermissionTransportAcceptance,
  parseRitualPermissionRequest,
  parseRitualPermissionResponse,
  type RitualPermissionRequestV1,
} from "./permissionContract";
import {
  parseRitualBundleManifest,
  type RitualBundleManifestV1,
} from "./ritualBundleManifest";

/** Strict server envelope joining a fresh permission result to one current manifest. */
export interface RitualDeliveryResponseV1 {
  version: 1;
  requestId: string;
  ownerId: string;
  ritualId: string;
  routeAlias: string | null;
  permission: RitualPermissionResponseV1;
  bundle: null | {
    bundleId: string;
    manifestJson: string;
    manifestSha256: string;
  };
}

export interface AcceptedRitualDelivery {
  routeAlias: string | null;
  permission: RitualPermissionResponseV1;
  bundle: null | {
    bundleId: string;
    manifestJson: string;
    manifestSha256: string;
    manifest: RitualBundleManifestV1;
  };
}

function shape(value: unknown, keys: readonly string[]) {
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

function temporary(
  request: RitualPermissionRequestV1,
): RitualPermissionResponseV1 {
  return {
    version: 1,
    requestId: request.requestId,
    ownerId: request.expectedActorId,
    ritualId: request.ritualId,
    kind: "temporarily-unavailable",
  };
}

/**
 * Validate a same-origin, uncached response and the manifest's complete rendered
 * binding. Any malformed or incomplete envelope becomes a temporary result and
 * can neither renew nor revoke local access.
 */
export async function parseRitualDeliveryResponse(
  input: RitualPermissionRequestV1,
  body: unknown,
  transport: PermissionTransportAcceptance,
  requestedRouteAlias: string | null = null,
): Promise<AcceptedRitualDelivery | null> {
  const request = parseRitualPermissionRequest(input);
  if (!request) return null;
  const unavailable = {
    routeAlias: null,
    permission: temporary(request),
    bundle: null,
  };
  try {
    if (
      transport.status !== 200 ||
      transport.sameOrigin !== true ||
      transport.uncached !== true ||
      !shape(body, [
        "version",
        "requestId",
        "ownerId",
        "ritualId",
        "routeAlias",
        "permission",
        "bundle",
      ])
    )
      return unavailable;
    const row = body as Record<string, unknown>;
    if (
      row.version !== 1 ||
      row.requestId !== request.requestId ||
      row.ownerId !== request.expectedActorId ||
      row.ritualId !== request.ritualId ||
      (row.routeAlias !== null && row.routeAlias !== requestedRouteAlias)
    )
      return unavailable;
    const permission = parseRitualPermissionResponse(
      request,
      row.permission,
      transport,
    );
    if (!permission || permission.kind === "temporarily-unavailable")
      return unavailable;
    const routeAlias =
      typeof row.routeAlias === "string" ? row.routeAlias : null;
    if (row.bundle === null) return { routeAlias, permission, bundle: null };
    if (
      permission.kind !== "granted" ||
      permission.rendered.kind !== "available" ||
      !shape(row.bundle, ["bundleId", "manifestJson", "manifestSha256"])
    )
      return unavailable;
    const bundle = row.bundle as Record<string, unknown>;
    if (
      typeof bundle.bundleId !== "string" ||
      typeof bundle.manifestJson !== "string" ||
      typeof bundle.manifestSha256 !== "string"
    )
      return unavailable;
    const parsed = await parseRitualBundleManifest(bundle.manifestJson, {
      manifestSha256: bundle.manifestSha256,
      bundleId: bundle.bundleId,
      ritualId: request.ritualId,
      descriptor: permission.rendered.descriptor,
    });
    return parsed
      ? {
          permission,
          routeAlias,
          bundle: {
            bundleId: parsed.bundleId,
            manifestJson: bundle.manifestJson,
            manifestSha256: bundle.manifestSha256,
            manifest: parsed,
          },
        }
      : unavailable;
  } catch {
    return unavailable;
  }
}
