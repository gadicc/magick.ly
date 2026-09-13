import Dexie, { type DexieOptions, type Table } from "dexie";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  applyStudyReview,
  materializeStudyCards,
  parseStudyReviewRequest,
  type StudyReviewRequest,
  type StudyServerSnapshot,
} from "./reviewContract";
import type { StudyRuntimeSetStats } from "./types";

export interface StudyScope {
  key: string;
  kind: "anonymous" | "account";
  ownerId: string;
}

interface StudyDeviceState {
  key: "active";
  anonymousOwnerId: string;
  lastAccountId?: string;
  explicitlySignedOut?: boolean;
}

export interface StoredStudySnapshot {
  key: string;
  scopeKey: string;
  setId: string;
  cardIds: string[];
  /** Last server-authoritative account state. Anonymous scopes never set this. */
  serverSnapshot: StudyServerSnapshot | null;
  snapshot: StudyRuntimeSetStats;
}

export interface StoredStudyReviewEvent {
  version: 1;
  eventId: string;
  scopeKey: string;
  expectedActorId: string | null;
  setId: string;
  cardId: string;
  mode: "supermemo" | "repetition";
  wrongCount: number;
  elapsedMs: number;
  answeredAtMs: number;
  status: "local-only" | "queued" | "sending" | "rejected";
  attempts: number;
  claimId: string | null;
  claimUntilMs: number | null;
  lastError: string | null;
}

export interface ClaimedStudyReview {
  claimId: string;
  event: StoredStudyReviewEvent;
}

export type StudyIdentitySignal =
  | { type: "signed-out" }
  | { type: "account"; accountId: string };

/** Study data uses a separate database so legacy quarantine and ritual leases stay isolated. */
export class StudyDatabase extends Dexie {
  device!: Table<StudyDeviceState, string>;
  snapshots!: Table<StoredStudySnapshot, string>;
  events!: Table<StoredStudyReviewEvent, string>;

  constructor(name = "magickli-study", options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      device: "&key",
      snapshots: "&key, scopeKey, &[scopeKey+setId]",
      events: "&eventId, scopeKey, [scopeKey+setId], [scopeKey+status], status",
    });
  }
}

function snapshotKey(scope: StudyScope, setId: string) {
  return `${scope.key}\u0000${setId}`;
}

function emptySnapshot(
  scope: StudyScope,
  setId: string,
  cardIds: readonly string[],
  atMs: number,
): StudyRuntimeSetStats {
  const empty: StudyRuntimeSetStats = {
    _id: createUuidV7(),
    ...(scope.kind === "account" ? { userId: scope.ownerId } : {}),
    setId,
    correct: 0,
    incorrect: 0,
    time: 0,
    dueDate: new Date(atMs),
    cards: Object.create(null),
  };
  return materializeStudyCards(empty, cardIds, atMs);
}

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function reviewRequest(event: StoredStudyReviewEvent): StudyReviewRequest {
  if (!event.expectedActorId)
    throw new Error("Anonymous reviews never enter the account outbox.");
  return {
    version: 1,
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

function applyPending(
  base: StudyRuntimeSetStats,
  row: StoredStudySnapshot,
  events: readonly StoredStudyReviewEvent[],
): StudyRuntimeSetStats {
  let snapshot = materializeStudyCards(
    base,
    row.cardIds,
    events[0]?.answeredAtMs ?? Date.now(),
  );
  for (const event of [...events].sort(
    (a, b) =>
      a.answeredAtMs - b.answeredAtMs || a.eventId.localeCompare(b.eventId),
  ))
    snapshot = applyStudyReview(snapshot, event);
  return snapshot;
}

/** Durable scope, optimistic state and single-claimer outbox operations. */
export class StudyRepository {
  readonly listeners = new Set<() => void>();
  readonly identityListeners = new Set<(signal: StudyIdentitySignal) => void>();
  private readonly channel: BroadcastChannel | null;

  constructor(
    readonly storage: StudyDatabase,
    options: { broadcast?: boolean } = {},
  ) {
    this.channel =
      options.broadcast !== false && typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("magickli-study-v1")
        : null;
    if (this.channel)
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (
          value === "changed" ||
          value === null ||
          typeof value !== "object"
        ) {
          this.notify(false);
          return;
        }
        const signal = value as Record<string, unknown>;
        if (signal.type === "signed-out") {
          this.notifyIdentity({ type: "signed-out" }, false);
          return;
        }
        if (
          signal.type === "account" &&
          isUuidV7(signal.accountId) &&
          signal.accountId === signal.accountId.toLowerCase()
        )
          this.notifyIdentity(
            { type: "account", accountId: signal.accountId },
            false,
          );
      };
  }

  close() {
    this.channel?.close();
    this.storage.close();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeIdentity(listener: (signal: StudyIdentitySignal) => void) {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  private notify(broadcast = true) {
    for (const listener of this.listeners) listener();
    if (broadcast) this.channel?.postMessage("changed");
  }

  private notifyIdentity(signal: StudyIdentitySignal, broadcast = true) {
    for (const listener of this.identityListeners) listener(signal);
    if (broadcast) this.channel?.postMessage(signal);
  }

  announceSignedOut() {
    this.notifyIdentity({ type: "signed-out" });
  }

  announceAccount(accountId: string) {
    if (!isUuidV7(accountId) || accountId !== accountId.toLowerCase())
      throw new Error("Study account identity must be a canonical UUIDv7.");
    this.notifyIdentity({ type: "account", accountId });
  }

  /** Null selects this device's stable anonymous identity; it is never an account ID. */
  async scope(accountId: string | null): Promise<StudyScope> {
    if (accountId !== null) {
      if (!isUuidV7(accountId) || accountId !== accountId.toLowerCase())
        throw new Error("Study account identity must be a canonical UUIDv7.");
      await this.storage.transaction("rw", this.storage.device, async () => {
        const device = await this.ensureDevice();
        await this.storage.device.put({
          ...device,
          lastAccountId: accountId,
          explicitlySignedOut: device.explicitlySignedOut ?? false,
        });
      });
      return {
        key: `account:${accountId}`,
        kind: "account",
        ownerId: accountId,
      };
    }
    return this.storage.transaction("rw", this.storage.device, async () => {
      const device = await this.ensureDevice();
      return {
        key: `anonymous:${device.anonymousOwnerId}`,
        kind: "anonymous",
        ownerId: device.anonymousOwnerId,
      };
    });
  }

  private async ensureDevice() {
    let device = await this.storage.device.get("active");
    if (!device) {
      device = { key: "active", anonymousOwnerId: createUuidV7() };
      await this.storage.device.add(device);
    }
    return device;
  }

  /** Offline fallback never guesses a new owner; it returns only the last verified account. */
  async lastLocalAccountId() {
    const device = await this.storage.device.get("active");
    return device?.explicitlySignedOut === false
      ? (device.lastAccountId ?? null)
      : null;
  }

  async isExplicitlySignedOut() {
    return (
      (await this.storage.device.get("active"))?.explicitlySignedOut === true
    );
  }

  /** Explicit sign-out keeps owner-bound rows but prevents cold-start reopening. */
  async markSignedOut() {
    const changed = await this.storage.transaction(
      "rw",
      this.storage.device,
      async () => {
        const device = await this.ensureDevice();
        if (device.explicitlySignedOut === true) return false;
        await this.storage.device.put({ ...device, explicitlySignedOut: true });
        return true;
      },
    );
    if (changed) this.notifyIdentity({ type: "signed-out" });
  }

  /** Called only after an explicit, freshly verified account activation. */
  async markAccountActive(accountId: string) {
    if (!isUuidV7(accountId) || accountId !== accountId.toLowerCase())
      throw new Error("Study account identity must be a canonical UUIDv7.");
    await this.storage.transaction("rw", this.storage.device, async () => {
      const device = await this.ensureDevice();
      await this.storage.device.put({
        ...device,
        lastAccountId: accountId,
        explicitlySignedOut: false,
      });
    });
  }

  async ensureSnapshot(
    scope: StudyScope,
    setId: string,
    cardIds: readonly string[],
    atMs = Date.now(),
  ): Promise<StudyRuntimeSetStats> {
    const key = snapshotKey(scope, setId);
    let changed = false;
    const result = await this.storage.transaction(
      "rw",
      this.storage.snapshots,
      async () => {
        const stored = await this.storage.snapshots.get(key);
        const ids = sortedUnique([...(stored?.cardIds ?? []), ...cardIds]);
        if (!stored) {
          const snapshot = emptySnapshot(scope, setId, ids, atMs);
          await this.storage.snapshots.add({
            key,
            scopeKey: scope.key,
            setId,
            cardIds: ids,
            serverSnapshot: null,
            snapshot,
          });
          changed = true;
          return snapshot;
        }
        if (
          ids.length === stored.cardIds.length &&
          ids.every((id, index) => id === stored.cardIds[index])
        )
          return stored.snapshot;
        const snapshot = materializeStudyCards(stored.snapshot, ids, atMs);
        await this.storage.snapshots.update(key, { cardIds: ids, snapshot });
        changed = true;
        return snapshot;
      },
    );
    if (changed) this.notify();
    return result;
  }

  async getSnapshot(scope: StudyScope, setId: string) {
    return (await this.storage.snapshots.get(snapshotKey(scope, setId)))
      ?.snapshot;
  }

  async listSnapshots(scope: StudyScope) {
    return (
      await this.storage.snapshots.where("scopeKey").equals(scope.key).toArray()
    )
      .map((row) => row.snapshot)
      .sort((a, b) => a.setId.localeCompare(b.setId));
  }

  /** Adds the event and materializes its local result in one IndexedDB transaction. */
  async recordReview(
    scope: StudyScope,
    input: Omit<
      StudyReviewRequest,
      "version" | "eventId" | "expectedActorId"
    > & { eventId?: string },
    cardIds: readonly string[],
  ) {
    const eventId = input.eventId ?? createUuidV7();
    const expectedActorId = scope.kind === "account" ? scope.ownerId : null;
    const validated = parseStudyReviewRequest({
      version: 1,
      eventId,
      expectedActorId: scope.ownerId,
      ...input,
    });
    if (!validated) throw new Error("Invalid local study review.");
    const event: StoredStudyReviewEvent = {
      version: 1,
      eventId,
      scopeKey: scope.key,
      expectedActorId,
      setId: input.setId,
      cardId: input.cardId,
      mode: input.mode,
      wrongCount: input.wrongCount,
      elapsedMs: input.elapsedMs,
      answeredAtMs: input.answeredAtMs,
      status: scope.kind === "account" ? "queued" : "local-only",
      attempts: 0,
      claimId: null,
      claimUntilMs: null,
      lastError: null,
    };
    if (
      scope.kind === "account" &&
      !parseStudyReviewRequest(reviewRequest(event))
    )
      throw new Error("Invalid account study review.");
    await this.storage.transaction(
      "rw",
      this.storage.snapshots,
      this.storage.events,
      async () => {
        const key = snapshotKey(scope, input.setId);
        let stored = await this.storage.snapshots.get(key);
        if (!stored) {
          const snapshot = emptySnapshot(
            scope,
            input.setId,
            sortedUnique(cardIds),
            input.answeredAtMs,
          );
          stored = {
            key,
            scopeKey: scope.key,
            setId: input.setId,
            cardIds: sortedUnique(cardIds),
            serverSnapshot: null,
            snapshot,
          };
        } else {
          stored.cardIds = sortedUnique([...stored.cardIds, ...cardIds]);
          stored.snapshot = materializeStudyCards(
            stored.snapshot,
            stored.cardIds,
            input.answeredAtMs,
          );
        }
        stored.snapshot = applyStudyReview(stored.snapshot, event);
        await this.storage.events.add(event);
        await this.storage.snapshots.put(stored);
      },
    );
    this.notify();
    return event;
  }

  /** Imports only snapshots whose server owner exactly matches the selected account. */
  async acceptServerSnapshots(
    scope: StudyScope,
    snapshots: readonly StudyServerSnapshot[],
  ) {
    if (scope.kind !== "account")
      throw new Error("Server progress cannot enter an anonymous scope.");
    await this.storage.transaction(
      "rw",
      this.storage.snapshots,
      this.storage.events,
      async () => {
        for (const serverSnapshot of snapshots) {
          if (serverSnapshot.userId !== scope.ownerId)
            throw new Error(
              "Server study snapshot belongs to another account.",
            );
          const key = snapshotKey(scope, serverSnapshot.setId);
          const stored = await this.storage.snapshots.get(key);
          if (
            stored?.serverSnapshot &&
            stored.serverSnapshot.version > serverSnapshot.version
          )
            continue;
          const row: StoredStudySnapshot = stored ?? {
            key,
            scopeKey: scope.key,
            setId: serverSnapshot.setId,
            cardIds: Object.keys(serverSnapshot.cards),
            serverSnapshot: null,
            snapshot: serverSnapshot,
          };
          row.serverSnapshot = serverSnapshot;
          const pending = await this.storage.events
            .where("[scopeKey+setId]")
            .equals([scope.key, serverSnapshot.setId])
            .filter(
              (event) =>
                event.status === "queued" || event.status === "sending",
            )
            .toArray();
          // A GET may already include a review whose acknowledgement was lost.
          // Keep the prior base until exact event receipts settle the local queue.
          if (pending.length > 0) continue;
          row.snapshot = applyPending(serverSnapshot, row, pending);
          await this.storage.snapshots.put(row);
        }
      },
    );
    this.notify();
  }

  /** At most one live claim per account prevents tabs from reordering this device's queue. */
  async claimNext(
    scope: StudyScope,
    nowMs = Date.now(),
    leaseMs = 30_000,
  ): Promise<ClaimedStudyReview | null> {
    if (scope.kind !== "account") return null;
    const claim = await this.storage.transaction(
      "rw",
      this.storage.events,
      async () => {
        const candidates = await this.storage.events
          .where("scopeKey")
          .equals(scope.key)
          .filter(
            (event) =>
              event.status === "queued" ||
              (event.status === "sending" &&
                (event.claimUntilMs === null || event.claimUntilMs <= nowMs)),
          )
          .toArray();
        const live = await this.storage.events
          .where("[scopeKey+status]")
          .equals([scope.key, "sending"])
          .filter(
            (event) =>
              event.claimUntilMs !== null && event.claimUntilMs > nowMs,
          )
          .first();
        if (live || candidates.length === 0) return null;
        candidates.sort(
          (a, b) =>
            a.answeredAtMs - b.answeredAtMs ||
            a.eventId.localeCompare(b.eventId),
        );
        const event = candidates[0];
        if (event.expectedActorId !== scope.ownerId)
          throw new Error("Queued study review crossed account scopes.");
        const claimId = createUuidV7();
        const updated: StoredStudyReviewEvent = {
          ...event,
          status: "sending",
          attempts: event.attempts + 1,
          claimId,
          claimUntilMs: nowMs + leaseMs,
          lastError: null,
        };
        await this.storage.events.put(updated);
        return { claimId, event: updated };
      },
    );
    if (claim) this.notify();
    return claim;
  }

  async releaseClaim(
    claim: ClaimedStudyReview,
    code: string,
    retryable: boolean,
  ) {
    const changed = await this.storage.transaction(
      "rw",
      this.storage.events,
      this.storage.snapshots,
      async () => {
        const event = await this.storage.events.get(claim.event.eventId);
        if (
          !event ||
          event.status !== "sending" ||
          event.claimId !== claim.claimId
        )
          return false;
        const updated: StoredStudyReviewEvent = {
          ...event,
          status: retryable ? "queued" : "rejected",
          claimId: null,
          claimUntilMs: null,
          lastError: code,
        };
        await this.storage.events.put(updated);
        if (!retryable) {
          const scope: StudyScope = {
            key: event.scopeKey,
            kind: "account",
            ownerId: event.expectedActorId ?? "",
          };
          const stored = await this.storage.snapshots.get(
            snapshotKey(scope, event.setId),
          );
          if (stored) {
            const base =
              stored.serverSnapshot ??
              emptySnapshot(
                scope,
                event.setId,
                stored.cardIds,
                event.answeredAtMs,
              );
            const pending = await this.storage.events
              .where("[scopeKey+setId]")
              .equals([event.scopeKey, event.setId])
              .filter(
                (row) => row.status === "queued" || row.status === "sending",
              )
              .toArray();
            stored.snapshot = applyPending(base, stored, pending);
            await this.storage.snapshots.put(stored);
          }
        }
        return true;
      },
    );
    if (changed) this.notify();
    return changed;
  }

  /** Accepts an ack only for the exact claim and owner, then reapplies later queued work. */
  async settleClaim(
    scope: StudyScope,
    claim: ClaimedStudyReview,
    eventId: string,
    serverSnapshot: StudyServerSnapshot,
  ) {
    if (
      scope.kind !== "account" ||
      eventId !== claim.event.eventId ||
      serverSnapshot.userId !== scope.ownerId ||
      serverSnapshot.setId !== claim.event.setId
    )
      return false;
    const settled = await this.storage.transaction(
      "rw",
      this.storage.snapshots,
      this.storage.events,
      async () => {
        const event = await this.storage.events.get(eventId);
        if (
          !event ||
          event.status !== "sending" ||
          event.claimId !== claim.claimId
        )
          return false;
        const key = snapshotKey(scope, event.setId);
        const stored = await this.storage.snapshots.get(key);
        if (!stored) return false;
        await this.storage.events.delete(eventId);
        const base =
          stored.serverSnapshot &&
          stored.serverSnapshot.version > serverSnapshot.version
            ? stored.serverSnapshot
            : serverSnapshot;
        stored.serverSnapshot = base;
        const pending = await this.storage.events
          .where("[scopeKey+setId]")
          .equals([scope.key, event.setId])
          .filter((row) => row.status === "queued" || row.status === "sending")
          .toArray();
        stored.snapshot = applyPending(base, stored, pending);
        await this.storage.snapshots.put(stored);
        return true;
      },
    );
    if (settled) this.notify();
    return settled;
  }
}
