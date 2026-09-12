import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  OfflineLifecycleCoordinator,
  type OfflineLifecycleEnvironment,
  type OfflineView,
} from "./lifecycle";
import { LockedRecoveryQueue } from "./recovery";
import type {
  OfflineClockObservation,
  OfflineRuntimeRepository,
  OfflineRuntimeState,
} from "./runtimeState";

const A = "01993000-0000-7000-8000-000000000001";
const B = "01993000-0000-7000-8000-000000000002";
const R = "01993000-0000-7000-8000-000000000010";
const START = 2_000_000_000_000;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let n = 0; n < 20; n++) await Promise.resolve();
}
function repository(now: () => number) {
  const data: OfflineRuntimeState = {
    account: { ownerId: A, epoch: createUuidV7() },
    cleanupPending: false,
    observedAtMs: START,
    resources: [
      {
        ritualId: R,
        read: true,
        sourceEdit: true,
        readDeadlineMs: START + 1000,
        sourceDeadlineMs: START + 2000,
        leaseId: createUuidV7(),
        bundleLeaseId: createUuidV7(),
      },
    ],
  };
  const repo: OfflineRuntimeRepository = {
    runtimeState: vi.fn(
      async (ids: string[], observation?: OfflineClockObservation) => {
        const copy = structuredClone(data);
        copy.observedAtMs = now();
        copy.resources = copy.resources.filter((row) =>
          ids.includes(row.ritualId),
        );
        for (const row of copy.resources) {
          const observed =
            observation && observation.account.epoch === copy.account?.epoch
              ? observation.leases.find((x) => x.ritualId === row.ritualId)
              : undefined;
          const rollback =
            observation &&
            observed?.leaseId === row.leaseId &&
            observation.observedAtMs > now();
          if (rollback || row.readDeadlineMs! <= now()) row.read = false;
          if (rollback || row.sourceDeadlineMs! <= now())
            row.sourceEdit = false;
        }
        return copy;
      },
    ),
    signOut: vi.fn(async () => {
      data.account = null;
      data.resources = [];
    }),
    activateAccount: vi.fn(async (ownerId: string) => {
      data.account = { ownerId, epoch: createUuidV7() };
      return data.account;
    }),
    resumeCleanup: vi.fn(async () => {
      data.cleanupPending = false;
      data.account = null;
      data.resources = [];
    }),
  };
  return { repo, data };
}
function bus() {
  const listeners = new Set<(value: unknown) => void>();
  return {
    post: vi.fn((value: unknown) => {
      for (const fn of listeners) fn(value);
    }),
    subscribe: (fn: (value: unknown) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit: (value: unknown) => {
      for (const fn of listeners) fn(value);
    },
    listeners,
  };
}
const controllers: OfflineLifecycleCoordinator[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});
function fixture(shared?: ReturnType<typeof repository>, messages = bus()) {
  let now = START,
    visible = true,
    nextTimer = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const environment: OfflineLifecycleEnvironment = {
    document: new EventTarget(),
    window: new EventTarget(),
    visible: () => visible,
    now: () => now,
    setTimer: (run, ms) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    createObjectURL: vi.fn(() => `blob:synthetic-${createUuidV7()}`),
    revokeObjectURL: vi.fn(),
    messages,
  };
  const stored = shared ?? repository(() => now);
  const recovery = new LockedRecoveryQueue();
  const errors = vi.fn(),
    states = vi.fn(),
    online = vi.fn();
  const controller = new OfflineLifecycleCoordinator(
    stored.repo,
    environment,
    recovery,
    { error: errors, state: states, online },
  );
  controllers.push(controller);
  const view: OfflineView = {
    ritualId: R,
    capability: "read",
    hide: vi.fn(),
    available: vi.fn(),
  };
  const registration = controller.register(view);
  return {
    controller,
    view,
    registration,
    ...stored,
    recovery,
    environment,
    errors,
    states,
    online,
    timers,
    messages,
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
    hide() {
      visible = false;
      (environment.document as EventTarget).dispatchEvent(
        new Event("visibilitychange"),
      );
    },
    show() {
      visible = true;
      (environment.document as EventTarget).dispatchEvent(
        new Event("visibilitychange"),
      );
    },
    event(name: string) {
      (environment.window as EventTarget).dispatchEvent(new Event(name));
    },
    async advance(value: number) {
      now = value;
      const due = [...timers].filter(([, item]) => item.at <= now);
      for (const [id, item] of due) {
        timers.delete(id);
        item.run();
      }
      await settle();
    },
  };
}

describe("private view lifecycle", () => {
  it("starts closed, waits for persisted state, and commits each opaque read token once", async () => {
    const f = fixture();
    const delayed = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(delayed.promise);
    const start = f.controller.start();
    expect(f.registration.begin()).toBeNull();
    expect(f.view.hide).toHaveBeenCalled();
    delayed.resolve(f.data);
    await start;
    const token = f.registration.begin()!;
    const paint = vi.fn();
    expect(f.controller.commit(token, paint)).toBe(true);
    expect(f.controller.commit(token, paint)).toBe(false);
    expect(paint).toHaveBeenCalledOnce();
    await f.controller.start();
    expect(f.messages.listeners.size).toBe(1);
  });
  it("captures draft before hiding, aborts work and revokes only owned object URLs synchronously", async () => {
    const f = fixture();
    await f.controller.start();
    const order: string[] = [];
    const persist = vi.fn(async () => {});
    f.view.captureRecovery = () => {
      order.push("capture");
      return { persist };
    };
    f.view.hide = () => {
      order.push("hide");
    };
    const token = f.registration.begin()!;
    const url = f.controller.objectURL(token, new Blob(["synthetic"]));
    f.hide();
    expect(order).toEqual(["capture", "hide"]);
    expect(token.signal.aborted).toBe(true);
    expect(f.environment.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(
      f.controller.commit(token, () => {
        throw Error("late paint");
      }),
    ).toBe(false);
    expect(f.registration.begin()).toBeNull();
    await settle();
    expect(persist).toHaveBeenCalledOnce();
    expect(f.recovery.state.pending).toBe(0);
  });
  it.each(["pageshow", "focus"])(
    "rechecks permission on %s before allowing a suspended view",
    async (name) => {
      const f = fixture();
      await f.controller.start();
      f.event("pagehide");
      expect(f.registration.begin()).toBeNull();
      f.data.resources[0].sourceEdit = false;
      f.data.resources[0].read = false;
      f.event(name);
      await settle();
      expect(f.registration.begin()).toBeNull();
      expect(f.view.hide).toHaveBeenCalledWith("resume", expect.anything());
    },
  );
  it("reopens after visibility resume only when repository still permits it", async () => {
    const f = fixture();
    await f.controller.start();
    f.hide();
    f.show();
    expect(f.registration.begin()).toBeNull();
    await settle();
    expect(f.registration.begin()).not.toBeNull();
  });
  it("closes at the exact earliest view deadline and retains later source capability", async () => {
    const f = fixture();
    const editor = {
      ...f.view,
      capability: "source" as const,
      hide: vi.fn(),
      available: vi.fn(),
    };
    const source = f.controller.register(editor);
    await f.controller.start();
    expect(Math.min(...[...f.timers.values()].map((t) => t.at))).toBe(
      START + 1000,
    );
    const old = source.begin()!;
    await f.advance(START + 1000);
    expect(old.signal.aborted).toBe(true);
    expect(f.registration.begin()).toBeNull();
    expect(source.begin()).not.toBeNull();
    await f.advance(START + 2000);
    expect(source.begin()).toBeNull();
  });
  it("fences an async result that crosses its deadline before timers run", async () => {
    const f = fixture();
    await f.controller.start();
    const token = f.registration.begin()!;
    f.now = START + 1000;
    const paint = vi.fn();
    expect(f.controller.commit(token, paint)).toBe(false);
    expect(paint).not.toHaveBeenCalled();
    expect(token.signal.aborted).toBe(true);
  });
  it("fences observed clock rollback and binds the observation to old leases only", async () => {
    const f = fixture();
    await f.controller.start();
    f.now += 500;
    const token = f.registration.begin()!;
    f.now -= 400;
    expect(f.controller.current(token)).toBe(false);
    await settle();
    expect(f.registration.begin()).toBeNull();
    expect(f.repo.runtimeState).toHaveBeenLastCalledWith(
      [R],
      expect.objectContaining({
        account: f.data.account,
        observedAtMs: START + 500,
        leases: [
          expect.objectContaining({ leaseId: f.data.resources[0].leaseId }),
        ],
      }),
    );
    f.data.resources[0].leaseId = createUuidV7();
    f.data.resources[0].bundleLeaseId = createUuidV7();
    await f.controller.changed();
    expect(f.registration.begin()).not.toBeNull();
  });
  it("never commits with malformed clocks or after finishing an operation", async () => {
    const f = fixture();
    await f.controller.start();
    const token = f.registration.begin()!;
    f.controller.finish(token);
    expect(f.controller.current(token)).toBe(false);
    const next = f.registration.begin()!;
    f.now = Number.NaN;
    expect(f.controller.current(next)).toBe(false);
    await settle();
    expect(f.errors).toHaveBeenCalledWith("repository");
  });
  it("ignores late startup/resume results after hidden/disposal and removes event work", async () => {
    const f = fixture();
    const delayed = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(delayed.promise);
    const start = f.controller.start();
    f.controller.dispose();
    delayed.resolve(f.data);
    await start;
    expect(f.controller.state.phase).toBe("disposed");
    expect(f.view.available).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
    expect(f.messages.listeners.size).toBe(0);
    const count = vi.mocked(f.repo.runtimeState).mock.calls.length;
    f.show();
    f.event("focus");
    f.event("online");
    expect(vi.mocked(f.repo.runtimeState).mock.calls.length).toBe(count);
    f.controller.dispose();
    await f.controller.start();
    expect(() => f.controller.register(f.view)).toThrow("disposed");
  });
  it("the newest inspection wins when overlapping resumes settle in reverse order", async () => {
    const f = fixture();
    await f.controller.start();
    const old = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(old.promise);
    f.event("focus");
    f.data.resources[0].read = false;
    f.event("pageshow");
    await settle();
    old.resolve({
      ...structuredClone(f.data),
      resources: [{ ...f.data.resources[0], read: true }],
    });
    await settle();
    expect(f.registration.begin()).toBeNull();
  });
  it("checks foreground authority at a bounded interval without repainting unchanged content", async () => {
    const f = fixture();
    f.data.resources[0].readDeadlineMs = START + 300_000;
    await f.controller.start();
    const calls = vi.mocked(f.view.available).mock.calls.length;
    await f.advance(START + 60_000);
    expect(vi.mocked(f.view.available).mock.calls.length).toBe(calls);
    f.data.resources[0].read = false;
    await f.advance(START + 120_000);
    expect(f.registration.begin()).toBeNull();
  });
  it("treats online as a retry hint, never a new lease", async () => {
    const f = fixture();
    f.data.resources = [];
    await f.controller.start();
    f.event("online");
    await settle();
    expect(f.online).toHaveBeenCalledOnce();
    expect(f.registration.begin()).toBeNull();
  });
  it("keeps failed opaque recovery available for retry after coordinator disposal", async () => {
    const f = fixture();
    await f.controller.start();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic quota"))
      .mockResolvedValue(undefined);
    const handle = { persist };
    f.view.captureRecovery = () => handle;
    f.hide();
    await settle();
    expect(f.recovery.state).toEqual({ pending: 1, saving: 0, failed: 1 });
    expect(f.errors).toHaveBeenCalledWith("recovery");
    f.controller.dispose();
    expect(f.recovery.state.pending).toBe(1);
    await f.recovery.retry();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(f.recovery.state.pending).toBe(0);
  });
  it("retains an uncaptured draft closure while hiding and supports explicit later capture retry", async () => {
    const f = fixture();
    await f.controller.start();
    let fail = true;
    const persist = vi.fn(async () => {});
    f.view.captureRecovery = () => {
      if (fail) throw Error("synthetic capture");
      return { persist };
    };
    f.hide();
    await settle();
    expect(f.view.hide).toHaveBeenLastCalledWith("hidden", {
      retainUncapturedDraft: true,
    });
    expect(f.recovery.state.failed).toBe(1);
    fail = false;
    await f.recovery.retry();
    expect(persist).toHaveBeenCalledOnce();
    expect(f.recovery.state.pending).toBe(0);
  });
  it("unmount aborts its own work and revokes URLs without disposing other views", async () => {
    const f = fixture();
    const other = f.controller.register({
      ...f.view,
      hide: vi.fn(),
      available: vi.fn(),
    });
    await f.controller.start();
    const token = f.registration.begin()!,
      otherToken = other.begin()!;
    const url = f.controller.objectURL(token, new Blob());
    f.registration.dispose();
    f.registration.dispose();
    expect(token.signal.aborted).toBe(true);
    expect(otherToken.signal.aborted).toBe(false);
    expect(f.environment.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(f.registration.begin()).toBeNull();
  });
  it("does not allow callback failures to skip abort or URL cleanup", async () => {
    const f = fixture();
    await f.controller.start();
    const token = f.registration.begin()!,
      url = f.controller.objectURL(token, new Blob());
    f.view.hide = () => {
      throw Error("synthetic view");
    };
    f.hide();
    expect(token.signal.aborted).toBe(true);
    expect(f.environment.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(f.errors).toHaveBeenCalledWith("view");
  });
});

describe("cross-tab account fencing", () => {
  it("closes both tabs before a signout fence and cannot reopen the old epoch on a changed notification", async () => {
    const messages = bus();
    const f = fixture(undefined, messages),
      other = fixture(f, messages);
    await f.controller.start();
    await other.controller.start();
    const delayed = deferred<void>();
    const signOut = vi.mocked(f.repo.signOut);
    signOut.mockImplementationOnce(async () => {
      await delayed.promise;
      f.data.account = null;
      f.data.resources = [];
    });
    const token = other.registration.begin()!;
    const pending = f.controller.signOut();
    expect(token.signal.aborted).toBe(true);
    await settle();
    expect(f.registration.begin()).toBeNull();
    expect(other.registration.begin()).toBeNull();
    await other.controller.changed();
    expect(other.registration.begin()).toBeNull();
    delayed.resolve();
    expect(await pending).toBe(true);
    await settle();
    expect(other.controller.state.account).toBeNull();
    expect(other.registration.begin()).toBeNull();
  });
  it("a failure before durable fencing remains closed until explicit successful retry", async () => {
    const messages = bus();
    const f = fixture(undefined, messages),
      other = fixture(f, messages);
    await f.controller.start();
    await other.controller.start();
    vi.mocked(f.repo.signOut).mockRejectedValueOnce(
      new Error("synthetic pre-fence storage failure"),
    );
    expect(await f.controller.signOut()).toBe(false);
    await settle();
    f.event("focus");
    other.event("pageshow");
    await settle();
    expect(f.registration.begin()).toBeNull();
    expect(other.registration.begin()).toBeNull();
    expect(await f.controller.signOut()).toBe(true);
    await settle();
    expect(other.controller.state.account).toBeNull();
  });
  it("does not bypass pending purge with fresh authentication", async () => {
    const f = fixture();
    await f.controller.start();
    f.data.account = null;
    f.data.cleanupPending = true;
    expect(await f.controller.activateVerifiedAccount(B)).toBe(false);
    expect(f.repo.activateAccount).not.toHaveBeenCalled();
    expect(f.controller.state.cleanupPending).toBe(true);
    expect(await f.controller.retryCleanup()).toBe(true);
    expect(f.repo.activateAccount).not.toHaveBeenCalled();
    expect(f.controller.state.account).toBeNull();
    expect(await f.controller.activateVerifiedAccount(B)).toBe(true);
    expect(f.controller.state.account?.ownerId).toBe(B);
  });
  it("switches accounts only after fencing/purging the old account and rejects its late token", async () => {
    const f = fixture();
    await f.controller.start();
    const old = f.registration.begin()!,
      oldAccount = f.data.account;
    expect(await f.controller.activateVerifiedAccount(B)).toBe(true);
    expect(f.repo.signOut).toHaveBeenCalledWith(oldAccount);
    expect(f.controller.current(old)).toBe(false);
    expect(f.controller.state.account?.ownerId).toBe(B);
    expect(await f.controller.activateVerifiedAccount("bad")).toBe(false);
  });
  it("a superseded queued account transition cannot activate its stale identity", async () => {
    const f = fixture();
    await f.controller.start();
    const delayed = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(delayed.promise);
    const first = f.controller.activateVerifiedAccount(B);
    await settle();
    const second = f.controller.activateVerifiedAccount(A);
    delayed.resolve(f.data);
    expect(await first).toBe(false);
    await second;
    expect(f.repo.activateAccount).not.toHaveBeenCalledWith(B);
    expect(f.controller.state.account?.ownerId).toBe(A);
  });
  it("ignores malformed, own and duplicate messages; a message never fabricates stored permission", async () => {
    const f = fixture();
    await f.controller.start();
    const before = f.controller.state.generation;
    f.messages.emit(null);
    f.messages.emit({ kind: "changed" });
    expect(f.controller.state.generation).toBe(before);
    const message = {
      version: 1,
      kind: "closing",
      id: createUuidV7(),
      sender: createUuidV7(),
      epoch: f.data.account!.epoch,
    };
    f.messages.emit(message);
    await settle();
    const closed = f.controller.state.generation;
    f.messages.emit(message);
    expect(f.controller.state.generation).toBe(closed);
    expect(f.registration.begin()).toBeNull();
    const own = f.messages.post.mock.calls.at(-1)?.[0];
    if (own) f.messages.emit(own);
  });
});

describe("interrupted lifecycle recovery", () => {
  it("signout during cold start still fences the stored account before any private view opens", async () => {
    const f = fixture();
    const slow = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(slow.promise);
    const start = f.controller.start();
    const account = f.data.account;
    expect(await f.controller.signOut()).toBe(true);
    expect(f.repo.signOut).toHaveBeenCalledWith(account);
    slow.resolve({ ...f.data, account });
    await start;
    expect(f.registration.begin()).toBeNull();
    expect(f.controller.state.account).toBeNull();
  });
  it("signout can resume already-fenced cleanup and retry a purge failure", async () => {
    const f = fixture();
    f.data.account = null;
    f.data.cleanupPending = true;
    await f.controller.start();
    vi.mocked(f.repo.resumeCleanup).mockRejectedValueOnce(
      new Error("synthetic purge failure"),
    );
    expect(await f.controller.retryCleanup()).toBe(false);
    expect(f.controller.state.cleanupPending).toBe(true);
    expect(await f.controller.signOut()).toBe(true);
    expect(f.controller.state.cleanupPending).toBe(false);
    expect(f.repo.signOut).not.toHaveBeenCalled();
  });
  it("anonymous signout succeeds without fabricating a resource or account", async () => {
    const f = fixture();
    f.data.account = null;
    f.data.resources = [];
    await f.controller.start();
    expect(await f.controller.signOut()).toBe(true);
    expect(f.repo.signOut).not.toHaveBeenCalled();
    expect(f.registration.begin()).toBeNull();
  });
  it("an inspection resolving after rollback stays closed and persists its own lease observation on retry", async () => {
    const f = fixture();
    const slow = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(slow.promise);
    const start = f.controller.start();
    f.now = START - 1;
    slow.resolve(f.data);
    await start;
    expect(f.registration.begin()).toBeNull();
    expect(f.errors).toHaveBeenCalledWith("repository");
    f.event("focus");
    await settle();
    expect(f.repo.runtimeState).toHaveBeenLastCalledWith(
      [R],
      expect.objectContaining({
        observedAtMs: START,
        leases: [
          expect.objectContaining({ leaseId: f.data.resources[0].leaseId }),
        ],
      }),
    );
    expect(f.registration.begin()).toBeNull();
  });
  it("does not let a hidden online event inspect or renew local permission", async () => {
    const f = fixture();
    await f.controller.start();
    f.hide();
    const calls = vi.mocked(f.repo.runtimeState).mock.calls.length;
    f.event("online");
    await settle();
    expect(vi.mocked(f.repo.runtimeState).mock.calls.length).toBe(calls);
    expect(f.registration.begin()).toBeNull();
  });
  it("clock polling detects rollback even if no view read completes", async () => {
    const f = fixture();
    await f.controller.start();
    f.now = START - 1;
    const timer = [...f.timers.values()][0];
    timer.run();
    await settle();
    expect(f.registration.begin()).toBeNull();
    expect(f.view.hide).toHaveBeenCalledWith("clock", expect.anything());
  });
  it("rejects malformed persisted accounts and defers later retry without an available callback", async () => {
    const f = fixture();
    f.data.account!.epoch = "corrupt";
    await f.controller.start();
    expect(f.registration.begin()).toBeNull();
    expect(f.view.available).not.toHaveBeenCalled();
    expect(f.errors).toHaveBeenCalledWith("repository");
  });
  it("an obsolete rejected inspection cannot close a newer successfully inspected view", async () => {
    const f = fixture();
    await f.controller.start();
    const slow = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(slow.promise);
    f.event("focus");
    f.event("pageshow");
    await settle();
    expect(f.registration.begin()).not.toBeNull();
    slow.reject(new Error("obsolete read"));
    await settle();
    expect(f.registration.begin()).not.toBeNull();
  });
  it("a storage failure after signout fence leaves both views closed even if message transport fails", async () => {
    const f = fixture();
    await f.controller.start();
    f.messages.post.mockImplementation(() => {
      throw new Error("synthetic broadcast failure");
    });
    vi.mocked(f.repo.signOut).mockImplementationOnce(async () => {
      f.data.account = null;
      f.data.cleanupPending = true;
      throw Error("synthetic purge failure");
    });
    expect(await f.controller.signOut()).toBe(false);
    expect(f.registration.begin()).toBeNull();
    expect(f.errors).toHaveBeenCalledWith("message");
    expect(f.controller.state.cleanupPending).toBe(true);
  });
  it("dispose during an account lookup cannot activate or reopen later", async () => {
    const f = fixture();
    await f.controller.start();
    const slow = deferred<OfflineRuntimeState>();
    vi.mocked(f.repo.runtimeState).mockReturnValueOnce(slow.promise);
    const pending = f.controller.activateVerifiedAccount(B);
    await settle();
    f.controller.dispose();
    slow.resolve(f.data);
    expect(await pending).toBe(false);
    expect(f.repo.activateAccount).not.toHaveBeenCalled();
  });
  it("callback exceptions stay isolated and do not prevent the next lifecycle lock", async () => {
    const f = fixture();
    f.states.mockImplementation(() => {
      throw Error("synthetic observer");
    });
    f.errors.mockImplementation(() => {
      throw Error("synthetic reporter");
    });
    f.online.mockImplementation(() => {
      throw Error("synthetic online");
    });
    f.view.available = () => {
      throw Error("synthetic render");
    };
    await f.controller.start();
    const token = f.registration.begin()!;
    f.event("online");
    await settle();
    f.hide();
    expect(token.signal.aborted).toBe(true);
    expect(f.registration.begin()).toBeNull();
  });
  it("revokes a URL created just as the view crosses its final deadline", async () => {
    const f = fixture();
    await f.controller.start();
    const token = f.registration.begin()!;
    vi.mocked(f.environment.createObjectURL).mockImplementation(() => {
      f.now = START + 1000;
      return "blob:late";
    });
    expect(f.controller.objectURL(token, new Blob())).toBeNull();
    expect(f.environment.revokeObjectURL).toHaveBeenCalledWith("blob:late");
    expect(f.controller.objectURL(token, new Blob())).toBeNull();
  });
});

it("keeps signout bound to the captured epoch if another tab has already activated a different account", async () => {
  const f = fixture();
  await f.controller.start();
  const old = f.data.account;
  f.data.account = { ownerId: B, epoch: createUuidV7() };
  f.data.resources = [];
  expect(await f.controller.signOut()).toBe(false);
  expect(f.repo.signOut).not.toHaveBeenCalled();
  expect(f.data.account?.ownerId).toBe(B);
  expect(f.data.account?.epoch).not.toBe(old?.epoch);
});

describe("separate non-authorizing permission check tokens", () => {
  it("allows online checks for an absent or expired grant without permitting UI commit or Blob URLs", async () => {
    const f = fixture();
    f.data.resources = [];
    await f.controller.start();
    expect(f.registration.begin()).toBeNull();
    const check = f.registration.beginPermissionCheck()!;
    expect(check.account).toEqual(f.data.account);
    expect(f.controller.currentPermissionCheck(check)).toBe(true);
    expect(
      f.controller.commit(check, () => {
        throw Error("permission token painted");
      }),
    ).toBe(false);
    expect(f.controller.objectURL(check, new Blob())).toBeNull();
    f.controller.finish(check);
    expect(f.controller.currentPermissionCheck(check)).toBe(false);
    f.data.resources = [
      {
        ritualId: R,
        read: false,
        sourceEdit: false,
        readDeadlineMs: START - 1,
        sourceDeadlineMs: START - 1,
        leaseId: createUuidV7(),
        bundleLeaseId: null,
      },
    ];
    await f.controller.changed();
    const expired = f.registration.beginPermissionCheck()!;
    expect(f.controller.currentPermissionCheck(expired)).toBe(true);
    expect(f.registration.begin()).toBeNull();
  });
  it("aborts permission checks on hide/signout and rejects late replies without allowing an account switch", async () => {
    const f = fixture();
    await f.controller.start();
    const first = f.registration.beginPermissionCheck()!;
    f.hide();
    expect(first.signal.aborted).toBe(true);
    expect(f.controller.currentPermissionCheck(first)).toBe(false);
    expect(f.registration.beginPermissionCheck()).toBeNull();
    f.show();
    await settle();
    const second = f.registration.beginPermissionCheck()!;
    const signout = f.controller.signOut();
    expect(second.signal.aborted).toBe(true);
    expect(f.controller.currentPermissionCheck(second)).toBe(false);
    await signout;
    expect(f.registration.beginPermissionCheck()).toBeNull();
  });
  it("does not let anonymous or unmounted views start server checks", async () => {
    const f = fixture();
    f.data.account = null;
    await f.controller.start();
    expect(f.registration.beginPermissionCheck()).toBeNull();
    f.registration.dispose();
    expect(f.registration.beginPermissionCheck()).toBeNull();
  });
});
