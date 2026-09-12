import {
  type LoomPwaLifecycleOptions,
  type LoomSerwistLifecycleEvent,
  setupLoomPwaLifecycle,
} from "@gadicc/loom/next/pwa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import asyncConfirm from "./asyncConfirm";
import serwistStuff from "./serwistStuff";

vi.mock("./asyncConfirm", () => ({ default: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function worker() {
  return { postMessage: vi.fn() };
}

type Event = Omit<LoomSerwistLifecycleEvent, "sw"> & {
  sw?: ReturnType<typeof worker>;
};

function setup() {
  const registration = {
    waiting: null as ReturnType<typeof worker> | null,
    update: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    unregister: vi.fn(),
  };
  const ready = deferred<typeof registration>();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const client = {
    register: vi.fn().mockResolvedValue(registration),
    messageSkipWaiting: vi.fn(() => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      let handlers = listeners.get(type);
      if (!handlers) {
        handlers = new Set();
        listeners.set(type, handlers);
      }
      handlers.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const serviceWorker = { ready: ready.promise, controller: worker() };
  const reload = vi.fn();
  const onError = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker });
  vi.stubGlobal("serwist", client);
  vi.stubGlobal("location", { reload });
  return {
    registration,
    ready,
    listeners,
    client,
    reload,
    onError,
    serviceWorker,
    emit(event: Event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
    },
    start(options: LoomPwaLifecycleOptions = {}) {
      return setupLoomPwaLifecycle({
        logger: false,
        reload,
        onError,
        ...options,
      });
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("thin app wrapper using installed Loom PWA lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(asyncConfirm).mockReset();
    vi.mocked(asyncConfirm).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the app dialog and activates only after acceptance", async () => {
    const test = setup();
    const decision = deferred<boolean>();
    vi.mocked(asyncConfirm).mockReturnValue(decision.promise);
    const waiting = worker();
    test.registration.waiting = waiting;
    serwistStuff();
    test.emit({ type: "waiting", sw: waiting, isUpdate: true });
    await settle();

    expect(asyncConfirm).toHaveBeenCalledExactlyOnceWith(
      "A newer version of this web app is available, reload to update?",
    );
    expect(test.client.messageSkipWaiting).not.toHaveBeenCalled();
    decision.resolve(true);
    await settle();
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "SKIP_WAITING",
    });
    expect(test.reload).not.toHaveBeenCalled();
    test.serviceWorker.controller = waiting;
    test.emit({ type: "controlling", sw: waiting, isUpdate: true });
    await settle();
    expect(test.reload).toHaveBeenCalledOnce();
  });

  it("keeps a declined worker waiting", async () => {
    const test = setup();
    vi.mocked(asyncConfirm).mockResolvedValue(false);
    serwistStuff();
    test.emit({ type: "waiting", isUpdate: true });
    await settle();

    expect(test.client.messageSkipWaiting).not.toHaveBeenCalled();
    expect(test.reload).not.toHaveBeenCalled();
  });

  it("cleans listeners and never starts a late ready interval or unregisters", async () => {
    const test = setup();
    const cleanup = serwistStuff();
    cleanup();
    test.ready.resolve(test.registration);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(test.listeners.get("waiting")?.size).toBe(0);
    expect(test.listeners.get("controlling")?.size).toBe(0);
    expect(test.registration.update).not.toHaveBeenCalled();
    expect(test.registration.unregister).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the existing 60-second poll cadence and stops it on cleanup", async () => {
    const test = setup();
    const cleanup = serwistStuff();
    test.ready.resolve(test.registration);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(test.registration.update).toHaveBeenCalledOnce();
    cleanup();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(test.registration.update).toHaveBeenCalledOnce();
    expect(test.registration.unregister).not.toHaveBeenCalled();
  });

  it("does not reload on first installation", async () => {
    const test = setup();
    serwistStuff();
    test.emit({ type: "controlling", isUpdate: false });
    await settle();
    expect(asyncConfirm).not.toHaveBeenCalled();
    expect(test.reload).not.toHaveBeenCalled();
  });

  it("reports async registration and update errors", async () => {
    const test = setup();
    const registrationError = new Error("Registration failed");
    const updateError = new Error("Offline");
    test.client.register.mockRejectedValueOnce(registrationError);
    test.registration.update.mockRejectedValueOnce(updateError);
    test.start({ updateCheckIntervalMs: 60_000 });
    test.ready.resolve(test.registration);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(test.onError).toHaveBeenCalledWith(registrationError);
    expect(test.onError).toHaveBeenCalledWith(updateError);
  });
});
