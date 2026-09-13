// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from "fake-indexeddb";
import type Database from "gongo-client/lib/browser/Database";
import { afterEach, expect, it, vi } from "vitest";

const databaseHarness = vi.hoisted(() => ({
  instance: undefined as Database | undefined,
}));

vi.mock("gongo-client", async () => {
  const { default: Database } = await import(
    "gongo-client/lib/browser/Database"
  );
  const db = new Database();
  clearTimeout(db.idb.openTimeout);
  // Collection behavior remains real; only the unrelated Gongo disk adapter is inert.
  db.idb.checkInit = () => {};
  db.idb.queuePutAll = async () => {};
  db.idb.putAll = async () => {};
  databaseHarness.instance = db;
  return { default: db };
});

afterEach(() => {
  const db = databaseHarness.instance;
  if (db) {
    for (const subscription of [...db.subscriptions.values()]) {
      subscription.stop();
      subscription.delete();
    }
    for (const collection of db.collections.values()) {
      collection.documents.clear();
      clearTimeout(collection._didUpdateTimeout);
    }
    clearTimeout(db._didUpdateTimeout);
    db.populated = false;
    delete (db as Database & { transport?: TestTransport }).transport;
  }
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
}

function browserStorage() {
  vi.stubGlobal("crypto", webcrypto);
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  vi.stubGlobal("IDBCursor", IDBCursor);
  vi.stubGlobal("IDBCursorWithValue", IDBCursorWithValue);
  vi.stubGlobal("IDBDatabase", IDBDatabase);
  vi.stubGlobal("IDBIndex", IDBIndex);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("IDBObjectStore", IDBObjectStore);
  vi.stubGlobal("IDBOpenDBRequest", IDBOpenDBRequest);
  vi.stubGlobal("IDBRequest", IDBRequest);
  vi.stubGlobal("IDBTransaction", IDBTransaction);
  vi.stubGlobal("IDBVersionChangeEvent", IDBVersionChangeEvent);
  return factory;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

async function seedLegacyStore(
  factory: IDBFactory,
  storeName: string,
  key: IDBValidKey,
  value: unknown,
) {
  const request = factory.open("gongo", 1);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const database = await requestResult(request);
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value, key);
  await transactionDone(transaction);
  database.close();
}

async function readLegacyDatabase(factory: IDBFactory) {
  return requestResult(factory.open("gongo"));
}

it("starts recovery-only, never creates transport work, and archives populated data", async () => {
  browserStorage();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const app = await import("./db");
  const db = app.default as unknown as Database & {
    transport?: TestTransport;
  };
  expect(db.transport).toBeUndefined();

  const revisionId = "000000000000000000000020";
  const raw = {
    _id: revisionId,
    text: "p Unsent before population",
    __pendingSince: 1,
    __pendingInsert: true,
  };
  db.collection("docRevisions" as string).documents.set(revisionId, raw);
  db.collection("studySet" as string).documents.set("local-study", {
    _id: "local-study",
    setId: "cards",
  });
  db.populated = true;
  db.idb.exec("collectionsPopulated");
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(db.transport).toBeUndefined();

  await expect(app.fenceLegacyNetworkForSql()).resolves.toMatchObject({
    pendingRitualOperations: 1,
    pendingStudyOperations: 0,
    anonymousStudyRows: 1,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(db.transport).toBeUndefined();
  expect(db.collection("docRevisions").findOne(revisionId)).toMatchObject({
    _id: revisionId,
    text: raw.text,
    __pendingInsert: true,
    __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
  });
  expect(db.collection("studySet").findOne("local-study")).toEqual({
    _id: "local-study",
    setId: "cards",
  });
});

it("blocks an injected old transport synchronously and keeps failure retries blocked", async () => {
  browserStorage();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const app = await import("./db");
  const db = app.default as unknown as Database & {
    transport?: TestTransport;
  };
  const rejectedPoll = Promise.reject(new Error("old request failed"));
  void rejectedPoll.catch(() => {});
  const transport: TestTransport = {
    poll: vi.fn(async () => {}),
    _poll: vi.fn(async () => {}),
    _promise: rejectedPoll,
  };
  db.transport = transport;
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

  const firstFence = app.fenceLegacyNetworkForSql();
  expect(transport.poll()).toBeUndefined();
  await expect(transport._poll()).resolves.toBeUndefined();
  db.populated = true;
  db.idb.exec("collectionsPopulated");
  await expect(firstFence).rejects.toThrow("recovery storage unavailable");
  expect(fetch).not.toHaveBeenCalled();
  expect(subscription.active).toBe(true);
  expect(db.collection("docRevisions").findOne(revisionId)).toMatchObject({
    text: "p Must survive failed recovery",
    __pendingInsert: true,
  });

  storageRead.mockRestore();
  await expect(app.fenceLegacyNetworkForSql()).resolves.toMatchObject({
    pendingRitualOperations: 1,
    recoveryEntries: 2,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(subscription.active).toBe(false);
  expect(db.subscriptions.has(subscription.slug())).toBe(false);
  expect(transport.poll()).toBeUndefined();
  await expect(transport._poll()).resolves.toBeUndefined();
  expect(db.collection("docRevisions").findOne(revisionId)).toMatchObject({
    text: "p Must survive failed recovery",
    __pendingInsert: true,
    __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
  });
});

it("retries a failed initial open, shares the retry, and safely adds known stores", async () => {
  const factory = browserStorage();
  const nativeOpen = factory.open.bind(factory);
  const open = vi
    .spyOn(factory, "open")
    .mockImplementationOnce(() => {
      throw new Error("temporary IndexedDB failure");
    })
    .mockImplementation((name, version) =>
      version === undefined ? nativeOpen(name) : nativeOpen(name, version),
    );
  const app = await import("./db");
  await expect(app.default.idb.open()).rejects.toThrow(
    "temporary IndexedDB failure",
  );

  const revisionId = "000000000000000000000021";
  await seedLegacyStore(factory, "docRevisions", revisionId, {
    _id: revisionId,
    text: "p Survives retry",
    __pendingSince: 1,
    __pendingInsert: true,
  });

  const first = app.fenceLegacyNetworkForSql();
  const second = app.fenceLegacyNetworkForSql();
  expect(second).toBe(first);
  await expect(first).resolves.toMatchObject({ pendingRitualOperations: 1 });
  expect(
    app.default.collection("docRevisions").findOne(revisionId),
  ).toMatchObject({
    text: "p Survives retry",
    __pendingInsert: true,
    __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
  });

  const stored = await readLegacyDatabase(factory);
  expect([...stored.objectStoreNames]).toEqual(
    expect.arrayContaining([
      "__gongoStore",
      "docs",
      "docRevisions",
      "studySet",
      "temples",
      "templeMemberships",
      "userGroups",
      "users",
    ]),
  );
  stored.close();
  expect(open).toHaveBeenCalled();
});

it("does not start another native open after timeout while the first remains pending", async () => {
  vi.useFakeTimers();
  const factory = browserStorage();
  const nativeOpen = factory.open.bind(factory);
  const inspected = {
    close: vi.fn(),
    objectStoreNames: [] as string[],
    version: 1,
  };
  const delayed = {
    error: null,
    result: inspected,
    onerror: null,
    onsuccess: null,
  } as unknown as IDBOpenDBRequest;
  const open = vi
    .spyOn(factory, "open")
    .mockImplementationOnce(() => delayed)
    .mockImplementation((name, version) =>
      version === undefined ? nativeOpen(name) : nativeOpen(name, version),
    );
  const app = await import("./db");
  const first = app.fenceLegacyNetworkForSql();
  const rejection = expect(first).rejects.toThrow(
    "Legacy browser storage population timed out.",
  );
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;

  const retry = app.fenceLegacyNetworkForSql();
  expect(open).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  delayed.onsuccess?.call(delayed, new Event("success"));
  await expect(retry).resolves.toMatchObject({ quarantinedRows: 0 });
  expect(inspected.close).toHaveBeenCalledTimes(1);
  expect(app.default.populated).toBe(true);
});

it("fails closed without deleting an unrecognized historical store", async () => {
  const factory = browserStorage();
  const bytes = new Uint8Array([0, 1, 254, 255]);
  await seedLegacyStore(factory, "historicalUnknown", "raw", {
    label: "preserve exactly",
    bytes,
  });
  const app = await import("./db");

  await expect(app.fenceLegacyNetworkForSql()).rejects.toThrow(
    "unrecognized object stores: historicalUnknown",
  );
  expect(app.default.populated).toBe(false);

  const stored = await readLegacyDatabase(factory);
  expect(stored.version).toBe(1);
  expect([...stored.objectStoreNames]).toEqual(["historicalUnknown"]);
  const transaction = stored.transaction("historicalUnknown", "readonly");
  const raw = (await requestResult(
    transaction.objectStore("historicalUnknown").get("raw"),
  )) as { label: string; bytes: Uint8Array };
  expect(raw.label).toBe("preserve exactly");
  expect(Array.from(raw.bytes)).toEqual(Array.from(bytes));
  await transactionDone(transaction);
  stored.close();
});

it("rechecks inventory when another tab adds an unknown store at Gongo's recursive upgrade", async () => {
  const factory = browserStorage();
  await seedLegacyStore(factory, "docRevisions", "000000000000000000000022", {
    _id: "000000000000000000000022",
    text: "p Known row",
  });
  const nativeOpen = factory.open.bind(factory);
  let calls = 0;
  vi.spyOn(factory, "open").mockImplementation((name, version) => {
    calls += 1;
    if (calls === 3) {
      // Outer inventory and Gongo's first v1 open have completed. Model a
      // second tab winning the v2 upgrade immediately before Gongo recurses.
      expect(version).toBeUndefined();
      const raced = nativeOpen(name, 2);
      raced.onupgradeneeded = () => {
        raced.result
          .createObjectStore("racedUnknown")
          .put(new Uint8Array([7, 8, 9]), "raw");
      };
      return raced;
    }
    return version === undefined ? nativeOpen(name) : nativeOpen(name, version);
  });
  const app = await import("./db");

  await expect(app.fenceLegacyNetworkForSql()).rejects.toThrow(
    "unrecognized object stores: racedUnknown",
  );

  const stored = await readLegacyDatabase(factory);
  expect(stored.version).toBe(2);
  expect([...stored.objectStoreNames]).toEqual([
    "docRevisions",
    "racedUnknown",
  ]);
  const transaction = stored.transaction("racedUnknown", "readonly");
  const bytes = (await requestResult(
    transaction.objectStore("racedUnknown").get("raw"),
  )) as Uint8Array;
  expect(Array.from(bytes)).toEqual([7, 8, 9]);
  await transactionDone(transaction);
  stored.close();
});
