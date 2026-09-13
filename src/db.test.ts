// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type Database from "gongo-client/lib/browser/Database";
import { afterEach, expect, it, vi } from "vitest";
import { readRitualRecovery } from "./doc/drafts";

vi.mock("gongo-client", async () => {
  const { default: Database } = await import(
    "gongo-client/lib/browser/Database"
  );
  const db = new Database();
  clearTimeout(db.idb.openTimeout);
  // Replace only disk IO; collection events, populated gate, transport and change sets are real.
  db.idb.checkInit = () => {};
  db.idb.queuePutAll = async () => {};
  db.idb.putAll = async () => {};
  return { default: db };
});
vi.mock("gongo-client/lib/transports/http", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return {
    default: require("gongo-client/lib/browser/transports/http").default,
  };
});
vi.mock("next-auth/react", () => ({ getSession: vi.fn(async () => null) }));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.resetModules();
});

interface TestTransport {
  poll(): Promise<void> | undefined;
  _poll(): Promise<void>;
  _promise?: Promise<void> | null;
  timeout?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

function stopTransportTimers(transport: TestTransport) {
  clearTimeout(transport.timeout);
  clearTimeout(transport.idleTimer);
}

it("manual network enable waits for populated pending data, archives before real change sets, and keeps one transport", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const require = createRequire(import.meta.url);
  const ARSON = createRequire(require.resolve("gongo-client/package.json"))(
    "arson",
  );
  const requests: { calls: [string, unknown][] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const body = ARSON.decode(options.body);
      requests.push(body);
      return new Response(
        ARSON.encode({
          calls: body.calls.map(() => ({ $result: { results: [] } })),
        }),
      );
    }),
  );
  const { getSession } = await import("next-auth/react");
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "01993000-0000-7000-8000-000000000001" },
  } as never);
  const app = await import("./db");
  const db = app.default as unknown as Database & {
    transport: TestTransport;
  };
  app.enableNetwork();
  const transport = db.transport;
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(db.populated).toBe(false);
  expect(requests).toEqual([]);
  expect(localStorage.length).toBe(0);

  const actor = "000000000000000000000001";
  const revisionId = "000000000000000000000020";
  const raw = {
    _id: revisionId,
    docId: "000000000000000000000010",
    userId: actor,
    text: "p Unsent before population",
    __pendingSince: 1,
    __pendingInsert: true,
  };
  // Match GongoIDB.open(): install persisted rows, then flip populated and emit.
  db.collection("docRevisions" as string).documents.set(revisionId, raw);
  db.collection("studySet" as string).documents.set("local-study", {
    _id: "local-study",
    setId: "cards",
  });
  db.populated = true;
  db.idb.exec("collectionsPopulated");
  expect(db.transport).toBe(transport);
  // Capture the poll scheduled by the population event. Calling poll after it
  // finishes would create a fresh debounce timer.
  const firstPoll = transport.poll();
  expect(firstPoll).toBeInstanceOf(Promise);
  await firstPoll;
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests
      .flatMap((request) => request.calls)
      .every(([name]) => name === "subscribe"),
  ).toBe(true);
  expect(db.getChangeSet()).toBeNull();
  expect(readRitualRecovery(localStorage, actor)).toContainEqual(
    expect.objectContaining({ kind: "legacy", raw }),
  );
  expect(db.collection("docRevisions").findOne(revisionId)).toMatchObject({
    __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
  });
  expect(db.collection("studySet").findOne("local-study")).not.toHaveProperty(
    "userId",
  );

  // The still-live legacy path retains its ObjectID behavior until the explicit
  // SQL fence, but a SQL account UUID above can never adopt anonymous progress.
  vi.mocked(getSession).mockResolvedValue({ user: { id: actor } } as never);
  const legacyPoll = transport.poll();
  await legacyPoll;
  expect(db.collection("studySet").findOne("local-study")).toMatchObject({
    userId: actor,
  });
  stopTransportTimers(transport);
});

it("the SQL fence blocks an existing transport before population and retries recovery without sending", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const app = await import("./db");
  const db = app.default as unknown as Database & {
    transport: TestTransport;
  };
  app.enableNetwork();
  const transport = db.transport;
  const subscription = db.subscribe("docs");
  const revisionId = "000000000000000000000020";
  db.collection("docRevisions" as string).documents.set(revisionId, {
    _id: revisionId,
    text: "p Must survive failed recovery",
    __pendingSince: 1,
    __pendingInsert: true,
  });
  localStorage.setItem("magickli:ritual-recovery:v1:corrupt", "{raw recovery");
  const storageRead = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementationOnce(() => {
      throw new Error("recovery storage unavailable");
    });
  const failedPoll = Promise.reject(new Error("old transport failed"));
  void failedPoll.catch(() => {});
  transport._promise = failedPoll;

  const firstFence = app.fenceLegacyNetworkForSql();
  expect(transport.poll()).toBeUndefined();
  app.enableNetwork();
  expect(db.transport).toBe(transport);
  db.populated = true;
  db.idb.exec("collectionsPopulated");
  await expect(firstFence).rejects.toThrow("recovery storage unavailable");
  expect(fetch).not.toHaveBeenCalled();
  expect(subscription.active).toBe(true);
  expect(db.getChangeSet()).not.toBeNull();

  storageRead.mockRestore();
  await expect(app.fenceLegacyNetworkForSql()).resolves.toMatchObject({
    pendingRitualOperations: 1,
    recoveryEntries: 2,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(subscription.active).toBe(false);
  expect(db.subscriptions.has(subscription.slug())).toBe(false);
  expect(db.getChangeSet()).toBeNull();
  app.enableNetwork();
  expect(transport.poll()).toBeUndefined();
  stopTransportTimers(transport);
});
