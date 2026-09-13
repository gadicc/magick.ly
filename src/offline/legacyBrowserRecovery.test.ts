import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import Database from "gongo-client/lib/browser/Database";
import SuperJSON from "superjson";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  fenceLegacyBrowserRecoveryForSql,
  type LegacyRecoveryStorage,
  preserveLegacyBrowserRecovery,
} from "./legacyBrowserRecovery";
import { RitualOfflineDatabase } from "./storage";

type Row = Record<string, unknown>;

class Storage implements LegacyRecoveryStorage {
  readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
}

const instances: RitualOfflineDatabase[] = [];
afterEach(async () => {
  for (const database of instances.splice(0)) database.close();
  await Dexie.waitFor(Promise.resolve());
  vi.restoreAllMocks();
});

function fixture() {
  const gongo = new Database();
  clearTimeout(gongo.idb.openTimeout);
  const database = new RitualOfflineDatabase(`recovery-${createUuidV7()}`, {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  instances.push(database);
  return { gongo, database, storage: new Storage() };
}

function populate(gongo: Database) {
  gongo.populated = true;
  gongo.idb.exec("collectionsPopulated");
}

describe("legacy browser recovery archive", () => {
  it("reports an unreadable legacy database instead of treating it as empty", async () => {
    const f = fixture();
    let rejectPopulation!: (cause: Error) => void;
    Object.assign(f.gongo, {
      populationFailure: new Promise<never>((_resolve, reject) => {
        rejectPopulation = reject;
      }),
    });
    const archive = preserveLegacyBrowserRecovery(
      f.gongo,
      f.storage,
      f.database,
    );
    rejectPopulation(new Error("Legacy IndexedDB cannot be read"));
    await expect(archive).rejects.toThrow("Legacy IndexedDB cannot be read");
    expect(await f.database.quarantine.count()).toBe(0);
  });

  it("waits for Gongo population and preserves every pending form, corrupt recovery, and anonymous study row", async () => {
    const f = fixture();
    const archive = preserveLegacyBrowserRecovery(
      f.gongo,
      f.storage,
      f.database,
    );
    await Promise.resolve();
    expect(await f.database.quarantine.count()).toBe(0);

    f.gongo.collection("docs" as string)._insert({
      _id: "000000000000000000000001",
      title: "Unattributed insert",
      __pendingInsert: true,
    });
    f.gongo.collection("docs" as string)._insert({
      _id: "000000000000000000000002",
      userId: "000000000000000000000010",
      __pendingDelete: true,
      __pendingSince: 20,
    });
    f.gongo.collection("docRevisions" as string)._insert({
      _id: "000000000000000000000003",
      userId: "000000000000000000000010",
      text: "  exact source\r\nשלום\n",
      __pendingBase: { text: "old" },
    });
    f.gongo.collection("studySet" as string)._insert({
      _id: "anonymous-progress",
      setId: "cards",
      dueDate: new Date(1_700_000_000_000),
      cards: { one: { correct: 4, ref: "meaningful-legacy-reference" } },
    });
    f.gongo.collection("studySet" as string)._insert({
      _id: "owned-progress",
      userId: "000000000000000000000010",
      setId: "owned",
    });
    f.gongo.collection("studySet" as string)._insert({
      _id: "owned-pending-progress",
      userId: "000000000000000000000010",
      setId: "owned-pending",
      __pendingSince: 30,
      __pendingBase: { correct: 1 },
    });
    f.storage.values.set(
      "magickli:ritual-recovery:v1:valid",
      '{"ownerId":"000000000000000000000010","source":" x "}',
    );
    f.storage.values.set(
      "magickli:ritual-recovery:v1:corrupt",
      "{unparseable\u0000raw",
    );
    populate(f.gongo);

    expect(await archive).toEqual({
      pendingRitualOperations: 3,
      pendingStudyOperations: 1,
      recoveryEntries: 2,
      anonymousStudyRows: 1,
      quarantinedRows: 7,
    });
    const rows = await f.database.quarantine.toArray();
    expect(rows).toHaveLength(7);
    expect(
      rows.find((row) => row.originalKey.endsWith(":corrupt"))?.serialized,
    ).toBe("{unparseable\u0000raw");
    expect(
      rows.find((row) => row.originalKey.includes("docRevisions"))?.serialized,
    ).toContain("  exact source\\r\\nשלום\\n");
    const study = SuperJSON.parse<Row>(
      rows.find((row) => row.originalKey.includes("anonymous-progress"))
        ?.serialized ?? "null",
    );
    expect(study.dueDate).toEqual(new Date(1_700_000_000_000));
    expect(study.cards).toEqual({
      one: { correct: 4, ref: "meaningful-legacy-reference" },
    });
    expect(rows.some((row) => row.originalKey.includes("owned-progress"))).toBe(
      false,
    );
    expect(
      rows.some((row) => row.originalKey.includes("owned-pending-progress")),
    ).toBe(true);
    expect(rows.every((row) => !("ownerId" in row))).toBe(true);
  });

  it("preserves special primitives and fails closed on an unsupported stored value", async () => {
    const f = fixture();
    populate(f.gongo);
    const revision = {
      _id: "000000000000000000000003",
      text: "keep",
      omittedByJson: undefined,
      nan: Number.NaN,
      infinity: Number.POSITIVE_INFINITY,
      negativeZero: -0,
      __pendingSince: 1,
      __pendingInsert: true,
    };
    f.gongo.collection("docRevisions" as string)._insert(revision);
    await preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database);
    const stored = SuperJSON.parse<Row>(
      (await f.database.quarantine.toArray())[0].serialized,
    );
    expect(Object.hasOwn(stored, "omittedByJson")).toBe(true);
    expect(stored.omittedByJson).toBeUndefined();
    expect(stored.nan).toBeNaN();
    expect(stored.infinity).toBe(Number.POSITIVE_INFINITY);
    expect(Object.is(stored.negativeZero, -0)).toBe(true);

    f.gongo.collection("docRevisions" as string)._update(revision._id, {
      ...revision,
      constructor: "stored constructor value",
    });
    await expect(
      preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database),
    ).rejects.toThrow("constructor");
    expect(await f.database.quarantine.count()).toBe(1);

    f.gongo.collection("docRevisions" as string)._update(revision._id, {
      ...revision,
      invalidDate: new Date(Number.NaN),
    });
    await expect(
      preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database),
    ).rejects.toThrow("invalid date");
    expect(await f.database.quarantine.count()).toBe(1);

    const unsupported: Row = { ...revision };
    Object.defineProperty(unsupported, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "stored prototype value",
      writable: true,
    });
    f.gongo
      .collection("docRevisions" as string)
      ._update(revision._id, unsupported);
    await expect(
      preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database),
    ).rejects.toThrow("__proto__");
    expect(await f.database.quarantine.count()).toBe(1);
  });

  it("archives an actual Gongo update with nested content, dates, and its pending base", async () => {
    const f = fixture();
    const collection = f.gongo.collection("docs" as string);
    const dueDate = new Date(1_700_000_000_000);
    collection._insert({
      _id: "000000000000000000000001",
      title: "Before",
      dueDate,
      doc: {
        children: [
          {
            type: "role",
            ref: "content-reference",
            children: [{ type: "p", text: "Nested ritual" }],
          },
        ],
      },
    });
    collection.update("000000000000000000000001", {
      $set: { title: "After" },
    });
    populate(f.gongo);

    await preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database);
    const raw = SuperJSON.parse<Row>(
      (await f.database.quarantine.toArray())[0].serialized,
    );
    expect(raw).toMatchObject({
      title: "After",
      doc: {
        children: [
          {
            ref: "content-reference",
            children: [{ text: "Nested ritual" }],
          },
        ],
      },
      __pendingBase: { title: "Before" },
    });
    expect(raw.dueDate).toEqual(dueDate);
    expect((raw.__pendingBase as Row).dueDate).toEqual(dueDate);
  });

  it("is idempotent, retains earlier quarantine, and records changed source as a new immutable row", async () => {
    const f = fixture();
    populate(f.gongo);
    await f.database.quarantine.add({
      key: "existing",
      originalKey: "manual:unknown",
      serialized: "{bad",
    });
    const revision = {
      _id: "000000000000000000000003",
      text: "first",
      __pendingSince: 1,
      __pendingInsert: true,
    };
    f.gongo.collection("docRevisions" as string)._insert(revision);
    await preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database);
    await preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database);
    expect(await f.database.quarantine.count()).toBe(2);

    f.gongo.collection("docRevisions" as string)._update(revision._id, {
      ...revision,
      text: "second",
    });
    await preserveLegacyBrowserRecovery(f.gongo, f.storage, f.database);
    expect(await f.database.quarantine.count()).toBe(3);
    expect(await f.database.quarantine.get("existing")).toEqual({
      key: "existing",
      originalKey: "manual:unknown",
      serialized: "{bad",
    });
  });
});

describe("legacy SQL network fence", () => {
  it("blocks synchronously and leaves source data and subscriptions untouched when archival fails, then retries", async () => {
    const f = fixture();
    populate(f.gongo);
    const pending = {
      _id: "000000000000000000000003",
      text: "retry me",
      __pendingSince: 1,
      __pendingInsert: true,
    };
    f.gongo.collection("docRevisions" as string)._insert(pending);
    const sub = f.gongo.subscribe("docs");
    const events: string[] = [];
    const fail = () => {
      throw new Error("quota");
    };
    f.database.quarantine.hook("creating", fail);
    const first = fenceLegacyBrowserRecoveryForSql({
      cache: f.gongo,
      storage: f.storage,
      database: f.database,
      blockNetwork: () => events.push("blocked"),
      afterInitialArchive: async () => {
        events.push("paused");
      },
      finalizeFence: async () => {
        sub.stop();
        events.push("finalized");
      },
    });
    expect(events).toEqual(["blocked"]);
    await expect(first).rejects.toThrow("quota");
    expect(events).toEqual(["blocked"]);
    expect(sub.active).toBe(true);
    expect(f.gongo.collection("docRevisions").findOne(pending._id)).toEqual(
      pending,
    );

    f.database.quarantine.hook("creating").unsubscribe(fail);
    await fenceLegacyBrowserRecoveryForSql({
      cache: f.gongo,
      storage: f.storage,
      database: f.database,
      blockNetwork: () => events.push("blocked-again"),
      afterInitialArchive: async () => {
        events.push("paused");
      },
      finalizeFence: async () => {
        sub.stop();
        events.push("finalized");
      },
    });
    expect(events).toEqual(["blocked", "blocked-again", "paused", "finalized"]);
    expect(sub.active).toBe(false);
    expect(await f.database.quarantine.count()).toBe(1);
  });
});
