import { isUuidV7 } from "../lib/ids";
import {
  OFFLINE_AUTHORIZATION_WINDOW_MS,
  type OfflineGrantV1,
  type PermissionReply,
} from "./lease";

/** Body identity is an expected account binding, never proof of authentication. */
export interface RitualPermissionRequestV1 {
  version: 1;
  requestId: string;
  expectedActorId: string;
  ritualId: string;
}

/** Rendering identity only. This is not a complete offline bundle or asset manifest. */
export interface RitualRenderDescriptorV1 {
  descriptorSha256: string;
  contentSha256: string;
  outputFormat: "json-rich-text";
  outputFormatVersion: "1";
}

/** A permission grant is independent of output availability and download readiness. */
export type RitualPermissionResponseV1 = { version: 1 } & (
  | (Extract<PermissionReply, { kind: "granted" }> & {
      rendered:
        | { kind: "available"; descriptor: RitualRenderDescriptorV1 }
        | { kind: "temporarily-unavailable" };
      /** Editors only; null when the parent has no current source yet. */
      editor: { currentRevisionId: string; parentVersion: number } | null;
    })
  | Exclude<PermissionReply, { kind: "granted" }>
);

/** The future fetch adapter must establish these properties; body fields cannot assert them. */
export interface PermissionTransportAcceptance {
  status: number;
  sameOrigin: boolean;
  uncached: boolean;
}

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function shape(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && "value" in descriptor;
    })
  );
}

/** Strict request parsing takes an immutable value copy and never resolves legacy aliases. */
export function parseRitualPermissionRequest(
  value: unknown,
): RitualPermissionRequestV1 | null {
  try {
    if (
      !shape(value, ["version", "requestId", "expectedActorId", "ritualId"]) ||
      value.version !== 1 ||
      !id(value.requestId) ||
      !id(value.expectedActorId) ||
      !id(value.ritualId)
    )
      return null;
    return {
      version: 1,
      requestId: value.requestId,
      expectedActorId: value.expectedActorId,
      ritualId: value.ritualId,
    };
  } catch {
    return null;
  }
}

/**
 * Accept only a bound success response from the expected uncached same-origin
 * permission transport. Arbitrary status/body/error, including 401/403/404, is
 * temporary. Only a fully validated explicit denial can trigger local revocation.
 * An invalid caller request returns null; no authority can be bound to it.
 */
export function parseRitualPermissionResponse(
  request: RitualPermissionRequestV1,
  body: unknown,
  transport: PermissionTransportAcceptance,
): RitualPermissionResponseV1 | null {
  const bound = parseRitualPermissionRequest(request);
  if (!bound) return null;
  const base = {
    version: 1 as const,
    requestId: bound.requestId,
    ownerId: bound.expectedActorId,
    ritualId: bound.ritualId,
  };
  const temporary = { ...base, kind: "temporarily-unavailable" as const };
  try {
    if (
      transport.status !== 200 ||
      transport.sameOrigin !== true ||
      transport.uncached !== true
    )
      return temporary;
    if (!body || typeof body !== "object") return temporary;
    const kind = Object.getOwnPropertyDescriptor(body, "kind")?.value;
    const keys = ["version", "requestId", "ownerId", "ritualId", "kind"];
    if (
      !shape(
        body,
        kind === "granted" ? [...keys, "grant", "rendered", "editor"] : keys,
      ) ||
      body.version !== 1 ||
      body.requestId !== base.requestId ||
      body.ownerId !== base.ownerId ||
      body.ritualId !== base.ritualId
    )
      return temporary;
    if (
      kind === "denied" ||
      kind === "authentication-required" ||
      kind === "temporarily-unavailable"
    )
      return { ...base, kind };
    if (kind !== "granted") return temporary;
    const g = body.grant;
    if (
      !shape(g, [
        "version",
        "leaseId",
        "ownerId",
        "ritualId",
        "checkedAtMs",
        "expiresAtMs",
        "respondedAtMs",
        "sourceEdit",
      ]) ||
      g.version !== 1 ||
      !id(g.leaseId) ||
      g.ownerId !== base.ownerId ||
      g.ritualId !== base.ritualId ||
      typeof g.sourceEdit !== "boolean" ||
      !instant(g.checkedAtMs) ||
      !instant(g.respondedAtMs) ||
      !instant(g.expiresAtMs) ||
      g.respondedAtMs < g.checkedAtMs ||
      g.respondedAtMs >= g.expiresAtMs ||
      g.expiresAtMs - g.checkedAtMs > OFFLINE_AUTHORIZATION_WINDOW_MS
    )
      return temporary;
    const grant: OfflineGrantV1 = {
      version: 1,
      leaseId: g.leaseId,
      ownerId: base.ownerId,
      ritualId: base.ritualId,
      checkedAtMs: g.checkedAtMs,
      respondedAtMs: g.respondedAtMs,
      expiresAtMs: g.expiresAtMs,
      sourceEdit: g.sourceEdit,
    };
    let editor: { currentRevisionId: string; parentVersion: number } | null =
      null;
    if (body.editor !== null) {
      if (
        !grant.sourceEdit ||
        !shape(body.editor, ["currentRevisionId", "parentVersion"]) ||
        !id(body.editor.currentRevisionId) ||
        !instant(body.editor.parentVersion)
      )
        return temporary;
      editor = {
        currentRevisionId: body.editor.currentRevisionId,
        parentVersion: body.editor.parentVersion,
      };
    }
    const r = body.rendered;
    if (shape(r, ["kind"]) && r.kind === "temporarily-unavailable")
      return {
        ...base,
        kind,
        grant,
        editor,
        rendered: { kind: "temporarily-unavailable" },
      };
    if (!shape(r, ["kind", "descriptor"]) || r.kind !== "available")
      return temporary;
    const d = r.descriptor;
    if (
      !shape(d, [
        "descriptorSha256",
        "contentSha256",
        "outputFormat",
        "outputFormatVersion",
      ]) ||
      !hash(d.descriptorSha256) ||
      !hash(d.contentSha256) ||
      d.outputFormat !== "json-rich-text" ||
      d.outputFormatVersion !== "1" ||
      (grant.sourceEdit && editor === null)
    )
      return temporary;
    return {
      ...base,
      kind,
      grant,
      editor,
      rendered: {
        kind: "available",
        descriptor: {
          descriptorSha256: d.descriptorSha256,
          contentSha256: d.contentSha256,
          outputFormat: d.outputFormat,
          outputFormatVersion: d.outputFormatVersion,
        },
      },
    };
  } catch {
    return temporary;
  }
}
