// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createSqlBrowserLifecycle } from "../auth/browserLifecycle";
import { createBrowserOfflineRuntime } from "./browserRuntime";
import { RitualOfflineDatabase } from "./storage";

const A = "019947c5-abcd-7000-8000-000000000001";
const B = "019947c5-abcd-7000-8000-000000000002";
const databases: RitualOfflineDatabase[] = [];

class SilentChannel extends EventTarget {
  postMessage() {}
}

function session(ownerId: string) {
  const response = Response.json(
    {
      user: { id: ownerId, name: null, image: null },
      admin: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  Object.defineProperty(response, "url", {
    value: `${location.origin}/api/session`,
  });
  return response;
}

function runtime() {
  vi.stubGlobal("BroadcastChannel", SilentChannel);
  const database = new RitualOfflineDatabase(`browser-${crypto.randomUUID()}`, {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  databases.push(database);
  return createBrowserOfflineRuntime(database);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

it("ignores a delayed verified identity after explicit sign-out", async () => {
  const instance = runtime();
  await instance.start();
  await expect(
    instance.refreshVerifiedAccount(vi.fn(async () => session(A))),
  ).resolves.toBe(true);

  const response = deferred<Response>();
  const delayedFetcher = vi.fn(() => response.promise);
  const queuedFetcher = vi.fn(async () => session(B));
  const delayed = instance.refreshVerifiedAccount(delayedFetcher);
  await vi.waitFor(() => expect(delayedFetcher).toHaveBeenCalledOnce());
  const queued = instance.refreshVerifiedAccount(queuedFetcher);
  await expect(instance.signOut()).resolves.toBe(true);
  response.resolve(session(B));
  await expect(delayed).resolves.toBe(false);
  await expect(queued).resolves.toBe(false);
  expect(queuedFetcher).not.toHaveBeenCalled();
  expect((await instance.repository.runtimeState([])).account).toBeNull();
  instance.coordinator.dispose();
});

it("freshly verifies a newer bridge identity after an older reader check", async () => {
  const instance = runtime();
  await instance.start();
  const oldSession = deferred<Response>();
  const readerFetcher = vi.fn(() => oldSession.promise);
  const bridgeFetcher = vi.fn(async () => session(B));
  const activateStudy = vi.fn(async () => {});
  const lifecycle = createSqlBrowserLifecycle({
    async refreshPrivateAccount() {
      if (!(await instance.refreshVerifiedAccount(bridgeFetcher))) return null;
      return instance.coordinator.state.account?.ownerId ?? null;
    },
    activateStudy,
    prepareStudySignOut: vi.fn(async () => {}),
    preparePrivateSignOut: () => instance.signOut(),
    signOutAuth: vi.fn(async () => true),
    replace: vi.fn(),
  });

  const reader = instance.refreshVerifiedAccount(readerFetcher);
  await vi.waitFor(() => expect(readerFetcher).toHaveBeenCalledOnce());
  const bridge = lifecycle.refreshVerifiedAccount();
  expect(bridgeFetcher).not.toHaveBeenCalled();

  oldSession.resolve(session(A));
  await expect(reader).resolves.toBe(true);
  await expect(bridge).resolves.toBe(true);
  expect(bridgeFetcher).toHaveBeenCalledOnce();
  expect(activateStudy).toHaveBeenCalledWith(B);
  expect(instance.coordinator.state.account?.ownerId).toBe(B);
  instance.coordinator.dispose();
});

it("runs a queued fresh account check after an older network failure", async () => {
  const instance = runtime();
  await instance.start();
  const offline = deferred<Response>();
  const offlineFetcher = vi.fn(() => offline.promise);
  const first = instance.refreshVerifiedAccount(offlineFetcher);
  await vi.waitFor(() => expect(offlineFetcher).toHaveBeenCalledOnce());
  const nextFetcher = vi.fn(async () => session(A));
  const next = instance.refreshVerifiedAccount(nextFetcher);
  expect(nextFetcher).not.toHaveBeenCalled();

  offline.reject(new TypeError("Failed to fetch"));
  await expect(first).resolves.toBe(false);
  await expect(next).resolves.toBe(true);
  expect(nextFetcher).toHaveBeenCalledOnce();
  instance.coordinator.dispose();
});
