import type { OpError } from "gongo-server/lib/DatabaseAdapter";
import MongoDatabaseAdapter from "gongo-server-db-mongo";
import type { Db, MongoClient } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { rejectLegacyRitualMutation, writeRitual } from "./writes";

const actor = "000000000000000000000001";
const command = () => ({
  version: 1,
  expectedActorId: actor,
  kind: "save",
  operationId: createUuidV7(),
  docId: "000000000000000000000010",
  expectedRevisionId: null,
  expectedUpdatedAt: null,
  source: "Hierophant: Hello",
});

describe("ritual write request boundary", () => {
  it.each([null, "", "not-an-id", { toString: () => actor }])(
    "rejects unauthenticated identity before database work",
    async (who) => {
      const startSession = vi.fn();
      expect(
        await writeRitual(
          { client: { startSession } as unknown as MongoClient, db: {} as Db },
          who,
          command(),
        ),
      ).toMatchObject({ ok: false, code: "NOT_AUTHENTICATED" });
      expect(startSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    { version: undefined },
    { version: 2 },
    { expectedActorId: undefined },
    { expectedActorId: { toString: (): string => actor } },
    { expectedActorId: "bad" },
    { kind: "delete" },
    { kind: "transfer" },
    { operationId: "not-a-uuid" },
    { operationId: "00000000-0000-4000-8000-000000000000" },
    { expectedRevisionId: undefined },
    { expectedUpdatedAt: undefined },
    { expectedUpdatedAt: "100" },
    { source: "" },
    { source: "x".repeat(1024 * 1024 + 1) },
    { source: { children: [] } },
    { doc: { children: [] } },
    { userId: actor },
    { groupId: actor },
    { scope: { kind: "public" } },
    { docRevisionId: actor },
  ])(
    "rejects stale or forged save fields before starting a transaction",
    async (patch) => {
      const startSession = vi.fn();
      const result = await writeRitual(
        { client: { startSession } as unknown as MongoClient, db: {} as Db },
        actor,
        { ...command(), ...patch },
      );
      expect(result).toMatchObject({ ok: false });
      expect(startSession).not.toHaveBeenCalled();
    },
  );

  it("fails closed on standalone Mongo and ends the session", async () => {
    const endSession = vi.fn();
    const withTransaction = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("provider details"), { code: 20 }),
      );
    const client = {
      startSession: () => ({ withTransaction, endSession }),
    } as unknown as MongoClient;
    const result = await writeRitual(
      { client, db: {} as Db },
      actor,
      command(),
    );
    expect(result).toMatchObject({ ok: false, code: "TRANSACTIONS_REQUIRED" });
    expect(JSON.stringify(result)).not.toContain("provider details");
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("keeps uncertain outcomes retryable without exposing provider errors", async () => {
    const client = {
      startSession: () => ({
        withTransaction: async () => {
          throw new Error("private provider details");
        },
        endSession: async () => {},
      }),
    } as unknown as MongoClient;
    expect(
      await writeRitual({ client, db: {} as Db }, actor, command()),
    ).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: expect.stringContaining("same request ID"),
    });
  });

  it.each(["docs", "docRevisions"])(
    "blocks every generic %s write, including stale pending changes",
    async (name) => {
      const dba = Object.create(
        MongoDatabaseAdapter.prototype,
      ) as MongoDatabaseAdapter;
      dba.collections = {};
      const coll = dba.collection(name);
      coll.allow("insert", rejectLegacyRitualMutation);
      coll.allow("update", rejectLegacyRitualMutation);
      coll.allow("remove", rejectLegacyRitualMutation);
      const errors: OpError[] = [];
      const props = {} as Parameters<MongoDatabaseAdapter["insert"]>[2];
      expect(
        await dba.allowFilter(
          name,
          "insert",
          [{ _id: actor, userId: actor }],
          props,
          errors,
        ),
      ).toEqual([]);
      expect(
        await dba.allowFilter(
          name,
          "update",
          [
            {
              _id: actor,
              patch: [{ op: "replace", path: "/templeId", value: actor }],
            },
          ],
          props,
          errors,
        ),
      ).toEqual([]);
      expect(
        await dba.allowFilter(name, "remove", [actor], props, errors),
      ).toEqual([]);
      expect(errors).toHaveLength(3);
      expect(
        errors.every(
          ([, message]) =>
            typeof message === "string" &&
            message.startsWith("RITUAL_EDITOR_UPGRADE_REQUIRED"),
        ),
      ).toBe(true);
    },
  );
});
