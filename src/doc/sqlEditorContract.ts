import { isUuidV7 } from "../lib/ids";
import {
  type PermissionTransportAcceptance,
  parseRitualPermissionRequest,
  parseRitualPermissionResponse,
  type RitualPermissionRequestV1,
  type RitualPermissionResponseV1,
} from "../offline/permissionContract";
import { parseRitualScope, type RitualScope } from "./access";
import {
  SQL_RITUAL_WRITE_MESSAGES,
  type SqlRitualWriteRequest,
  type SqlRitualWriteResult,
} from "./sqlWriteContract";

const SOURCE_BYTES = 1024 * 1024;
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const instant = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0);
function shape(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
const text = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.isWellFormed() &&
  !value.includes("\0") &&
  new TextEncoder().encode(value).byteLength <= maxBytes;

export interface SqlRitualSourceDeliveryV1 {
  version: 1;
  requestId: string;
  ownerId: string;
  ritualId: string;
  permission: RitualPermissionResponseV1;
  source: null | {
    title: string;
    revisionId: string;
    parentVersion: number;
    source: string;
  };
}

export interface AcceptedSqlRitualSourceDelivery {
  permission: RitualPermissionResponseV1;
  source: SqlRitualSourceDeliveryV1["source"];
}

/** A malformed source response is temporary and can never revoke local access. */
export function parseSqlRitualSourceDelivery(
  input: RitualPermissionRequestV1,
  body: unknown,
  transport: PermissionTransportAcceptance,
): AcceptedSqlRitualSourceDelivery | null {
  const request = parseRitualPermissionRequest(input);
  if (!request) return null;
  const temporary: AcceptedSqlRitualSourceDelivery = {
    permission: {
      version: 1,
      requestId: request.requestId,
      ownerId: request.expectedActorId,
      ritualId: request.ritualId,
      kind: "temporarily-unavailable",
    },
    source: null,
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
        "permission",
        "source",
      ])
    )
      return temporary;
    const row = body as Record<string, unknown>;
    if (
      row.version !== 1 ||
      row.requestId !== request.requestId ||
      row.ownerId !== request.expectedActorId ||
      row.ritualId !== request.ritualId
    )
      return temporary;
    const permission = parseRitualPermissionResponse(
      request,
      row.permission,
      transport,
    );
    if (!permission || permission.kind === "temporarily-unavailable")
      return temporary;
    if (row.source === null) return { permission, source: null };
    if (
      permission.kind !== "granted" ||
      !permission.grant.sourceEdit ||
      !permission.editor ||
      !shape(row.source, ["title", "revisionId", "parentVersion", "source"])
    )
      return temporary;
    const source = row.source as Record<string, unknown>;
    if (
      !text(source.title, 2000) ||
      !id(source.revisionId) ||
      source.revisionId !== permission.editor.currentRevisionId ||
      !instant(source.parentVersion) ||
      source.parentVersion !== permission.editor.parentVersion ||
      !text(source.source, SOURCE_BYTES)
    )
      return temporary;
    return {
      permission,
      source: {
        title: source.title,
        revisionId: source.revisionId,
        parentVersion: source.parentVersion,
        source: source.source,
      },
    };
  } catch {
    return temporary;
  }
}

export interface SqlRitualCreationOptionsV1 {
  version: 1;
  ownerId: string;
  public: boolean;
  groups: Array<{ id: string; name: string }>;
  temples: Array<{ id: string; name: string }>;
}

export function parseSqlRitualCreationOptions(
  value: unknown,
): SqlRitualCreationOptionsV1 | null {
  if (!shape(value, ["version", "ownerId", "public", "groups", "temples"]))
    return null;
  const row = value as Record<string, unknown>;
  if (
    row.version !== 1 ||
    !id(row.ownerId) ||
    typeof row.public !== "boolean" ||
    !Array.isArray(row.groups) ||
    !Array.isArray(row.temples) ||
    row.groups.length > 1000 ||
    row.temples.length > 1000
  )
    return null;
  const option = (item: unknown): item is { id: string; name: string } =>
    shape(item, ["id", "name"]) &&
    id((item as { id?: unknown }).id) &&
    text((item as { name?: unknown }).name, 2000);
  if (!row.groups.every(option) || !row.temples.every(option)) return null;
  return {
    version: 1,
    ownerId: row.ownerId,
    public: row.public,
    groups: row.groups.map((item) => ({ ...item })),
    temples: row.temples.map((item) => ({ ...item })),
  };
}

/** Bind a write response to the immutable request that produced it. */
export function parseSqlRitualWriteResult(
  request: SqlRitualWriteRequest,
  value: unknown,
): SqlRitualWriteResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true) {
    if (
      !shape(row, [
        "ok",
        "replayed",
        "ritualId",
        "revisionId",
        "version",
        "updatedAt",
      ]) ||
      typeof row.replayed !== "boolean" ||
      !id(row.ritualId) ||
      (request.kind !== "create" && row.ritualId !== request.ritualId) ||
      !id(row.revisionId) ||
      !instant(row.version) ||
      (request.kind === "create"
        ? row.version !== 1
        : row.version !== request.expectedVersion + 1) ||
      (request.kind === "publish" &&
        row.revisionId !== request.expectedRevisionId) ||
      typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt))
    )
      return null;
    return row as unknown as SqlRitualWriteResult;
  }
  if (
    row.ok !== false ||
    !shape(row, ["ok", "code", "message", "retryable"]) ||
    typeof row.code !== "string" ||
    !Object.hasOwn(SQL_RITUAL_WRITE_MESSAGES, row.code) ||
    row.message !==
      SQL_RITUAL_WRITE_MESSAGES[
        row.code as keyof typeof SQL_RITUAL_WRITE_MESSAGES
      ] ||
    typeof row.retryable !== "boolean" ||
    row.retryable !== (row.code === "RETRYABLE" || row.code === "UNAVAILABLE")
  )
    return null;
  return row as unknown as SqlRitualWriteResult;
}

export type SqlRitualCreateRequest = Extract<
  SqlRitualWriteRequest,
  { kind: "create" }
>;

/** Exact retained create commands are replayed byte-for-byte after uncertain outcomes. */
export function parseSqlRitualCreateRequest(
  value: unknown,
  expectedActorId?: string,
): SqlRitualCreateRequest | null {
  try {
    if (
      !shape(value, [
        "version",
        "operationId",
        "expectedActorId",
        "kind",
        "scope",
        "title",
        "source",
      ])
    )
      return null;
    const row = value as Record<string, unknown>;
    const scope = parseRitualScope(row.scope);
    if (
      row.version !== 2 ||
      row.kind !== "create" ||
      !id(row.operationId) ||
      !id(row.expectedActorId) ||
      (expectedActorId !== undefined &&
        row.expectedActorId !== expectedActorId) ||
      !scope ||
      (scope.kind === "group" && !id(scope.groupId)) ||
      (scope.kind === "temple" && !id(scope.templeId)) ||
      typeof row.title !== "string" ||
      !row.title.isWellFormed() ||
      row.title.includes("\0") ||
      !row.title.trim() ||
      row.title.length > 500 ||
      !text(row.source, SOURCE_BYTES)
    )
      return null;
    return {
      version: 2,
      operationId: row.operationId,
      expectedActorId: row.expectedActorId,
      kind: "create",
      scope,
      title: row.title,
      source: row.source,
    };
  } catch {
    return null;
  }
}

export function creationScope(
  key: string,
  minGrade: number,
): RitualScope | null {
  if (key === "public") return { kind: "public" };
  const [kind, idValue, extra] = key.split(":");
  if (extra !== undefined || !id(idValue)) return null;
  if (kind === "group") return { kind: "group", groupId: idValue };
  return kind === "temple" && instant(minGrade)
    ? { kind: "temple", templeId: idValue, minGrade }
    : null;
}
