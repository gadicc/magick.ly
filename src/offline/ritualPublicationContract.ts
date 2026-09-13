import { isUuidV7 } from "../lib/ids";

export interface RitualPublicationRequestV1 {
  version: 1;
  /** Reuse the durable SQL write operation ID for post-save publication retries. */
  operationId: string;
  expectedActorId: string;
  ritualId: string;
  expectedRevisionId: string;
  expectedVersion: number;
}

export type RitualPublicationCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "ACTOR_CHANGED"
  | "FORBIDDEN"
  | "STALE"
  | "INCOMPLETE"
  | "EXPIRED"
  | "OPERATION_CONFLICT"
  | "BUSY"
  | "ABORTED"
  | "UNAVAILABLE";

export const RITUAL_PUBLICATION_MESSAGES: Record<
  RitualPublicationCode,
  string
> = {
  INVALID_REQUEST: "The publication request is invalid or unsupported.",
  AUTH_REQUIRED: "Sign in before publishing this ritual for offline use.",
  ACTOR_CHANGED:
    "The signed-in account changed. Switch back before retrying this publication.",
  FORBIDDEN: "You no longer have permission to publish this ritual.",
  STALE:
    "The ritual changed after this publication was requested. Publish the latest saved version instead.",
  INCOMPLETE:
    "One or more ritual images cannot be prepared for offline use. Check the saved image sources and try again.",
  EXPIRED:
    "This publication attempt expired. Start a new attempt for the current saved version.",
  OPERATION_CONFLICT:
    "This request ID belongs to different publication content. Keep the original request unchanged.",
  BUSY: "This ritual publication is already being processed. Retry shortly.",
  ABORTED: "Publication was interrupted. Retry the same request.",
  UNAVAILABLE:
    "The publication result could not be confirmed. Retry the same request with its original request ID.",
};

export type RitualPublicationResult =
  | {
      ok: true;
      state: "completed";
      replayed: boolean;
      receipt: {
        operationId: string;
        bundleId: string;
        ritualId: string;
        publishedAtMs: number;
      };
    }
  | {
      ok: false;
      code: RitualPublicationCode;
      message: string;
      retryable: boolean;
    };

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

export function parseRitualPublicationRequest(
  value: unknown,
): RitualPublicationRequestV1 | null {
  if (
    !plain(value) ||
    Reflect.ownKeys(value).length !== 6 ||
    value.version !== 1 ||
    !id(value.operationId) ||
    !id(value.expectedActorId) ||
    !id(value.ritualId) ||
    !id(value.expectedRevisionId) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 0 ||
    Object.is(value.expectedVersion, -0)
  )
    return null;
  return {
    version: 1,
    operationId: value.operationId,
    expectedActorId: value.expectedActorId,
    ritualId: value.ritualId,
    expectedRevisionId: value.expectedRevisionId,
    expectedVersion: value.expectedVersion,
  };
}

export function failedRitualPublication(
  code: RitualPublicationCode,
): Extract<RitualPublicationResult, { ok: false }> {
  return {
    ok: false,
    code,
    message: RITUAL_PUBLICATION_MESSAGES[code],
    retryable: ["BUSY", "ABORTED", "UNAVAILABLE"].includes(code),
  };
}

/** Strict browser boundary: malformed or cross-operation replies never settle an outbox item. */
export function parseRitualPublicationResult(
  requestValue: unknown,
  value: unknown,
): RitualPublicationResult | null {
  const request = parseRitualPublicationRequest(requestValue);
  if (!request || !plain(value)) return null;
  if (value.ok === true) {
    if (
      Reflect.ownKeys(value).length !== 4 ||
      value.state !== "completed" ||
      typeof value.replayed !== "boolean" ||
      !plain(value.receipt) ||
      Reflect.ownKeys(value.receipt).length !== 4 ||
      value.receipt.operationId !== request.operationId ||
      value.receipt.ritualId !== request.ritualId ||
      !id(value.receipt.bundleId) ||
      typeof value.receipt.publishedAtMs !== "number" ||
      !Number.isSafeInteger(value.receipt.publishedAtMs) ||
      value.receipt.publishedAtMs < 0 ||
      Object.is(value.receipt.publishedAtMs, -0)
    )
      return null;
    return {
      ok: true,
      state: "completed",
      replayed: value.replayed,
      receipt: {
        operationId: request.operationId,
        bundleId: value.receipt.bundleId,
        ritualId: request.ritualId,
        publishedAtMs: value.receipt.publishedAtMs,
      },
    };
  }
  if (
    value.ok !== false ||
    Reflect.ownKeys(value).length !== 4 ||
    typeof value.code !== "string" ||
    !Object.hasOwn(RITUAL_PUBLICATION_MESSAGES, value.code)
  )
    return null;
  const expected = failedRitualPublication(value.code as RitualPublicationCode);
  return value.message === expected.message &&
    value.retryable === expected.retryable
    ? expected
    : null;
}
