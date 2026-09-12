import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import MongoDatabaseAdapter from "gongo-server-db-mongo";
import { type Db, MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { prepare } from "./prepare";
import { publishRitualDocs, publishRitualRevisions } from "./publications";
import { writeRitual } from "./writes";

const oid = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
const actor = oid(1).toHexString();
const request = (extra: Record<string, unknown> = {}) => ({
  version: 1,
  expectedActorId: actor,
  operationId: createUuidV7(),
  kind: "save",
  docId: oid(10).toHexString(),
  expectedRevisionId: oid(20).toHexString(),
  expectedUpdatedAt: 100,
  source: "Hierophant: שלום\n* All-officers Rise",
  ...extra,
});

// Explicit opt-in always starts a NEW private process; no URI/env/provider fallback.
describe.skipIf(process.env.MAGICKLI_RUN_MONGO_REHEARSAL !== "1")(
  "real disposable Mongo ritual transactions",
  () => {
    let child: ChildProcess | undefined;
    let directory: string;
    let client: MongoClient;
    let db: Db;
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "magickli-ritual-cas-"));
      const listener = createServer();
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const address = listener.address();
      if (!address || typeof address === "string" || address.port < 1024)
        throw new Error("Could not reserve a disposable port");
      const port = address.port;
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      child = spawn(
        "/usr/bin/mongod",
        [
          "--dbpath",
          directory,
          "--bind_ip",
          "127.0.0.1",
          "--port",
          String(port),
          "--replSet",
          "magickli_test",
          "--oplogSize",
          "64",
          "--logpath",
          join(directory, "mongod.log"),
          "--quiet",
        ],
        { stdio: "ignore" },
      );
      client = new MongoClient(
        `mongodb://127.0.0.1:${port}/?directConnection=true`,
        { serverSelectionTimeoutMS: 500 },
      );
      const deadline = Date.now() + 20000;
      while (true) {
        if (child.exitCode !== null)
          throw new Error(
            `Disposable mongod exited (${child.exitCode}); log retained under ${directory}`,
          );
        try {
          await client.connect();
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await setTimeout(50);
        }
      }
      await client.db("admin").command({
        replSetInitiate: {
          _id: "magickli_test",
          members: [{ _id: 0, host: `127.0.0.1:${port}` }],
        },
      });
      while (
        !(await client.db("admin").command({ hello: 1 })).isWritablePrimary
      ) {
        if (Date.now() > deadline)
          throw new Error("Disposable replica set did not elect a primary");
        await setTimeout(50);
      }
      db = client.db("magickli_ritual_test");
    });
    afterAll(async () => {
      try {
        await client?.close();
      } finally {
        if (child && child.exitCode === null) {
          const exited = new Promise<void>((resolve) =>
            child?.once("exit", () => resolve()),
          );
          const timeout = globalThis.setTimeout(
            () => child?.kill("SIGKILL"),
            5000,
          );
          timeout.unref();
          child.kill("SIGTERM");
          await exited;
          clearTimeout(timeout);
        }
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    });
    beforeEach(async () => {
      await db.dropDatabase();
      for (const name of [
        "users",
        "templeMemberships",
        "temples",
        "userGroups",
        "docs",
        "docRevisions",
        "ritualWriteReceipts",
      ])
        await db.createCollection(name);
      await db.collection("users").insertOne({ _id: oid(1) });
      await db.collection("temples").insertOne({ _id: oid(40) });
      await db.collection("userGroups").insertOne({ _id: oid(30) });
      await db.collection("templeMemberships").insertOne({
        _id: oid(50),
        userId: oid(1),
        templeId: oid(40),
        admin: true,
        grade: 0,
      });
      await db.collection("docs").insertOne({
        _id: oid(10),
        userId: oid(2),
        templeId: oid(40),
        minGrade: 2,
        title: "Synthetic ritual",
        doc: { children: [] },
        docRevisionId: oid(20),
        __updatedAt: 100,
        updatedAt: new Date(100),
      });
      await db.collection("docRevisions").insertOne({
        _id: oid(20),
        docId: oid(10),
        userId: oid(2),
        text: "Prior source",
        __updatedAt: 100,
        createdAt: new Date(100),
        updatedAt: new Date(100),
      });
    });

    it("rejects A's queued command when B sends it, even when B can edit", async () => {
      await db.collection("users").insertOne({ _id: oid(2), admin: true });
      const queued = request();
      expect(
        await writeRitual({ client, db }, oid(2).toHexString(), queued),
      ).toMatchObject({ ok: false, code: "ACCOUNT_CHANGED" });
      expect(await db.collection("docRevisions").countDocuments()).toBe(1);
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        0,
      );
      expect((await writeRitual({ client, db }, actor, queued)).ok).toBe(true);
    });

    it("atomically appends trusted source/history and server-derived rendering without changing policy", async () => {
      const command = request({ title: "Edited title" });
      const result = await writeRitual({ client, db }, actor, command);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      const doc = await db.collection("docs").findOne({ _id: oid(10) });
      const revision = await db
        .collection("docRevisions")
        .findOne({ _id: new ObjectId(result.revisionId as string) });
      expect(doc).toMatchObject({
        userId: oid(2),
        templeId: oid(40),
        minGrade: 2,
        title: "Edited title",
        doc: prepare(command.source),
        __updatedAt: result.updatedAt,
      });
      expect(revision).toMatchObject({
        docId: oid(10),
        userId: oid(1),
        text: command.source,
        __updatedAt: result.updatedAt,
      });
      expect(revision?.createdAt).toEqual(revision?.updatedAt);
      expect(
        await db.collection("docRevisions").findOne({ _id: oid(20) }),
      ).toMatchObject({ text: "Prior source", __updatedAt: 100 });
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        1,
      );
    });

    it("allows creator/global/group admins but rejects ordinary or revoked readers", async () => {
      await db.collection("templeMemberships").deleteMany({});
      expect(await writeRitual({ client, db }, actor, request())).toMatchObject(
        { ok: false, code: "FORBIDDEN" },
      );
      await db
        .collection("docs")
        .updateOne({ _id: oid(10) }, { $set: { userId: oid(1) } });
      expect((await writeRitual({ client, db }, actor, request())).ok).toBe(
        true,
      );
      const current = await db.collection("docs").findOne({ _id: oid(10) });
      await db.collection("docs").updateOne(
        { _id: oid(10) },
        {
          $set: { userId: oid(2), groupId: oid(30) },
          $unset: { templeId: "", minGrade: "" },
        },
      );
      await db
        .collection("users")
        .updateOne({ _id: oid(1) }, { $set: { groupAdminIds: [oid(30)] } });
      expect(
        (
          await writeRitual(
            { client, db },
            actor,
            request({
              expectedRevisionId: current?.docRevisionId.toHexString(),
              expectedUpdatedAt: current?.__updatedAt,
            }),
          )
        ).ok,
      ).toBe(true);
    });

    it("rejects a stale source or metadata token without appending history", async () => {
      for (const extra of [
        { expectedRevisionId: null },
        { expectedUpdatedAt: 99 },
      ])
        expect(
          await writeRitual({ client, db }, actor, request(extra)),
        ).toMatchObject({ ok: false, code: "CONFLICT" });
      expect(await db.collection("docRevisions").countDocuments()).toBe(1);
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        0,
      );
    });

    it("handles actual string Mongo references and an absent initial revision token", async () => {
      const old = await db.collection("docs").findOne({ _id: oid(10) });
      await db.collection("docs").deleteMany({});
      await db
        .collection<{ _id: string }>("docs")
        .insertOne({ ...old, _id: oid(10).toHexString().toUpperCase() });
      expect((await writeRitual({ client, db }, actor, request())).ok).toBe(
        true,
      );
      await db
        .collection("docs")
        .updateMany({}, { $unset: { docRevisionId: "", __updatedAt: "" } });
      expect(
        (
          await writeRitual(
            { client, db },
            actor,
            request({ expectedRevisionId: null, expectedUpdatedAt: null }),
          )
        ).ok,
      ).toBe(true);
    });

    it("allows exactly one concurrent save against the same base", async () => {
      const results = await Promise.all([
        writeRitual({ client, db }, actor, request({ source: "p First" })),
        writeRitual({ client, db }, actor, request({ source: "p Second" })),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toMatchObject([
        { code: "CONFLICT" },
      ]);
      expect(await db.collection("docRevisions").countDocuments()).toBe(2);
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        1,
      );
    });

    it("publishes a late committed save and its source after another ritual advances the watermark", async () => {
      const original = await db.collection("docs").findOne({ _id: oid(10) });
      await db.collection("docs").insertOne({
        ...original,
        _id: oid(11),
        docRevisionId: oid(21),
      });
      await db.collection("docRevisions").insertOne({
        _id: oid(21),
        docId: oid(11),
        userId: oid(2),
        text: "Other prior source",
        __updatedAt: 100,
        createdAt: new Date(100),
        updatedAt: new Date(100),
      });

      let reachedReceipt!: () => void;
      let releaseCommit!: () => void;
      const receiptInserted = new Promise<void>((resolve) => {
        reachedReceipt = resolve;
      });
      const commitReleased = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      // Only delay acknowledgement of this real insert. The actual native
      // transaction remains uncommitted while another ritual saves and polls.
      const delayedDb = new Proxy(db, {
        get(target, property) {
          if (property !== "collection")
            return Reflect.get(target, property, target);
          return (name: string) => {
            const collection = target.collection(name);
            if (name !== "ritualWriteReceipts") return collection;
            return new Proxy(collection, {
              get(target, property) {
                if (property === "insertOne")
                  return async (
                    ...args: Parameters<typeof target.insertOne>
                  ) => {
                    const result = await target.insertOne(...args);
                    reachedReceipt();
                    await commitReleased;
                    return result;
                  };
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          };
        },
      });
      const dba = Object.create(
        MongoDatabaseAdapter.prototype,
      ) as MongoDatabaseAdapter;
      dba.collections = {};
      dba.dbPromise = Promise.resolve(db) as typeof dba.dbPromise;
      const props = {
        auth: { userId: async () => actor },
        updatedAt: { docs: 100, docRevisions: 100 },
      } as unknown as Parameters<typeof publishRitualDocs>[2];
      const source =
        "Hierophant: Late acknowledged source\n* All-officers Rise";
      const slow = writeRitual(
        { client, db: delayedDb },
        actor,
        request({ source }),
      );
      let fast: Awaited<ReturnType<typeof writeRitual>> | undefined;
      let late: Awaited<ReturnType<typeof writeRitual>> | undefined;
      try {
        await Promise.race([
          receiptInserted,
          slow.then(() => {
            throw new Error(
              "Expected the first transaction to pause at its receipt",
            );
          }),
        ]);
        await setTimeout(5);
        fast = await writeRitual(
          { client, db },
          actor,
          request({
            docId: oid(11).toHexString(),
            expectedRevisionId: oid(21).toHexString(),
            source: "p Other ritual committed first",
          }),
        );
        expect(fast.ok).toBe(true);
        if (!fast.ok) throw new Error(fast.code);
        const fastUpdatedAt = fast.updatedAt;
        const beforeCommit = (await publishRitualDocs(dba, {}, props)).flatMap(
          (result) => result.entries,
        );
        expect(beforeCommit).toContainEqual(
          expect.objectContaining({
            _id: oid(11),
            __updatedAt: fast.updatedAt,
          }),
        );
        expect(
          beforeCommit.some(
            (row) =>
              typeof row.__updatedAt === "number" &&
              row.__updatedAt > fastUpdatedAt,
          ),
        ).toBe(false);
      } finally {
        releaseCommit();
        late = await slow;
      }

      if (!late?.ok) throw new Error(late?.code ?? "Expected the late save");
      if (!fast?.ok) throw new Error("Expected the other ritual to save");
      expect(late.updatedAt).toBeLessThan(fast.updatedAt);
      const advanced = {
        ...props,
        updatedAt: { docs: fast.updatedAt, docRevisions: fast.updatedAt },
      };
      const docs = (await publishRitualDocs(dba, {}, advanced)).flatMap(
        (result) => result.entries,
      );
      expect(docs).toContainEqual(
        expect.objectContaining({
          _id: oid(10),
          docRevisionId: new ObjectId(late.revisionId as string),
          __updatedAt: late.updatedAt,
          doc: prepare(source),
        }),
      );
      const revisions = (
        await publishRitualRevisions(
          dba,
          { docId: oid(10).toHexString() },
          advanced,
        )
      ).flatMap((result) => result.entries);
      expect(revisions).toContainEqual(
        expect.objectContaining({
          _id: new ObjectId(late.revisionId as string),
          docId: oid(10),
          text: source,
          __updatedAt: late.updatedAt,
        }),
      );
      for (const revision of revisions) expect(revision.docId).toEqual(oid(10));
    });

    it("replays identical concurrent retries once, even after the parent advances", async () => {
      const command = request();
      const results = await Promise.all([
        writeRitual({ client, db }, actor, command),
        writeRitual({ client, db }, actor, command),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        new Set(results.map((result) => result.ok && result.revisionId)).size,
      ).toBe(1);
      const first = results[0];
      if (!first.ok) throw new Error(first.code);
      expect(
        (
          await writeRitual(
            { client, db },
            actor,
            request({
              expectedRevisionId: first.revisionId,
              expectedUpdatedAt: first.updatedAt,
              source: "p Later",
            }),
          )
        ).ok,
      ).toBe(true);
      expect(await writeRitual({ client, db }, actor, command)).toEqual({
        ...first,
        replayed: true,
      });
      expect(await db.collection("docRevisions").countDocuments()).toBe(3);
    });

    it("rejects reused operation IDs with changed source or author and revoked replay rights", async () => {
      const command = request();
      expect((await writeRitual({ client, db }, actor, command)).ok).toBe(true);
      expect(
        await writeRitual({ client, db }, actor, {
          ...command,
          source: "p Changed",
        }),
      ).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" });
      await db.collection("users").insertOne({ _id: oid(3), admin: true });
      expect(
        await writeRitual({ client, db }, oid(3), {
          ...command,
          expectedActorId: oid(3).toHexString(),
        }),
      ).toMatchObject({
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
      await db.collection("templeMemberships").deleteMany({});
      expect(await writeRitual({ client, db }, actor, command)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
    });

    it("rolls back an appended revision and document update when receipt insertion fails", async () => {
      await db.command({
        collMod: "ritualWriteReceipts",
        validator: { impossibleRequiredField: { $exists: true } },
      });
      expect(await writeRitual({ client, db }, actor, request())).toMatchObject(
        { ok: false, code: "UNAVAILABLE" },
      );
      expect(
        await db.collection("docs").findOne({ _id: oid(10) }),
      ).toMatchObject({ docRevisionId: oid(20), __updatedAt: 100 });
      expect(await db.collection("docRevisions").countDocuments()).toBe(1);
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        0,
      );
    });

    it("rejects malformed source and foreign/missing current revisions with no writes", async () => {
      expect(
        await writeRitual(
          { client, db },
          actor,
          request({ source: 'p(role="missing)' }),
        ),
      ).toMatchObject({ ok: false, code: "INVALID_SOURCE" });
      await db
        .collection("docRevisions")
        .updateOne({ _id: oid(20) }, { $set: { docId: oid(11) } });
      expect(await writeRitual({ client, db }, actor, request())).toMatchObject(
        { ok: false, code: "INVALID_STATE" },
      );
      await db.collection("docRevisions").deleteMany({});
      expect(await writeRitual({ client, db }, actor, request())).toMatchObject(
        { ok: false, code: "INVALID_STATE" },
      );
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        0,
      );
    });

    it("creates only within an authorized existing scope, with trusted creator and an initial revision", async () => {
      const command = {
        version: 1,
        expectedActorId: actor,
        operationId: createUuidV7(),
        kind: "create",
        scope: { kind: "temple", templeId: oid(40).toHexString(), minGrade: 0 },
        title: "New ritual",
        source: "",
      };
      const result = await writeRitual({ client, db }, actor, command);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      expect(
        await db
          .collection("docs")
          .findOne({ _id: new ObjectId(result.docId) }),
      ).toMatchObject({
        userId: oid(1),
        templeId: oid(40),
        minGrade: 0,
        doc: prepare(""),
      });
      expect(
        await db
          .collection("docRevisions")
          .findOne({ _id: new ObjectId(result.revisionId as string) }),
      ).toMatchObject({
        docId: new ObjectId(result.docId),
        userId: oid(1),
        text: "",
      });
      expect(
        await writeRitual({ client, db }, actor, {
          ...command,
          operationId: createUuidV7(),
          scope: { kind: "public" },
        }),
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(
        await writeRitual({ client, db }, actor, {
          ...command,
          operationId: createUuidV7(),
          scope: {
            kind: "temple",
            templeId: oid(41).toHexString(),
            minGrade: 0,
          },
        }),
      ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    });

    it("deduplicates concurrent creation retries without orphan documents/revisions", async () => {
      const command = {
        version: 1,
        expectedActorId: actor,
        operationId: createUuidV7(),
        kind: "create",
        scope: { kind: "temple", templeId: oid(40).toHexString(), minGrade: 0 },
        title: "New ritual",
        source: "p New",
      };
      const results = await Promise.all([
        writeRitual({ client, db }, actor, command),
        writeRitual({ client, db }, actor, command),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(await db.collection("docs").countDocuments()).toBe(2);
      expect(await db.collection("docRevisions").countDocuments()).toBe(2);
      expect(await db.collection("ritualWriteReceipts").countDocuments()).toBe(
        1,
      );
    });

    it("allows only global public publication and invalidates stale content saves", async () => {
      const command = {
        version: 1,
        expectedActorId: actor,
        operationId: createUuidV7(),
        kind: "publish",
        docId: oid(10).toHexString(),
        expectedRevisionId: oid(20).toHexString(),
        expectedUpdatedAt: 100,
      };
      expect(await writeRitual({ client, db }, actor, command)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      await db
        .collection("users")
        .updateOne({ _id: oid(1) }, { $set: { admin: true } });
      expect((await writeRitual({ client, db }, actor, command)).ok).toBe(true);
      const parent = await db.collection("docs").findOne({ _id: oid(10) });
      expect(parent).not.toHaveProperty("templeId");
      expect(parent).not.toHaveProperty("minGrade");
      expect(parent).toMatchObject({ userId: oid(2), docRevisionId: oid(20) });
      expect(await db.collection("docRevisions").countDocuments()).toBe(1);
      expect(await writeRitual({ client, db }, actor, request())).toMatchObject(
        { ok: false, code: "CONFLICT" },
      );
    });
  },
);
