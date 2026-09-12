import GongoServer from "gongo-server/lib/serverless";
import MongoDatabaseAdapter, { ObjectId } from "gongo-server-db-mongo";
import Users from "gongo-server-db-mongo/lib/users";
import { describe, expect, it, vi } from "vitest";
import { withVerifiedGongoAuth } from "./gongoHttpAuth";

const actor = "10000000000000000000000a";
const other = "20000000000000000000000b";
const token = "synthetic-expired-token";
type Row = Record<string, unknown>;
type RequestWithAuth = Request & { auth?: unknown };

function setup() {
  // Keep installed Auth, Users, ObjectId conversion and HTTP/ARSON code real.
  const db = Object.create(
    MongoDatabaseAdapter.prototype,
  ) as MongoDatabaseAdapter;
  db.collections = {};
  db.dbPromise = Promise.resolve(
    {} as Awaited<MongoDatabaseAdapter["dbPromise"]>,
  );
  db.Users = new Users(db);
  const legacyLookup = vi
    .spyOn(db.Users.sessions, "findOne")
    .mockResolvedValue({
      _id: token,
      sessionToken: token,
      userId: new ObjectId(other),
      expires: new Date(0),
    });
  const sessionLookup = vi.spyOn(db.Users, "getSessionData");
  const gs = new GongoServer({ dba: db });
  // Installed transport logs malformed bodies; fixtures suppress that existing logging.
  gs._supressConsoleErrors = true;
  gs.method("identityProbe", async (_db, _query, props) => {
    const userId = await props.auth.userId();
    const session = await props.auth.getSessionData();
    const verified = (props.request as RequestWithAuth).auth as Row | null;
    const nestedUser = verified?.user as Row | undefined;
    return {
      userId: userId?.toString() ?? null,
      nestedUserId: nestedUser?.id ?? null,
      sessionUserId: session?.userId?.toString() ?? null,
      name: nestedUser?.name ?? null,
    };
  });
  gs.method("privateProbe", async (_db, _query, { auth }) => {
    const userId = await auth.userId();
    if (!userId) throw new Error("Not authenticated");
    return { userId: userId.toString(), message: "Synthetic private result" };
  });
  gs.publish("syntheticPublic", () => [
    {
      coll: "syntheticPublic",
      entries: [{ _id: "public", message: "Synthetic public result" }],
    },
  ]);

  async function request(
    options: {
      verified?: unknown;
      auth?: Row;
      cookie?: string;
      rawBody?: string;
      bridged?: boolean;
      calls?: unknown[];
    } = {},
  ) {
    const body =
      options.rawBody ??
      gs.ARSON.encode({
        $gongo: 2,
        auth: options.auth,
        calls: options.calls ?? [
          ["identityProbe", {}],
          ["privateProbe", {}],
        ],
      });
    const req: RequestWithAuth = new Request(
      "https://synthetic.example.test/api/gongoPoll",
      {
        method: "POST",
        body,
        headers: {
          "content-type": "text/plain",
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
    );
    // Mock only Auth.js verification's output. The app must compose this callback
    // INSIDE auth(...), after Auth.js has validated the current cookie session.
    const verifySession = vi.fn(async (request: RequestWithAuth) => {
      request.auth = options.verified ?? null;
    });
    await verifySession(req);
    const post =
      options.bridged === false
        ? gs.vercelEdgePost()
        : withVerifiedGongoAuth(gs.vercelEdgePost());
    const response = await post(req);
    const responseBody = await response.text();
    return {
      response,
      responseBody,
      req,
      verifySession,
      decoded: response.status === 200 ? gs.ARSON.decode(responseBody) : null,
    };
  }
  return { db, gs, legacyLookup, sessionLookup, request };
}

describe("verified Gongo HTTP auth bridge", () => {
  it("reproduces installed expired-token fallback without the bridge", async () => {
    const { request, legacyLookup, sessionLookup } = setup();
    const result = await request({
      bridged: false,
      verified: null,
      auth: { sid: token },
    });
    expect(result.decoded.calls[0].$result.userId).toBe(other);
    expect(result.decoded.calls[1].$result.userId).toBe(other);
    expect(legacyLookup).toHaveBeenCalledWith({
      $or: [{ _id: token }, { sessionToken: token }],
    });
    expect(sessionLookup).toHaveBeenCalled();
  });

  it("reproduces the installed mismatch for a valid nested Auth.js session without the bridge", async () => {
    const { request, legacyLookup } = setup();
    const result = await request({
      bridged: false,
      verified: { user: { id: actor } },
    });
    expect(result.decoded.calls[0].$result).toMatchObject({
      userId: null,
      nestedUserId: actor,
    });
    expect(result.decoded.calls[1].$error.message).toBe("Not authenticated");
    expect(legacyLookup).not.toHaveBeenCalled();
  });

  it.each([
    { auth: { sid: token } },
    { auth: { nextAuthSessionToken: token } },
    { cookie: `next-auth.session-token=${token}` },
    { cookie: `__Secure-next-auth.session-token=${token}` },
  ])(
    "rejects fallback identity after Auth.js reports no session (%j)",
    async (untrusted) => {
      const { request, legacyLookup, sessionLookup } = setup();
      const result = await request({ verified: null, ...untrusted });
      expect(result.response.status).toBe(200);
      expect(result.decoded.calls[0].$result).toMatchObject({
        userId: null,
        nestedUserId: null,
        sessionUserId: null,
      });
      expect(result.decoded.calls[1].$error.message).toBe("Not authenticated");
      expect(sessionLookup).not.toHaveBeenCalled();
      expect(legacyLookup).not.toHaveBeenCalled();
    },
  );

  it("honors the verified current cookie session and nested identity despite every forged body identity", async () => {
    const { request, legacyLookup, sessionLookup } = setup();
    const verified = {
      user: { id: actor.toUpperCase(), name: "Synthetic user" },
      expires: "2030-01-01T00:00:00Z",
      userId: other,
    };
    const before = structuredClone(verified);
    const cookie = `__Secure-authjs.session-token=synthetic-current-cookie; next-auth.session-token=${token}`;
    const result = await request({
      verified,
      cookie,
      auth: {
        sid: token,
        nextAuthSessionToken: token,
        userId: other,
        user: { id: other },
      },
    });
    expect(result.decoded.calls[0].$result).toEqual({
      userId: actor,
      nestedUserId: actor,
      sessionUserId: actor,
      name: "Synthetic user",
    });
    expect(result.decoded.calls[1].$result.userId).toBe(actor);
    expect(result.verifySession).toHaveBeenCalledWith(result.req);
    expect(result.req.headers.get("cookie")).toBe(cookie);
    expect((result.req.auth as Row).expires).toBe(verified.expires);
    expect(verified).toEqual(before);
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(legacyLookup).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { userId: actor },
    { user: null },
    { user: { id: "" } },
    { user: { id: ` ${actor}` } },
    { user: { id: "x".repeat(24) } },
    { user: { id: 123 } },
    { user: { id: new ObjectId(actor) } },
    { user: { id: "0198bcde-aaaa-7bbb-8ccc-ddddeeeeefff" } },
    [{ user: { id: actor } }],
  ])(
    "fails closed for a malformed verified legacy identity (%j)",
    async (verified) => {
      const { request, legacyLookup, sessionLookup } = setup();
      const result = await request({
        verified,
        auth: { sid: token },
        cookie: `next-auth.session-token=${token}`,
      });
      expect(result.response.status).toBe(200);
      expect(result.decoded.calls[0].$result.userId).toBeNull();
      expect(result.decoded.calls[0].$result.nestedUserId).toBeNull();
      expect(result.decoded.calls[1].$error.message).toBe("Not authenticated");
      expect(sessionLookup).not.toHaveBeenCalled();
      expect(legacyLookup).not.toHaveBeenCalled();
    },
  );

  it("preserves anonymous public RPC/subscribe results and ARSON transport", async () => {
    const { request, legacyLookup } = setup();
    const result = await request({
      verified: null,
      auth: { sid: token },
      calls: [
        [
          "echo",
          { message: "Synthetic echo", date: new Date("2020-01-01T00:00:00Z") },
        ],
        ["subscribe", { name: "syntheticPublic", args: {}, updatedAt: {} }],
      ],
    });
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(result.decoded.calls[0].$result).toEqual({
      message: "Synthetic echo",
      date: new Date("2020-01-01T00:00:00Z"),
    });
    expect(result.decoded.calls[1].$result.results[0].entries[0].message).toBe(
      "Synthetic public result",
    );
    expect(legacyLookup).not.toHaveBeenCalled();
  });

  it("leaves invalid ARSON text to the installed transport's existing 400 response", async () => {
    const { request, legacyLookup, sessionLookup } = setup();
    const result = await request({
      rawBody: "not valid ARSON",
      cookie: `next-auth.session-token=${token}`,
    });
    expect(result.response.status).toBe(400);
    expect(result.responseBody).toBe("Bad Request");
    expect(sessionLookup).not.toHaveBeenCalled();
    expect(legacyLookup).not.toHaveBeenCalled();
  });
});
