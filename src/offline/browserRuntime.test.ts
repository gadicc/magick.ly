// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
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

  let resolve!: (response: Response) => void;
  const delayed = instance.refreshVerifiedAccount(
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await expect(instance.coordinator.signOut()).resolves.toBe(true);
  resolve(session(B));
  await expect(delayed).resolves.toBe(false);
  expect((await instance.repository.runtimeState([])).account).toBeNull();
  instance.coordinator.dispose();
});
