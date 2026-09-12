import { isUuidV7 } from "../lib/ids";

export const OFFLINE_AUTHORIZATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** An app account binding; epoch changes on explicit sign-out/account replacement. */
export interface OfflineAccount {
  ownerId: string;
  epoch: string;
}

/** Server-issued permission result, never derived from cached memberships or content. */
export interface OfflineGrantV1 {
  version: 1;
  leaseId: string;
  ownerId: string;
  ritualId: string;
  /** UTC milliseconds at the authoritative permission check, before content delivery. */
  checkedAtMs: number;
  expiresAtMs: number;
  /** Server response assembly time; slow preparation consumes the existing lease. */
  respondedAtMs: number;
  /** Separate from rendered read access: gates source snapshots, drafts and exports. */
  sourceEdit: boolean;
}

/** Captured before the request; transactionally replace the latest check ID per resource. */
export interface PendingPermissionCheck {
  requestId: string;
  ownerId: string;
  ritualId: string;
  accountEpoch: string;
  startedAtMs: number;
}

export type LeaseLock =
  | "needs-check"
  | "expired"
  | "revoked"
  | "clock-rollback";

/** Persist lock/observation updates before exposing bytes. This is not a trusted clock. */
export interface OfflineAuthorization {
  ownerId: string;
  ritualId: string;
  accountEpoch: string;
  grant: OfflineGrantV1 | null;
  /** Local request-start + remaining server-granted duration; latency never extends the window. */
  localStartedAtMs: number | null;
  localDeadlineMs: number | null;
  lastObservedAtMs: number | null;
  lock: LeaseLock | null;
}

/** Only a schema-validated response from the uncached permission endpoint may be accepted. */
export type PermissionReply = {
  requestId: string;
  ownerId: string;
  ritualId: string;
} & (
  | { kind: "granted"; grant: OfflineGrantV1 }
  | { kind: "denied" }
  | { kind: "authentication-required" }
  | { kind: "temporarily-unavailable" }
);

export interface PermissionApplication {
  authorization: OfflineAuthorization;
  outcome: "accepted" | "ignored" | "invalid" | "paused";
  /** Renewable downloaded data only; unique recovery/outbox bytes are never deleted here. */
  purgeDownloads: boolean;
  purgeSourceSnapshots: boolean;
  lockDrafts: boolean;
}

const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();

function validGrant(
  grant: OfflineGrantV1 | null,
  ownerId: string,
  ritualId: string,
): grant is OfflineGrantV1 {
  return (
    !!grant &&
    grant.version === 1 &&
    id(ownerId) &&
    id(ritualId) &&
    id(grant.leaseId) &&
    grant.ownerId === ownerId &&
    grant.ritualId === ritualId &&
    typeof grant.sourceEdit === "boolean" &&
    timestamp(grant.checkedAtMs) &&
    timestamp(grant.expiresAtMs) &&
    grant.expiresAtMs > grant.checkedAtMs &&
    timestamp(grant.respondedAtMs) &&
    grant.respondedAtMs >= grant.checkedAtMs &&
    grant.respondedAtMs < grant.expiresAtMs &&
    grant.expiresAtMs - grant.checkedAtMs <= OFFLINE_AUTHORIZATION_WINDOW_MS
  );
}

/** New legacy caches begin without authority; an online check is required to import content. */
export function emptyAuthorization(
  account: OfflineAccount,
  ritualId: string,
): OfflineAuthorization {
  return {
    ownerId: account.ownerId,
    ritualId,
    accountEpoch: account.epoch,
    grant: null,
    localStartedAtMs: null,
    localDeadlineMs: null,
    lastObservedAtMs: null,
    lock: "needs-check",
  };
}

function locked(
  previous: OfflineAuthorization,
  lock: LeaseLock,
): OfflineAuthorization {
  return {
    ...previous,
    grant: null,
    localStartedAtMs: null,
    localDeadlineMs: null,
    lock,
  };
}

/**
 * Pure policy: the caller must enforce latestCheckId with a Dexie transaction.
 * A same-account response from before sign-out/re-auth is still stale if its epoch differs.
 * Bare HTTP statuses, navigator.onLine, local reads and generic errors are not permission replies.
 */
export function applyPermissionReply(
  stored: OfflineAuthorization | null,
  pending: PendingPermissionCheck,
  reply: PermissionReply,
  currentAccount: OfflineAccount | null,
  latestCheckId: string | null,
  receivedAtMs: number,
): PermissionApplication {
  const previous =
    stored ??
    emptyAuthorization(
      { ownerId: pending.ownerId, epoch: pending.accountEpoch },
      pending.ritualId,
    );
  const unchanged = (outcome: PermissionApplication["outcome"]) => ({
    authorization: previous,
    outcome,
    purgeDownloads: false,
    purgeSourceSnapshots: false,
    lockDrafts: false,
  });
  if (
    !currentAccount ||
    !id(currentAccount.ownerId) ||
    !id(currentAccount.epoch) ||
    !id(pending.requestId) ||
    !id(pending.ritualId) ||
    pending.requestId !== latestCheckId ||
    pending.ownerId !== currentAccount.ownerId ||
    pending.accountEpoch !== currentAccount.epoch ||
    previous.ownerId !== pending.ownerId ||
    previous.ritualId !== pending.ritualId ||
    previous.accountEpoch !== pending.accountEpoch ||
    reply.requestId !== pending.requestId ||
    reply.ownerId !== pending.ownerId ||
    reply.ritualId !== pending.ritualId
  )
    return unchanged("ignored");
  if (
    reply.kind === "authentication-required" ||
    reply.kind === "temporarily-unavailable"
  )
    return unchanged("paused");
  if (reply.kind === "denied")
    return {
      authorization: locked(previous, "revoked"),
      outcome: "accepted",
      purgeDownloads: true,
      purgeSourceSnapshots: true,
      lockDrafts: true,
    };
  if (reply.kind !== "granted") return unchanged("invalid");
  const grant = reply.grant;
  if (
    !validGrant(grant, pending.ownerId, pending.ritualId) ||
    !timestamp(pending.startedAtMs) ||
    !timestamp(receivedAtMs)
  )
    return unchanged("invalid");
  const deadline =
    pending.startedAtMs + (grant.expiresAtMs - grant.respondedAtMs);
  if (!timestamp(deadline)) return unchanged("invalid");
  const lock =
    receivedAtMs < pending.startedAtMs
      ? "clock-rollback"
      : receivedAtMs >= deadline
        ? "expired"
        : null;
  if (lock)
    return {
      authorization: locked(previous, lock),
      outcome: "accepted",
      purgeDownloads: true,
      purgeSourceSnapshots: true,
      lockDrafts: true,
    };
  return {
    authorization: {
      ...previous,
      grant: { ...grant },
      localStartedAtMs: pending.startedAtMs,
      localDeadlineMs: deadline,
      lastObservedAtMs: receivedAtMs,
      lock: null,
    },
    outcome: "accepted",
    purgeDownloads: false,
    purgeSourceSnapshots: !grant.sourceEdit,
    lockDrafts: !grant.sourceEdit,
  };
}

/** Evaluate at cold start, foreground/resume and every protected read/export, not just a timer. */
export function inspectOfflineAuthorization(
  previous: OfflineAuthorization | null,
  account: OfflineAccount | null,
  nowMs: number,
) {
  if (!previous)
    return {
      authorization: null,
      read: false,
      sourceEdit: false,
      purgeDownloads: false,
      reason: "needs-check" as const,
    };
  if (
    !account ||
    !id(account.ownerId) ||
    !id(account.epoch) ||
    previous.ownerId !== account.ownerId ||
    previous.accountEpoch !== account.epoch
  )
    return {
      authorization: previous,
      read: false,
      sourceEdit: false,
      purgeDownloads: false,
      reason: "account-mismatch" as const,
    };
  if (
    previous.lock ||
    !validGrant(previous.grant, previous.ownerId, previous.ritualId) ||
    !timestamp(previous.localStartedAtMs) ||
    !timestamp(previous.localDeadlineMs) ||
    !timestamp(previous.lastObservedAtMs) ||
    previous.localDeadlineMs !==
      previous.localStartedAtMs +
        previous.grant.expiresAtMs -
        previous.grant.respondedAtMs ||
    previous.lastObservedAtMs < previous.localStartedAtMs
  )
    return {
      authorization: previous,
      read: false,
      sourceEdit: false,
      purgeDownloads: false,
      reason: previous.lock ?? "needs-check",
    };
  const lock =
    !timestamp(nowMs) || nowMs < previous.lastObservedAtMs
      ? "clock-rollback"
      : nowMs >= previous.localDeadlineMs
        ? "expired"
        : null;
  if (lock)
    return {
      authorization: locked(previous, lock),
      read: false,
      sourceEdit: false,
      purgeDownloads: true,
      reason: lock,
    };
  return {
    authorization: { ...previous, lastObservedAtMs: nowMs },
    read: true,
    sourceEdit: previous.grant.sourceEdit,
    purgeDownloads: false,
    reason: null,
  };
}
