import type { RitualScope } from "./access";

interface Base {
  version: 2;
  operationId: string;
  /** Account-switch guard only; verified session and persisted grants supply authorship/access. */
  expectedActorId: string;
}
export interface SqlRitualExpectedState {
  ritualId: string;
  expectedRevisionId: string;
  expectedVersion: number;
}
/** Immutable SQL-v2 operation. Legacy ObjectIds/timestamps are never converted by this boundary. */
export type SqlRitualWriteRequest =
  | (Base & {
      kind: "create";
      scope: RitualScope;
      title: string;
      source: string;
    })
  | (Base &
      SqlRitualExpectedState & { kind: "save"; source: string; title?: string })
  | (Base & SqlRitualExpectedState & { kind: "publish" });
export const SQL_RITUAL_WRITE_MESSAGES = {
  UPGRADE_REQUIRED:
    "This pending operation uses an unsupported ritual protocol. Preserve it for recovery; do not change its identity or retry it as a new operation.",
  INVALID_REQUEST: "The ritual command is invalid or unsupported.",
  INVALID_SOURCE:
    "The ritual source cannot be compiled. Fix the editor errors and retry.",
  NOT_AUTHENTICATED: "Sign in before saving this ritual.",
  ACCOUNT_CHANGED:
    "The signed-in account changed. Switch back to the draft owner before retrying.",
  FORBIDDEN: "You do not currently have permission for this ritual command.",
  NOT_FOUND: "The ritual is unavailable.",
  INVALID_STATE:
    "The ritual has inconsistent stored references and needs repair.",
  CONFLICT:
    "The ritual changed since this editor loaded. Keep your source, reload, and merge before saving.",
  IDEMPOTENCY_KEY_REUSED:
    "This request ID was used for a different operation. Retry only the unchanged original request.",
  RETRYABLE:
    "The ritual is busy. Retry the identical request with its original request ID.",
  UNAVAILABLE:
    "The save result could not be confirmed. Preserve the exact request and retry with its original request ID.",
} as const;
export type SqlRitualWriteFailureCode = keyof typeof SQL_RITUAL_WRITE_MESSAGES;
/** Original accepted state, not a claim that it remains current after later writes. */
export interface SqlRitualWriteOutcome {
  ritualId: string;
  revisionId: string;
  /** Parent CAS version, distinct from the request's protocol version. */
  version: number;
  updatedAt: string;
}
/** Safe transport-neutral result. Never returns source, compiler diagnostics, receipts or grants. */
export type SqlRitualWriteResult =
  | ({ ok: true; replayed: boolean } & SqlRitualWriteOutcome)
  | {
      ok: false;
      code: SqlRitualWriteFailureCode;
      message: string;
      retryable: boolean;
    };
