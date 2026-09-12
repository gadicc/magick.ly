import type { MethodProps } from "gongo-server/lib/rpc/methods";
import GongoServerless from "gongo-server/lib/serverless";
import MongoDatabaseAdapter from "gongo-server-db-mongo";
import Users from "gongo-server-db-mongo/lib/users";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("./writes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./writes")>()),
  writeRitual: mock.write,
}));

import { registerLegacyRitualWrites } from "./gongoWrites";

const actor = "000000000000000000000001";
const other = "000000000000000000000002";
const token = "synthetic-expired-token";
const verified = { user: { id: actor }, expires: "2099-01-01T00:00:00.000Z" };
const payload = { expectedActorId: actor, source: "Synthetic source" };

function server() {
  const dba = Object.create(
    MongoDatabaseAdapter.prototype,
  ) as MongoDatabaseAdapter;
  dba.collections = {};
  dba.dbPromise = Promise.resolve(
    {} as Awaited<MongoDatabaseAdapter["dbPromise"]>,
  );
  dba.Users = new Users(dba);
  const lookup = vi.spyOn(dba.Users.sessions, "findOne").mockResolvedValue({
    userId: new ObjectId(other),
    sessionToken: token,
    expires: new Date(0),
  } as never);
  const gs = new GongoServerless({ dba });
  registerLegacyRitualWrites(gs);
  const post = async (
    auth: unknown,
    options: {
      bodyAuth?: object;
      cookie?: string;
      bodyRequest?: object;
      throwVerified?: boolean;
    } = {},
  ) => {
    const request = new Request("http://127.0.0.1:39841/api/gongoPoll", {
      method: "POST",
      headers: options.cookie ? { cookie: options.cookie } : {},
      body: gs.ARSON.encode({
        $gongo: 2,
        auth: options.bodyAuth,
        request: options.bodyRequest,
        calls: [["ritualWrite", payload]],
      }),
    });
    if (options.throwVerified)
      Object.assign(request, {
        auth: {
          get user() {
            throw new Error("SYNTHETIC_PRIVATE_AUTH_FAILURE");
          },
        },
      });
    else if (auth !== undefined) Object.assign(request, { auth });
    const response = await gs.vercelEdgePost()(request);
    return gs.ARSON.decode(await response.text()) as {
      calls: Array<{ $result?: unknown; $error?: unknown }>;
    };
  };
  return { dba, gs, lookup, post };
}

beforeEach(() => {
  mock.write.mockReset();
  mock.write.mockResolvedValue({
    ok: true,
    docId: "000000000000000000000010",
    revisionId: null,
    updatedAt: 100,
    replayed: false,
  });
});

describe("verified Auth.js ritual HTTP boundary", () => {
  it.each([
    { bodyAuth: { sid: token } },
    { bodyAuth: { nextAuthSessionToken: token } },
    { bodyAuth: { userId: actor, user: { id: actor } } },
    { cookie: `next-auth.session-token=${token}` },
    { bodyAuth: { sid: token }, bodyRequest: { auth: verified } },
  ])(
    "rejects unverified body/cookie credentials, without querying even an expired legacy session row",
    async (options) => {
      const { post, lookup } = server();
      const result = await post(null, options);
      expect(result.calls[0]).toEqual(
        expect.objectContaining({
          $result: {
            ok: false,
            code: "NOT_AUTHENTICATED",
            message: "Sign in before saving this ritual.",
          },
        }),
      );
      expect(result.calls[0]).not.toHaveProperty("$error");
      expect(mock.write).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    {},
    { userId: actor },
    { user: {} },
    { user: { id: "bad" } },
    { user: { id: { toString: (): string => actor } } },
  ])(
    "rejects an absent or malformed verified request session",
    async (auth) => {
      const { post, lookup } = server();
      expect(
        (await post(auth, { bodyAuth: { sid: token } })).calls[0],
      ).toMatchObject({ $result: { ok: false, code: "NOT_AUTHENTICATED" } });
      expect(mock.write).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("accepts the verified request session and ignores conflicting body/cookie credentials", async () => {
    const { post, lookup } = server();
    expect(
      (
        await post(verified, {
          bodyAuth: { sid: token, userId: other },
          cookie: `next-auth.session-token=${token}`,
        })
      ).calls[0],
    ).toMatchObject({ $result: { ok: true } });
    expect(mock.write).toHaveBeenCalledWith(expect.anything(), actor, payload);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not initialize the database for an unverified request", async () => {
    const { dba, post } = server();
    const database = vi.fn(() => {
      throw new Error("SYNTHETIC_PRIVATE_DATABASE_FAILURE");
    });
    Object.defineProperty(dba, "dbPromise", { get: database });
    expect((await post(null)).calls[0]).toMatchObject({
      $result: { ok: false, code: "NOT_AUTHENTICATED" },
    });
    expect(database).not.toHaveBeenCalled();
  });

  it.each(["verified-session", "database", "command"])(
    "returns a safe retryable response instead of serializing %s failures",
    async (failure) => {
      const { dba, post } = server();
      if (failure === "database")
        Object.defineProperty(dba, "dbPromise", {
          get: () =>
            Promise.reject(new Error("SYNTHETIC_PRIVATE_DATABASE_FAILURE")),
        });
      if (failure === "command")
        mock.write.mockRejectedValue(
          new Error("SYNTHETIC_PRIVATE_COMMAND_FAILURE"),
        );
      const result = await post(verified, {
        throwVerified: failure === "verified-session",
      });
      expect(result.calls[0]).toMatchObject({
        $result: {
          ok: false,
          code: "UNAVAILABLE",
          message: expect.stringContaining("same request ID"),
        },
      });
      expect(result.calls[0]).not.toHaveProperty("$error");
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
      expect(JSON.stringify(result)).not.toContain("stack");
    },
  );
});

it("rejects all generic ritual write methods even for verified accounts", async () => {
  const { dba, gs } = server();
  const props = {
    dba,
    gs,
    request: Object.assign(new Request("http://127.0.0.1:39841"), {
      auth: verified,
    }),
  } as unknown as MethodProps<MongoDatabaseAdapter>;
  for (const coll of ["docs", "docRevisions"]) {
    for (const [method, operation] of [
      ["insert", { docs: [{ _id: "legacy", text: "Pending source" }] }],
      [
        "update",
        {
          updates: [
            {
              _id: "legacy",
              patch: [
                { op: "replace", path: "/userId", value: "client-spoof" },
              ],
            },
          ],
        },
      ],
      ["remove", { ids: ["legacy"] }],
    ] as const) {
      expect(
        await gs.methods.exec2(method, { coll, ...operation }, props),
      ).toEqual({
        $errors: [
          ["legacy", expect.stringContaining("RITUAL_EDITOR_UPGRADE_REQUIRED")],
        ],
      });
    }
  }
});
