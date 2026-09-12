import { createUuidV7, isUuidV7 } from "../lib/ids";
import type { OfflineAccount } from "./lease";
import type {
  LockedRecoveryHandle,
  LockedRecoveryQueue,
  LockedRecoveryState,
} from "./recovery";
import type {
  OfflineClockObservation,
  OfflineResourceState,
  OfflineRuntimeRepository,
  OfflineRuntimeState,
} from "./runtimeState";

const POLL_MS = 60_000;
const instant = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
/** Broadcasts can close views; only repository state can make a view available again. */
export interface OfflineLifecycleMessages {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
}
/** Inject browser primitives so the coordinator stays independent of React and routing. */
export interface OfflineLifecycleEnvironment {
  document: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  window: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  visible(): boolean;
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  messages: OfflineLifecycleMessages;
}
export type OfflineLockReason =
  | "startup"
  | "hidden"
  | "resume"
  | "expiry"
  | "clock"
  | "change"
  | "signout"
  | "account"
  | "unmount"
  | "dispose"
  | "storage";
/** Capture must not await storage. On capture failure, hide keeps uncaptured text in opaque memory. */
export interface OfflineView {
  ritualId: string;
  capability: "read" | "source";
  captureRecovery?(): LockedRecoveryHandle | null;
  hide(
    reason: OfflineLockReason,
    options: { retainUncapturedDraft: boolean },
  ): void;
  available(): void;
}
/** Opaque identity plus abort signal; use commit() immediately before writing async results to a view. */
export interface OfflineOperation {
  readonly signal: AbortSignal;
}
/** Online checks can repair absent/expired leases, but this token can never commit protected bytes. */
export interface OfflinePermissionOperation extends OfflineOperation {
  readonly account: Readonly<OfflineAccount>;
}
interface Operation {
  kind: "view" | "permission";
  viewId: number;
  generation: number;
  account: OfflineAccount;
  deadlineMs: number | null;
  abort: AbortController;
}
/** Public state contains counts/identity only, never held editor text or recovery handles. */
export interface OfflineLifecycleState {
  phase: "locked" | "checking" | "ready" | "disposed";
  generation: number;
  account: OfflineAccount | null;
  cleanupPending: boolean;
  recovery: LockedRecoveryState;
}
export interface OfflineLifecycleCallbacks {
  state?(state: OfflineLifecycleState): void;
  error?(kind: "repository" | "recovery" | "view" | "message"): void;
  /** Retry hint only; beginPermissionCheck() obtains a separate token which grants no cached access. */
  online?(): void;
}

/**
 * Closes private views synchronously, then reconciles persisted authority. A supplied
 * recovery queue must outlive this instance so navigation cannot discard failed saves.
 */
export class OfflineLifecycleCoordinator {
  private readonly views = new Map<number, OfflineView>();
  private readonly operations = new Map<OfflineOperation, Operation>();
  private readonly urls = new Map<string, number>();
  private readonly closingEpochs = new Set<string>();
  private readonly seenMessages = new Set<string>();
  private readonly sender = createUuidV7();
  private readonly removers: Array<() => void> = [];
  private generation = 0;
  private inspection = 0;
  private nextView = 0;
  private phase: OfflineLifecycleState["phase"] = "locked";
  private snapshot: OfflineRuntimeState | null = null;
  private timer: unknown = null;
  private observedAtMs: number | null = null;
  private started = false;
  private changing = false;
  private transitionId = 0;
  private disposed = false;
  private transition: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: OfflineRuntimeRepository,
    private readonly environment: OfflineLifecycleEnvironment,
    private readonly recovery: LockedRecoveryQueue,
    private readonly callbacks: OfflineLifecycleCallbacks = {},
  ) {}
  get state(): OfflineLifecycleState {
    return {
      phase: this.phase,
      generation: this.generation,
      account: this.snapshot?.account ? { ...this.snapshot.account } : null,
      cleanupPending: this.snapshot?.cleanupPending ?? false,
      recovery: this.recovery.state,
    };
  }
  private report(
    kind: Parameters<NonNullable<OfflineLifecycleCallbacks["error"]>>[0],
  ) {
    try {
      this.callbacks.error?.(kind);
    } catch {
      /* Reporting cannot prevent locking. */
    }
  }
  private emit() {
    try {
      this.callbacks.state?.(this.state);
    } catch {
      this.report("view");
    }
  }
  private listen(
    target: OfflineLifecycleEnvironment["window"],
    name: string,
    listener: () => void,
  ) {
    target.addEventListener(name, listener);
    this.removers.push(() => target.removeEventListener(name, listener));
  }
  /** Start once; cold startup begins closed and must obtain a fresh local repository inspection. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.listen(this.environment.document, "visibilitychange", () => {
      if (this.environment.visible()) void this.refresh(true, "resume");
      else this.invalidate("hidden");
    });
    this.listen(this.environment.window, "pagehide", () =>
      this.invalidate("hidden"),
    );
    this.listen(this.environment.window, "pageshow", () => {
      void this.refresh(true, "resume");
    });
    this.listen(this.environment.window, "focus", () => {
      void this.refresh(true, "resume");
    });
    this.listen(this.environment.window, "online", () => {
      if (!this.disposed) {
        try {
          this.callbacks.online?.();
        } catch {
          this.report("view");
        }
        void this.refresh(false, "change");
      }
    });
    this.removers.push(
      this.environment.messages.subscribe((message) => this.message(message)),
    );
    this.removers.push(
      this.recovery.subscribe((state) => {
        if (state.failed) this.report("recovery");
        this.emit();
      }),
    );
    await this.refresh(true, "startup");
  }
  /** A view receives only an availability hint; its bytes still come from a gated repository read. */
  register(view: OfflineView): {
    begin: () => OfflineOperation | null;
    beginPermissionCheck: () => OfflinePermissionOperation | null;
    dispose: () => void;
  } {
    if (this.disposed) throw new Error("Offline coordinator disposed");
    if (!id(view.ritualId)) throw new Error("Invalid ritual identity");
    const viewId = ++this.nextView;
    this.views.set(viewId, view);
    this.hide(viewId, view, "startup");
    if (this.started) void this.refresh(false, "change");
    return {
      begin: () => this.begin(viewId),
      beginPermissionCheck: () => this.beginPermissionCheck(viewId),
      dispose: () => {
        if (!this.views.has(viewId)) return;
        this.hide(viewId, view, "unmount");
        this.views.delete(viewId);
        for (const [token, operation] of this.operations)
          if (operation.viewId === viewId) {
            operation.abort.abort();
            this.operations.delete(token);
          }
        if (this.started && !this.disposed) void this.refresh(false, "change");
      },
    };
  }
  private hide(viewId: number, view: OfflineView, reason: OfflineLockReason) {
    let retainUncapturedDraft = false;
    try {
      const handle = view.captureRecovery?.();
      if (handle) this.recovery.add(handle);
    } catch {
      retainUncapturedDraft = true;
      this.report("recovery");
      // Keep the adapter closure alive for explicit retry. hide() must detach the
      // visible editor without discarding uncaptured text in this exceptional path.
      this.recovery.add({
        persist: async () => {
          const handle = view.captureRecovery?.();
          if (!handle) throw new Error("Recovery capture unavailable");
          await handle.persist();
        },
      });
    }
    try {
      view.hide(reason, { retainUncapturedDraft });
    } catch {
      this.report("view");
    }
    for (const [url, owner] of this.urls)
      if (owner === viewId) {
        try {
          this.environment.revokeObjectURL(url);
        } catch {
          this.report("view");
        }
        this.urls.delete(url);
      }
  }
  private invalidate(reason: OfflineLockReason) {
    if (this.disposed) return;
    this.generation++;
    this.inspection++;
    this.phase = "locked";
    if (this.timer !== null) {
      this.environment.clearTimer(this.timer);
      this.timer = null;
    }
    for (const operation of this.operations.values()) operation.abort.abort();
    this.operations.clear();
    for (const [viewId, view] of this.views) this.hide(viewId, view, reason);
    this.emit();
  }
  private capability(
    snapshot: OfflineRuntimeState | null,
    view: OfflineView,
  ): { available: boolean; deadline: number | null } {
    const row = snapshot?.resources.find(
      (row) => row.ritualId === view.ritualId,
    );
    return view.capability === "source"
      ? {
          available: !!row?.sourceEdit,
          deadline: row?.sourceDeadlineMs ?? null,
        }
      : { available: !!row?.read, deadline: row?.readDeadlineMs ?? null };
  }
  private differs(next: OfflineRuntimeState): boolean {
    if (
      this.snapshot?.account?.ownerId !== next.account?.ownerId ||
      this.snapshot?.account?.epoch !== next.account?.epoch ||
      this.snapshot?.cleanupPending !== next.cleanupPending
    )
      return true;
    for (const view of this.views.values())
      if (
        JSON.stringify(this.capability(this.snapshot, view)) !==
        JSON.stringify(this.capability(next, view))
      )
        return true;
    return false;
  }
  private normalize(snapshot: OfflineRuntimeState): OfflineRuntimeState {
    const now = this.environment.now();
    if (
      !instant(now) ||
      !instant(snapshot.observedAtMs) ||
      now < snapshot.observedAtMs
    )
      throw new Error("Observed clock rollback");
    if (
      snapshot.account &&
      (!id(snapshot.account.ownerId) || !id(snapshot.account.epoch))
    )
      throw new Error("Invalid stored account");
    this.observedAtMs = now;
    const resources: OfflineResourceState[] = snapshot.resources.map((row) => ({
      ...row,
      read: row.read && instant(row.readDeadlineMs) && row.readDeadlineMs > now,
      sourceEdit:
        row.sourceEdit &&
        instant(row.sourceDeadlineMs) &&
        row.sourceDeadlineMs > now,
    }));
    return { ...snapshot, resources };
  }
  private arm() {
    if (this.timer !== null) this.environment.clearTimer(this.timer);
    if (this.disposed || !this.environment.visible()) {
      this.timer = null;
      return;
    }
    const now = this.environment.now();
    let delay = POLL_MS;
    if (this.phase === "ready")
      for (const view of this.views.values()) {
        const capability = this.capability(this.snapshot, view);
        if (capability.available && capability.deadline !== null)
          delay = Math.min(delay, Math.max(0, capability.deadline - now));
      }
    this.timer = this.environment.setTimer(() => {
      this.timer = null;
      const now = this.environment.now();
      const clock =
        !instant(now) ||
        (this.observedAtMs !== null && now < this.observedAtMs);
      let expired = false;
      for (const view of this.views.values()) {
        const capability = this.capability(this.snapshot, view);
        if (
          capability.available &&
          capability.deadline !== null &&
          now >= capability.deadline
        )
          expired = true;
      }
      void this.refresh(clock || expired, clock ? "clock" : "expiry");
    }, delay);
  }
  private async refresh(
    close: boolean,
    reason: OfflineLockReason,
  ): Promise<void> {
    if (this.disposed) return;
    if (close) this.invalidate(reason);
    if (!this.environment.visible()) return;
    const inspection = ++this.inspection;
    const before = this.phase;
    if (this.phase !== "ready") this.phase = "checking";
    this.emit();
    try {
      const observation: OfflineClockObservation | undefined =
        this.snapshot?.account && this.observedAtMs !== null
          ? {
              account: this.snapshot.account,
              observedAtMs: this.observedAtMs,
              leases: this.snapshot.resources.map(
                ({ ritualId, leaseId, bundleLeaseId }) => ({
                  ritualId,
                  leaseId,
                  bundleLeaseId,
                }),
              ),
            }
          : undefined;
      const state = await this.repository.runtimeState(
        [...new Set([...this.views.values()].map((view) => view.ritualId))],
        observation,
      );
      if (this.disposed || inspection !== this.inspection) return;
      // A delay after the repository commit can expose a newly observed rollback.
      // Keep that exact lease identity for the next matched persistence attempt.
      if (
        instant(state.observedAtMs) &&
        this.environment.now() < state.observedAtMs
      ) {
        this.snapshot = state;
        this.observedAtMs = state.observedAtMs;
        throw new Error("Clock changed after inspection");
      }
      const snapshot = this.normalize(state);
      for (const epoch of this.closingEpochs)
        if (snapshot.account?.epoch !== epoch) this.closingEpochs.delete(epoch);
      const blocked =
        this.changing ||
        snapshot.cleanupPending ||
        !snapshot.account ||
        this.closingEpochs.has(snapshot.account.epoch);
      const changed = this.differs(snapshot);
      if (changed && !close) this.invalidate("change");
      this.snapshot = snapshot;
      this.phase = blocked ? "locked" : "ready";
      this.emit();
      this.arm();
      if (!blocked && (close || changed || before !== "ready"))
        for (const view of this.views.values())
          if (this.capability(snapshot, view).available) {
            try {
              view.available();
            } catch {
              this.report("view");
            }
          }
    } catch {
      if (this.disposed || inspection !== this.inspection) return;
      this.invalidate("storage");
      this.report("repository");
      this.arm();
    }
  }
  private begin(viewId: number): OfflineOperation | null {
    const view = this.views.get(viewId);
    if (
      !view ||
      this.phase !== "ready" ||
      !this.snapshot?.account ||
      !this.environment.visible()
    )
      return null;
    const capability = this.capability(this.snapshot, view);
    if (!capability.available || capability.deadline === null) return null;
    const abort = new AbortController();
    const token = Object.freeze({ signal: abort.signal });
    this.operations.set(token, {
      kind: "view",
      viewId,
      generation: this.generation,
      account: { ...this.snapshot.account },
      deadlineMs: capability.deadline,
      abort,
    });
    if (!this.current(token)) return null;
    return token;
  }
  private live(operation: Operation): boolean {
    return (
      operation.generation === this.generation &&
      !this.disposed &&
      this.phase === "ready" &&
      this.environment.visible() &&
      this.snapshot?.account?.epoch === operation.account.epoch &&
      this.snapshot.account.ownerId === operation.account.ownerId
    );
  }
  private beginPermissionCheck(
    viewId: number,
  ): OfflinePermissionOperation | null {
    if (
      !this.views.has(viewId) ||
      this.phase !== "ready" ||
      !this.snapshot?.account ||
      !this.environment.visible()
    )
      return null;
    const abort = new AbortController();
    const account = Object.freeze({ ...this.snapshot.account });
    const token = Object.freeze({ signal: abort.signal, account });
    this.operations.set(token, {
      kind: "permission",
      viewId,
      generation: this.generation,
      account,
      deadlineMs: null,
      abort,
    });
    return token;
  }
  /** Check immediately before accepting an online reply; the repository still verifies current epoch/request IDs. */
  currentPermissionCheck(token: OfflinePermissionOperation): boolean {
    const operation = this.operations.get(token);
    return (
      !!operation && operation.kind === "permission" && this.live(operation)
    );
  }
  /** Synchronous final guard; clock/expiry failure closes views before any callback can commit. */
  current(token: OfflineOperation): boolean {
    const operation = this.operations.get(token);
    if (
      !operation ||
      operation.kind !== "view" ||
      operation.deadlineMs === null ||
      !this.live(operation)
    )
      return false;
    const now = this.environment.now();
    if (
      !instant(now) ||
      now >= operation.deadlineMs ||
      (this.observedAtMs !== null && now < this.observedAtMs)
    ) {
      this.invalidate(now >= operation.deadlineMs ? "expiry" : "clock");
      void this.refresh(false, "clock");
      return false;
    }
    this.observedAtMs = now;
    return true;
  }
  /** Commit once, immediately after awaiting a gated read; late callbacks cannot repaint a locked view. */
  commit(token: OfflineOperation, apply: () => void): boolean {
    if (!this.current(token)) return false;
    try {
      apply();
      return true;
    } finally {
      this.operations.delete(token);
    }
  }
  /** Release an operation which produced no UI result; it no longer holds an abort controller. */
  finish(token: OfflineOperation): void {
    this.operations.delete(token);
  }
  /** Create only owned Blob URLs; every lock/unmount/dispose revokes this view's URLs. */
  objectURL(token: OfflineOperation, blob: Blob): string | null {
    if (!this.current(token)) return null;
    const operation = this.operations.get(token)!;
    const url = this.environment.createObjectURL(blob);
    this.urls.set(url, operation.viewId);
    if (!this.current(token)) return null;
    return url;
  }
  /** Call after the corresponding repository mutation commits, never before a permission write. */
  async changed(): Promise<void> {
    this.post("changed");
    await this.refresh(true, "change");
  }
  private post(kind: "closing" | "changed", epoch?: string) {
    try {
      this.environment.messages.post({
        version: 1,
        sender: this.sender,
        id: createUuidV7(),
        kind,
        ...(epoch ? { epoch } : {}),
      });
    } catch {
      this.report("message");
    }
  }
  private message(value: unknown) {
    if (this.disposed || !value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (
      message.version !== 1 ||
      !id(message.sender) ||
      !id(message.id) ||
      message.sender === this.sender ||
      this.seenMessages.has(message.id) ||
      (message.kind !== "changed" && message.kind !== "closing") ||
      (message.kind === "closing" && !id(message.epoch))
    )
      return;
    this.seenMessages.add(message.id);
    if (this.seenMessages.size > 256)
      this.seenMessages.delete(this.seenMessages.values().next().value!);
    if (message.kind === "closing")
      this.closingEpochs.add(message.epoch as string);
    void this.refresh(true, message.kind === "closing" ? "signout" : "change");
  }
  private closeEpoch(account: OfflineAccount | null) {
    if (account) {
      this.closingEpochs.add(account.epoch);
      this.post("closing", account.epoch);
    }
  }
  private enqueueTransition(work: () => Promise<boolean>): Promise<boolean> {
    const result = this.transition.then(work, work);
    this.transition = result;
    return result;
  }
  /** Explicit operator sign-out only; an expired session/401 must not call this method. */
  signOut(): Promise<boolean> {
    let account = this.snapshot?.account ?? null;
    const action = ++this.transitionId;
    this.changing = true;
    this.invalidate("signout");
    this.closeEpoch(account);
    return this.enqueueTransition(async () => {
      let success = false;
      try {
        if (this.disposed || action !== this.transitionId) return false;
        const state = await this.repository.runtimeState([]);
        if (this.disposed || action !== this.transitionId) return false;
        if (
          account &&
          state.account &&
          (account.ownerId !== state.account.ownerId ||
            account.epoch !== state.account.epoch)
        )
          throw new Error("Account changed before signout");
        account = account ?? state.account;
        this.closeEpoch(account);
        if (state.cleanupPending) await this.repository.resumeCleanup();
        else if (state.account && account)
          await this.repository.signOut(account);
        this.post("changed");
        success = true;
      } catch {
        this.report("repository");
        this.closeEpoch(account);
      } finally {
        if (action === this.transitionId) {
          this.changing = false;
          await this.refresh(false, "signout");
        }
      }
      return success;
    });
  }
  /** Called only with the newly verified account, never a cached identity or transient null session. */
  activateVerifiedAccount(ownerId: string): Promise<boolean> {
    if (!id(ownerId)) return Promise.resolve(false);
    const action = ++this.transitionId;
    this.changing = true;
    this.invalidate("account");
    if (this.snapshot?.account?.ownerId !== ownerId)
      this.closeEpoch(this.snapshot?.account ?? null);
    return this.enqueueTransition(async () => {
      let old: OfflineAccount | null = null;
      let success = false;
      try {
        if (this.disposed || action !== this.transitionId) return false;
        const state = await this.repository.runtimeState([]);
        if (this.disposed || action !== this.transitionId) return false;
        if (state.cleanupPending) throw new Error("Cleanup pending");
        old = state.account;
        if (old && old.ownerId !== ownerId) {
          this.closeEpoch(old);
          await this.repository.signOut(old);
        }
        if (this.disposed || action !== this.transitionId) return false;
        await this.repository.activateAccount(ownerId);
        this.post("changed");
        success = true;
      } catch {
        this.report("repository");
        this.closeEpoch(old);
      } finally {
        if (action === this.transitionId) {
          this.changing = false;
          await this.refresh(false, "account");
        }
      }
      return success && this.phase === "ready";
    });
  }
  /** A cleanup retry never activates an account; the next verified login remains a separate step. */
  retryCleanup(): Promise<boolean> {
    const action = ++this.transitionId;
    this.changing = true;
    this.invalidate("signout");
    return this.enqueueTransition(async () => {
      let success = false;
      try {
        if (this.disposed || action !== this.transitionId) return false;
        await this.repository.resumeCleanup();
        this.post("changed");
        success = true;
      } catch {
        this.report("repository");
      } finally {
        if (action === this.transitionId) {
          this.changing = false;
          await this.refresh(false, "signout");
        }
      }
      return success;
    });
  }
  /** Stop event work while the injected recovery queue retains any failed opaque persistence handles. */
  dispose(): void {
    if (this.disposed) return;
    this.invalidate("dispose");
    this.disposed = true;
    this.phase = "disposed";
    for (const remove of this.removers.splice(0)) remove();
    this.emit();
  }
}
