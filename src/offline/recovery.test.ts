import { describe, expect, it, vi } from "vitest";
import { LockedRecoveryQueue } from "./recovery";

describe("opaque locked recovery persistence", () => {
  it("deduplicates in-flight work and releases only after durable success", async () => {
    const queue = new LockedRecoveryQueue();
    let resolve!: () => void;
    const wait = new Promise<void>((yes) => {
      resolve = yes;
    });
    const persist = vi.fn(() => wait),
      handle = { persist };
    queue.add(handle);
    queue.add(handle);
    const retry = queue.retry();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledOnce();
    expect(queue.state).toEqual({ pending: 1, saving: 1, failed: 0 });
    resolve();
    await retry;
    expect(queue.state.pending).toBe(0);
  });
  it("retains failed handles without exposing source and isolates throwing observers", async () => {
    const queue = new LockedRecoveryQueue();
    queue.subscribe(() => {
      throw Error("synthetic observer");
    });
    const values: unknown[] = [];
    const remove = queue.subscribe((value) => values.push(value));
    let attempt = 0;
    queue.add({
      persist: async () => {
        if (++attempt === 1) throw Error("synthetic full disk");
      },
    });
    await queue.retry();
    expect(queue.state.failed).toBe(1);
    expect(Object.keys(queue.state).sort()).toEqual([
      "failed",
      "pending",
      "saving",
    ]);
    remove();
    const count = values.length;
    await queue.retry();
    expect(queue.state.pending).toBe(0);
    expect(values).toHaveLength(count);
  });
});

it("publishes an in-flight attempt before a saving observer can reenter retry", async () => {
  const queue = new LockedRecoveryQueue();
  let resolve!: () => void;
  const wait = new Promise<void>((yes) => {
    resolve = yes;
  });
  const persist = vi.fn(() => wait);
  let reentered = false,
    retry: Promise<void> | undefined;
  queue.subscribe((state) => {
    if (state.saving && !reentered) {
      reentered = true;
      retry = queue.retry();
    }
  });
  queue.add({ persist });
  await Promise.resolve();
  expect(reentered).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
  resolve();
  await retry;
  expect(queue.state).toEqual({ pending: 0, saving: 0, failed: 0 });
});
