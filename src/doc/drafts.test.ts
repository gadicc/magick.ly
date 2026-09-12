import Database from "gongo-client/lib/browser/Database";
import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isUuidV7 } from "../lib/ids";
import {
  boundedRitualRpc,
  clientRitualId,
  type DraftStorage,
  loadRitualSnapshot,
  newRitualDraft,
  persistRitualRecovery,
  preservePendingRitualChanges,
  type RitualDraft,
  readRitualRecovery,
  ritualListSubscriptionArgs,
  submitRitualDraft,
} from "./drafts";

// Use the installed Gongo cursor and change-set implementation without opening IndexedDB.
function cache() {
  const db = new Database();
  clearTimeout(db.idb.openTimeout);
  return {
    collection: (name: string) => db.collection(name),
    getChangeSet: () => db.getChangeSet(),
  };
}

const actor = "000000000000000000000001";
const other = "000000000000000000000002";
const docId = "000000000000000000000010";
const revisionId = "000000000000000000000020";
const nextRevisionId = "000000000000000000000021";
const snapshot = { docId, revisionId, updatedAt: 100, source: "p Original" };
const success = {
  ok: true,
  docId,
  revisionId: nextRevisionId,
  updatedAt: 200,
  replayed: false,
};
class Storage implements DraftStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function editor() {
  const storage = new Storage();
  let draft = { ...newRitualDraft(actor, snapshot), source: "p Edited" };
  const save = (value: RitualDraft) => {
    draft = value;
    persistRitualRecovery(storage, value);
  };
  return {
    storage,
    get draft() {
      return draft;
    },
    save,
    current: () => draft,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("legacy pending ritual recovery", () => {
  it("archives real Gongo pending inserts/edits/deletes before pausing generic changes, retaining raw source and base", async () => {
    const db = cache();
    const storage = new Storage();
    const raw = {
      _id: revisionId,
      docId,
      userId: actor,
      text: "p Unsent secret",
      __pendingSince: 50,
      __pendingBase: { text: "p Base" },
      __ObjectIDs: ["_id", "docId", "userId"],
    };
    db.collection("docRevisions")._insert(raw);
    db.collection("docs")._insert({
      _id: docId,
      userId: actor,
      __pendingSince: 51,
      __pendingDelete: true,
      doc: { children: [{ src: "kept.png", text: "compiled text" }] },
    });
    db.collection("docs")._insert({
      _id: nextRevisionId,
      userId: other,
      __pendingSince: 52,
      __pendingInsert: true,
    });
    await preservePendingRitualChanges(db, storage);
    const records = readRitualRecovery(storage, actor, docId);
    expect(records).toHaveLength(2);
    expect(
      records.find(
        (item) => item.kind === "legacy" && item.collection === "docRevisions",
      ),
    ).toMatchObject({ raw });
    expect(
      records.find(
        (item) => item.kind === "legacy" && item.collection === "docs",
      ),
    ).toMatchObject({
      raw: {
        __pendingDelete: true,
        doc: { children: [{ src: "kept.png", text: "compiled text" }] },
      },
    });
    expect(readRitualRecovery(storage, other)).toHaveLength(1);
    expect(db.getChangeSet()).toBeNull();
    expect(db.collection("docRevisions").findOne(revisionId)).toMatchObject({
      ...raw,
      __error: "RITUAL_EDITOR_UPGRADE_REQUIRED",
    });
    await preservePendingRitualChanges(db, storage);
    expect(storage.length).toBe(3);
    db.collection("docRevisions")._insert({
      _id: revisionId,
      text: "p New server value",
    });
    expect(readRitualRecovery(storage, actor, docId)).toContainEqual(
      expect.objectContaining({
        raw: expect.objectContaining({ text: "p Unsent secret" }),
      }),
    );
  });

  it("does not mutate pending data when durable storage fails", async () => {
    const db = cache();
    db.collection("docRevisions")._insert({
      _id: revisionId,
      docId,
      userId: actor,
      text: "p Unsaved",
      __pendingSince: 5,
      __pendingInsert: true,
    });
    const storage = new Storage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(preservePendingRitualChanges(db, storage)).rejects.toThrow(
      "quota",
    );
    expect(
      db.collection("docRevisions").findOne(revisionId),
    ).not.toHaveProperty("__error");
    expect(db.getChangeSet()).not.toBeNull();
  });

  it("retains unattributed raw pending data without assigning it to the current account", async () => {
    const db = cache();
    const storage = new Storage();
    db.collection("docs")._insert({
      _id: docId,
      __pendingSince: 1,
      __pendingInsert: true,
      title: "Unattributed",
    });
    await preservePendingRitualChanges(db, storage);
    expect(storage.length).toBe(1);
    expect(JSON.parse([...storage.values.values()][0])).toMatchObject({
      ownerId: null,
      raw: { title: "Unattributed" },
    });
    expect(readRitualRecovery(storage, actor)).toEqual([]);
  });
});

describe("fresh authorized source snapshots", () => {
  const doc = {
    _id: docId,
    canEdit: true,
    docRevisionId: revisionId,
    __updatedAt: 100,
  };
  const revision = { _id: revisionId, docId, text: "p Original" };
  const response = (coll: string, entries: object[]) => ({
    results: [{ coll, entries }],
  });
  it("requests full snapshots with exact parent binding and known ObjectId conversion", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(
        response("docs", [
          {
            ...doc,
            _id: new ObjectId(docId),
            docRevisionId: new ObjectId(revisionId),
          },
        ]),
      )
      .mockResolvedValueOnce(response("docRevisions", [revision]));
    expect(await loadRitualSnapshot(rpc, docId)).toEqual(snapshot);
    expect(rpc.mock.calls.map(([, args]) => args.updatedAt)).toEqual([{}, {}]);
    expect(rpc.mock.calls[1][1].args).toEqual({ docId });
    expect(clientRitualId({ toString: () => docId })).toBeNull();
  });
  it.each([{ canEdit: false }, { canEdit: undefined }, { __deleted: true }])(
    "does not request source history for a noneditor or tombstone",
    async (patch) => {
      const rpc = vi
        .fn()
        .mockResolvedValue(response("docs", [{ ...doc, ...patch }]));
      await expect(loadRitualSnapshot(rpc, docId)).rejects.toThrow(
        "unavailable",
      );
      expect(rpc).toHaveBeenCalledOnce();
    },
  );
  it.each([
    { docId: other },
    { _id: nextRevisionId },
    { text: undefined },
    { __deleted: true },
  ])("rejects unrelated or missing current source", async (patch) => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(response("docs", [doc]))
      .mockResolvedValueOnce(
        response("docRevisions", [{ ...revision, ...patch }]),
      );
    await expect(loadRitualSnapshot(rpc, docId)).rejects.toThrow(
      "source is unavailable",
    );
  });
  it.each([{ docRevisionId: "bad" }, { __updatedAt: "100" }])(
    "rejects invalid concurrency tokens",
    async (patch) => {
      const rpc = vi
        .fn()
        .mockResolvedValue(response("docs", [{ ...doc, ...patch }]));
      await expect(loadRitualSnapshot(rpc, docId)).rejects.toThrow("invalid");
    },
  );
  it("opens an authorized empty legacy document without requesting history", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue(response("docs", [{ _id: docId, canEdit: true }]));
    expect(await loadRitualSnapshot(rpc, docId)).toEqual({
      docId,
      source: "",
      revisionId: null,
      updatedAt: null,
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("acknowledged ritual draft saves", () => {
  it("gives concurrent editor instances independent UUIDv7 draft records", () => {
    const one = newRitualDraft(actor, snapshot);
    const two = newRitualDraft(actor, snapshot, one);
    expect(one.id).not.toBe(two.id);
    expect(isUuidV7(one.id) && isUuidV7(two.id)).toBe(true);
  });
  it("persists immutable request before dispatch, retaining typing during a successful save", async () => {
    const model = editor();
    const gate = deferred<unknown>();
    const rpc = vi.fn((name, payload) => {
      expect(name).toBe("ritualWrite");
      expect(readRitualRecovery(model.storage, actor)[0]).toMatchObject({
        request: payload,
      });
      return gate.promise;
    });
    const saving = submitRitualDraft(
      model.draft,
      rpc,
      model.save,
      model.current,
    );
    expect(model.draft.savedSource).toBe("p Original");
    const request = model.draft.request;
    expect(request).toMatchObject({
      source: "p Edited",
      expectedRevisionId: revisionId,
      expectedUpdatedAt: 100,
      expectedActorId: actor,
    });
    model.save({ ...model.draft, source: "p Typed during save" });
    gate.resolve(success);
    await saving;
    expect(model.draft).toMatchObject({
      source: "p Typed during save",
      savedSource: "p Edited",
      baseRevisionId: nextRevisionId,
      baseUpdatedAt: 200,
    });
    expect(model.draft.request).toBeUndefined();
  });
  it("retries an uncertain operation unchanged after reload even if source is edited", async () => {
    const model = editor();
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(success);
    await expect(
      submitRitualDraft(model.draft, rpc, model.save, model.current),
    ).rejects.toThrow("offline");
    const request = model.draft.request;
    model.save({
      ...newRitualDraft(actor, snapshot, model.draft),
      source: "p Newer local edit",
    });
    await submitRitualDraft(model.draft, rpc, model.save, model.current);
    expect(rpc.mock.calls[1][1]).toEqual(request);
    expect(model.draft.source).toBe("p Newer local edit");
    expect(model.draft.savedSource).toBe("p Edited");
  });
  it.each(["INVALID_SOURCE", "CONFLICT"])(
    "preserves a rejected request while allowing a correction with a new request",
    async (code) => {
      const model = editor();
      const oldId = model.draft.id;
      await submitRitualDraft(
        model.draft,
        vi
          .fn()
          .mockResolvedValue({ ok: false, code, message: "Review source" }),
        model.save,
        model.current,
      );
      expect(model.draft.id).not.toBe(oldId);
      expect(model.draft.request).toBeUndefined();
      expect(model.draft.source).toBe("p Edited");
      expect(model.draft.baseUpdatedAt).toBe(100);
      expect(readRitualRecovery(model.storage, actor)).toContainEqual(
        expect.objectContaining({
          id: oldId,
          request: expect.objectContaining({ source: "p Edited" }),
        }),
      );
    },
  );
  it.each(["UNAVAILABLE", "ACCOUNT_CHANGED"])(
    "retains exactly the pending request on %s",
    async (code) => {
      const model = editor();
      await submitRitualDraft(
        model.draft,
        vi
          .fn()
          .mockResolvedValue({ ok: false, code, message: "Retry as owner" }),
        model.save,
        model.current,
      );
      expect(model.draft.request).toMatchObject({
        source: "p Edited",
        expectedActorId: actor,
      });
      expect(model.draft.savedSource).toBe("p Original");
    },
  );
  it("does not dispatch if saving the immutable request fails", async () => {
    const model = editor();
    const rpc = vi.fn();
    vi.spyOn(model.storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(
      submitRitualDraft(model.draft, rpc, model.save, model.current),
    ).rejects.toThrow("quota");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ok: true },
    { ...success, docId: other },
    { ...success, revisionId: "bad" },
    { ok: false, code: "new-unknown-code", message: "unknown" },
  ])(
    "retains source and pending request for invalid acknowledgements",
    async (result) => {
      const model = editor();
      await expect(
        submitRitualDraft(
          model.draft,
          vi.fn().mockResolvedValue(result),
          model.save,
          model.current,
        ),
      ).rejects.toThrow();
      expect(model.draft.request).toBeDefined();
      expect(model.draft.savedSource).toBe("p Original");
    },
  );
  it("refuses to dispatch a request from another draft owner", async () => {
    const model = editor();
    model.save({
      ...model.draft,
      request: {
        version: 1,
        kind: "save",
        expectedActorId: other,
        operationId: model.draft.id,
        docId,
        expectedRevisionId: revisionId,
        expectedUpdatedAt: 100,
        source: "p Other account",
      },
    });
    const rpc = vi.fn();
    await expect(
      submitRitualDraft(model.draft, rpc, model.save, model.current),
    ).rejects.toThrow("does not belong");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds unknown network outcomes and ignores late completion", async () => {
    vi.useFakeTimers();
    const gate = deferred<unknown>();
    const rpc = boundedRitualRpc(() => gate.promise, 10);
    const pending = rpc("ritualWrite", {});
    const rejected = expect(pending).rejects.toThrow("could not be confirmed");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    gate.resolve(success);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("hides other accounts and keeps corrupt recovery records for manual inspection", () => {
    const storage = new Storage();
    persistRitualRecovery(storage, newRitualDraft(other, snapshot));
    storage.setItem("magickli:ritual-recovery:v1:corrupt", "{bad");
    expect(readRitualRecovery(storage, actor)).toEqual([]);
    expect(storage.length).toBe(2);
  });
});

it("requests the new readable projection independently of the old persisted Gongo watermark", () => {
  const db = new Database();
  clearTimeout(db.idb.openTimeout);
  const previous = db.subscribe("docs");
  previous.updatedAt = { docs: 500 };
  const fresh = db.subscribe("docs", ritualListSubscriptionArgs);
  expect(fresh).not.toBe(previous);
  expect(fresh.toObject().updatedAt).toEqual({});
  expect(previous.updatedAt).toEqual({ docs: 500 });
  fresh.updatedAt = { docs: 500 };
  expect(db.subscribe("docs", ritualListSubscriptionArgs)).toBe(fresh);
});
