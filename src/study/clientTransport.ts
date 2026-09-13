import { isUuidV7 } from "../lib/ids";
import {
  type StudyReviewResult,
  type StudyServerSnapshot,
  studySnapshotFromWire,
} from "./reviewContract";
import {
  type ClaimedStudyReview,
  type StudyRepository,
  type StudyScope,
} from "./storage";

type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function requestFromClaim(claim: ClaimedStudyReview) {
  const { event } = claim;
  if (!event.expectedActorId)
    throw new Error("Anonymous study reviews cannot be sent to SQL.");
  return {
    version: 1 as const,
    eventId: event.eventId,
    expectedActorId: event.expectedActorId,
    setId: event.setId,
    cardId: event.cardId,
    mode: event.mode,
    wrongCount: event.wrongCount,
    elapsedMs: event.elapsedMs,
    answeredAtMs: event.answeredAtMs,
  };
}

function failure(
  value: unknown,
): Extract<StudyReviewResult, { ok: false }> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const row = value as Record<string, unknown>;
  const codes = new Set([
    "INVALID_REQUEST",
    "NOT_AUTHENTICATED",
    "ACCOUNT_CHANGED",
    "IDEMPOTENCY_KEY_REUSED",
    "RETRYABLE",
    "UNAVAILABLE",
  ]);
  if (
    row.ok !== false ||
    typeof row.code !== "string" ||
    !codes.has(row.code) ||
    typeof row.message !== "string" ||
    typeof row.retryable !== "boolean"
  )
    return null;
  return row as Extract<StudyReviewResult, { ok: false }>;
}

function success(value: unknown): {
  eventId: string;
  snapshot: StudyServerSnapshot;
} | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const row = value as Record<string, unknown>;
  const snapshot = studySnapshotFromWire(row.snapshot);
  if (
    row.ok !== true ||
    !isUuidV7(row.eventId) ||
    row.eventId !== row.eventId.toLowerCase() ||
    typeof row.replayed !== "boolean" ||
    !Number.isSafeInteger(row.acceptedVersion) ||
    Number(row.acceptedVersion) < 0 ||
    !snapshot ||
    snapshot.version < Number(row.acceptedVersion)
  )
    return null;
  return { eventId: row.eventId, snapshot };
}

/** Refreshes one account scope; foreign or malformed payloads are rejected atomically. */
export async function refreshStudyProgress(
  repository: StudyRepository,
  scope: StudyScope,
  options: { fetch?: Fetch; setId?: string; signal?: AbortSignal } = {},
) {
  if (scope.kind !== "account") return { ok: true as const };
  const query = options.setId
    ? `?setId=${encodeURIComponent(options.setId)}`
    : "";
  const response = await (options.fetch ?? fetch)(`/api/study${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return failure(body) ?? { ok: false as const };
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new Error("Malformed study progress response.");
  const values = (body as Record<string, unknown>).snapshots;
  if (!Array.isArray(values))
    throw new Error("Malformed study progress response.");
  const snapshots = values.map(studySnapshotFromWire);
  if (snapshots.some((value) => !value))
    throw new Error("Malformed study progress response.");
  await repository.acceptServerSnapshots(
    scope,
    snapshots as StudyServerSnapshot[],
  );
  return { ok: true as const };
}

/** Drains this account's queue in device order; claims survive crashes and lost replies. */
export async function syncStudyProgress(
  repository: StudyRepository,
  scope: StudyScope,
  options: { fetch?: Fetch; signal?: AbortSignal; max?: number } = {},
) {
  if (scope.kind !== "account") return { sent: 0 };
  const send = options.fetch ?? fetch;
  let sent = 0;
  let blocked: string | undefined;
  for (let i = 0; i < (options.max ?? 50); i++) {
    if (options.signal?.aborted) break;
    const claim = await repository.claimNext(scope);
    if (!claim) break;
    try {
      const response = await send("/api/study", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestFromClaim(claim)),
        signal: options.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      const accepted = success(body);
      if (response.ok && accepted) {
        if (
          !(await repository.settleClaim(
            scope,
            claim,
            accepted.eventId,
            accepted.snapshot,
          ))
        ) {
          await repository.releaseClaim(claim, "MALFORMED_RESPONSE", true);
          blocked = "MALFORMED_RESPONSE";
          break;
        }
        sent++;
        continue;
      }
      const rejected = failure(body);
      const preserveForAccount =
        rejected?.code === "NOT_AUTHENTICATED" ||
        rejected?.code === "ACCOUNT_CHANGED";
      await repository.releaseClaim(
        claim,
        rejected?.code ?? "MALFORMED_RESPONSE",
        preserveForAccount || !rejected || rejected.retryable,
      );
      blocked = rejected?.code ?? "MALFORMED_RESPONSE";
      break;
    } catch (error) {
      await repository.releaseClaim(
        claim,
        error instanceof Error ? error.name : "NETWORK_ERROR",
        true,
      );
      blocked = "NETWORK_ERROR";
      break;
    }
  }
  return { sent, ...(blocked ? { blocked } : {}) };
}
