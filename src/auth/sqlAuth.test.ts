import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  createSqlAuth,
  getFreshSqlSession,
  getFreshSqlUserId,
  type SqlAuth,
  type SqlAuthOptions,
  type SqlAuthSession,
} from "./sqlAuth";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function options(): SqlAuthOptions {
  // Context construction must not execute SQL. Real adapter/handler persistence
  // is independently exercised with PGlite in tests/authDatabase.test.ts.
  return {
    db: {
      transaction: vi.fn(() => {
        throw new Error("Unexpected SQL");
      }),
    },
    baseURL: "https://synthetic.example.test",
    secret: "synthetic-auth-test-secret-over-thirty-two-characters",
    googleClientId: "synthetic-client",
    googleClientSecret: "synthetic-secret",
  };
}

function session(): SqlAuthSession {
  const id = createUuidV7();
  const now = new Date();
  return {
    user: {
      id,
      name: "Synthetic",
      email: "synthetic@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: createUuidV7(),
      userId: id,
      token: "synthetic-token",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date("2100-01-01T00:00:00Z"),
    },
  };
}

function reader(value: unknown) {
  const getSession = vi.fn(async () => value);
  return { auth: { api: { getSession } } as unknown as SqlAuth, getSession };
}

describe("explicit SQL auth configuration", () => {
  it("logs only fixed severity events without forwarding messages or provider objects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const context = await createSqlAuth(options()).$context;
    const details = {
      token: "synthetic-provider-token",
      get secret() {
        throw new Error("Do not inspect diagnostic objects");
      },
    };
    context.logger.error("synthetic-secret\nforged diagnostic", details);
    context.logger.warn("synthetic-secret\nforged diagnostic", details);
    context.logger.info("synthetic-secret", details);
    context.logger.debug("synthetic-secret", details);
    expect(error.mock.calls).toEqual([["SQL_AUTH_ERROR"]]);
    expect(warn.mock.calls).toEqual([["SQL_AUTH_WARNING"]]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-url",
    "",
    "https://synthetic.example.test/",
    "https://synthetic.example.test/path",
    "https://synthetic.example.test?query=yes",
    "https://synthetic.example.test#fragment",
    "https://user:password@synthetic.example.test",
    "ftp://synthetic.example.test",
    "http://synthetic.example.test",
    "https://*.example.test",
    "https://synthetic.*",
    " https://synthetic.example.test",
    "https://synthetic.example.test\n",
    "https://SYNTHETIC.example.test",
    "https://synthetic.example.test:443",
    "http://localhost.example.test",
    "http://127.0.0.2",
  ])("refuses non-exact or unsafe origin %j", (baseURL) => {
    expect(() => createSqlAuth({ ...options(), baseURL })).toThrow(
      "Invalid SQL auth origin",
    );
  });

  it.each([
    "https://synthetic.example.test",
    "https://synthetic.example.test:8443",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("accepts explicit supported origin %s", async (baseURL) => {
    const config = options();
    const auth = createSqlAuth({ ...config, baseURL });
    const context = await auth.$context;
    expect(context.options.baseURL).toBe(baseURL);
    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
    expect(config.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { secret: undefined },
    { secret: 123 },
    { secret: "short" },
    { googleClientId: undefined },
    { googleClientId: 123 },
    { googleClientId: " \t" },
    { googleClientSecret: undefined },
    { googleClientSecret: 123 },
    { googleClientSecret: " \t" },
    { db: null },
    { db: {} },
    { db: { transaction: true } },
  ])("refuses incomplete transactional configuration %#", (patch) => {
    expect(() =>
      createSqlAuth({ ...options(), ...patch } as SqlAuthOptions),
    ).toThrow("Invalid SQL auth configuration");
  });

  it("retains the explicit policy and snapshots scalar inputs before context initialization", async () => {
    const config = options();
    const auth = createSqlAuth(config);
    config.baseURL = "https://changed.example.test";
    config.secret = "changed-secret-over-thirty-two-characters";
    config.googleClientId = "changed-client";
    config.googleClientSecret = "changed-secret";
    const context = await auth.$context;
    expect(context.options.baseURL).toBe("https://synthetic.example.test");
    expect(context.options.secret).toBe(
      "synthetic-auth-test-secret-over-thirty-two-characters",
    );
    expect(context.options.socialProviders.google).toMatchObject({
      clientId: "synthetic-client",
      clientSecret: "synthetic-secret",
      overrideUserInfo: false,
    });
    expect(context.options.account).toMatchObject({
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    });
    expect(context.options.session?.cookieCache).toMatchObject({
      enabled: true,
      maxAge: 10,
    });
    expect(context.options.advanced?.cookiePrefix).toBe("magickli-sql");
    expect(context.options.emailAndPassword?.enabled).toBe(false);
    expect(context.options.user?.deleteUser?.enabled).toBe(false);
    expect(isUuidV7(context.generateId({ model: "user" }))).toBe(true);
    expect(isUuidV7(context.generateId({ model: "account" }))).toBe(true);
  });

  it("enables credentials only through the explicit local runtime option", async () => {
    const context = await createSqlAuth({
      ...options(),
      localTestLoginEnabled: true,
    }).$context;
    expect(context.options.emailAndPassword?.enabled).toBe(true);
  });
});

describe("uncached SQL identity boundary", () => {
  it("copies request headers before awaiting and disables cookie caching and renewal", async () => {
    const current = session();
    let resolve!: (value: SqlAuthSession) => void;
    const pending = new Promise<SqlAuthSession>((done) => {
      resolve = done;
    });
    const getSession = vi.fn(() => pending);
    const auth = { api: { getSession } } as unknown as SqlAuth;
    const headers = new Headers({ cookie: "synthetic=original" });
    const result = getFreshSqlSession(auth, headers);
    headers.set("cookie", "synthetic=changed");
    expect(getSession).toHaveBeenCalledOnce();
    const captured = getSession.mock.calls[0] as unknown as [
      { headers: Headers; query: unknown },
    ];
    expect(captured[0].headers).not.toBe(headers);
    expect(captured[0].headers.get("cookie")).toBe("synthetic=original");
    expect(captured[0].query).toEqual({
      disableCookieCache: true,
      disableRefresh: true,
    });
    resolve(current);
    expect(await result).toEqual(current);
  });

  it("rechecks the same auth and Headers objects for every security decision", async () => {
    const current = session();
    const { auth, getSession } = reader(current);
    const headers = new Headers();
    expect(await getFreshSqlUserId(auth, headers)).toBe(current.user.id);
    getSession.mockResolvedValue(null);
    expect(await getFreshSqlUserId(auth, headers)).toBeNull();
    expect(await getFreshSqlSession(auth, headers)).toBeNull();
    expect(getSession).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      "user UUIDv4",
      (value: SqlAuthSession) => {
        value.user.id = "550e8400-e29b-41d4-a716-446655440000";
      },
    ],
    [
      "session UUIDv4",
      (value: SqlAuthSession) => {
        value.session.id = "550e8400-e29b-41d4-a716-446655440000";
      },
    ],
    [
      "uppercase user UUID",
      (value: SqlAuthSession) => {
        value.user.id = "019a0000-abcd-7000-8000-000000000001".toUpperCase();
        value.session.userId = value.user.id;
      },
    ],
    [
      "uppercase session UUID",
      (value: SqlAuthSession) => {
        value.session.id = "019a0000-abcd-7000-8000-000000000002".toUpperCase();
      },
    ],
    [
      "different session owner",
      (value: SqlAuthSession) => {
        value.session.userId = createUuidV7();
      },
    ],
    [
      "invalid Date",
      (value: SqlAuthSession) => {
        value.session.expiresAt = new Date(Number.NaN);
      },
    ],
    [
      "string expiry",
      (value: SqlAuthSession) => {
        value.session.expiresAt = "2100-01-01" as unknown as Date;
      },
    ],
  ] as const)("rejects malformed adapter identity: %s", async (_, mutate) => {
    const current = session();
    mutate(current);
    const { auth } = reader(current);
    await expect(getFreshSqlSession(auth, new Headers())).rejects.toThrow(
      new Error("Invalid SQL authentication identity"),
    );
  });

  it.each([-1, 0, 1])(
    "treats the precise expiry boundary correctly at offset %i",
    async (offset) => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const current = session();
      current.session.expiresAt = new Date(now + offset);
      const { auth } = reader(current);
      expect(await getFreshSqlSession(auth, new Headers())).toEqual(
        offset > 0 ? current : null,
      );
    },
  );

  it("does not convert adapter failures into an anonymous authorization success", async () => {
    const failure = new Error("Synthetic DB unavailable");
    const { auth, getSession } = reader(null);
    getSession.mockRejectedValue(failure);
    await expect(getFreshSqlUserId(auth, new Headers())).rejects.toBe(failure);
  });
});
