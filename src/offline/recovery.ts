/** Captures already-held editor bytes privately. Persistence must use the original owner and local CAS. */
export interface LockedRecoveryHandle {
  persist(): Promise<void>;
}
export interface LockedRecoveryState {
  pending: number;
  saving: number;
  failed: number;
}

/**
 * This queue must outlive a route/coordinator. It holds only opaque persistence closures,
 * exposes no source/export method, and releases a handle only after durable success.
 */
export class LockedRecoveryQueue {
  private readonly pending = new Map<
    LockedRecoveryHandle,
    "pending" | "saving" | "failed"
  >();
  private readonly subscribers = new Set<
    (state: LockedRecoveryState) => void
  >();
  private readonly running = new Map<LockedRecoveryHandle, Promise<void>>();
  get state(): LockedRecoveryState {
    const values = [...this.pending.values()];
    return {
      pending: values.length,
      saving: values.filter((value) => value === "saving").length,
      failed: values.filter((value) => value === "failed").length,
    };
  }
  /** Observe pending work for a later beforeunload/recovery UI; no bytes or handles are returned. */
  subscribe(listener: (state: LockedRecoveryState) => void): () => void {
    this.subscribers.add(listener);
    try {
      listener(this.state);
    } catch {
      /* An observer cannot discard recovery. */
    }
    return () => this.subscribers.delete(listener);
  }
  private notify() {
    for (const listener of this.subscribers) {
      try {
        listener(this.state);
      } catch {
        /* An observer cannot discard recovery. */
      }
    }
  }
  add(handle: LockedRecoveryHandle): void {
    if (this.pending.has(handle)) return;
    this.pending.set(handle, "pending");
    this.notify();
    void this.persist(handle);
  }
  private persist(handle: LockedRecoveryHandle): Promise<void> {
    const running = this.running.get(handle);
    if (running) return running;
    this.pending.set(handle, "saving");
    const attempt = Promise.resolve()
      .then(() => handle.persist())
      .then(
        () => {
          this.pending.delete(handle);
        },
        () => {
          this.pending.set(handle, "failed");
        },
      )
      .finally(() => {
        this.running.delete(handle);
        this.notify();
      });
    this.running.set(handle, attempt);
    // Observers may call retry() synchronously; they must find this same attempt.
    this.notify();
    return attempt;
  }
  /** Retrying writes is allowed while locked; retrying never grants source/export capability. */
  async retry(): Promise<void> {
    await Promise.all(
      [...this.pending.keys()].map((handle) => this.persist(handle)),
    );
  }
}
