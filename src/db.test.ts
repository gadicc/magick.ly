// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
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
});

it("manual network enable waits for populated pending data, archives before real change sets, and keeps one transport", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", webcrypto);
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
  const app = await import("./db");
  const db = app.default as unknown as Database & {
    transport: { poll(): Promise<void> | undefined; _poll(): Promise<void> };
  };
  app.enableNetwork();
  const transport = db.transport;
  await vi.advanceTimersByTimeAsync(500);
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
  db.populated = true;
  db.idb.exec("collectionsPopulated");
  expect(db.transport).toBe(transport);
  // Capture the already scheduled poll before advancing: calling poll after it
  // finishes would create a fresh debounce timer and await it without advancing.
  const firstPoll = transport.poll();
  expect(firstPoll).toBeInstanceOf(Promise);
  await vi.advanceTimersByTimeAsync(500);
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
});
