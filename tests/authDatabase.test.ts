import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { createRequestAuthSessionReaders } from "@gadicc/loom/next/auth/server";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createSqlAuth,
  getFreshSqlSession,
  getFreshSqlUserId,
} from "../src/auth/sqlAuth";
import { ensureLegacyId } from "../src/db/legacyIds";
import * as schema from "../src/db/schema";
import { loadSqlRitualPrincipal } from "../src/doc/sqlPolicy";
import { createSqlRitualReader } from "../src/doc/sqlReads";
import { createUuidV7, isUuidV7 } from "../src/lib/ids";
import {
  legacyProviderAlias,
  planBetterAuthImport,
  planLegacyUserAccess,
} from "../src/migration/planBetterAuthImport";
import { fixture, importedAt, sourceKey } from "./authFixtures";

const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
vi.mock("server-only", () => ({}));
afterAll(() => harness.client.close());
beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected live authentication request");
    }),
  );
  await db.update(schema.rituals).set({ currentRevisionId: null });
  await db.delete(schema.ritualRevisions);
  await db.delete(schema.rituals);
  await db.delete(schema.userGroups);
  await db.delete(schema.user);
  await db.delete(schema.verification);
  await db.delete(schema.legacyIdAliases);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function importSynthetic() {
  const test = fixture();
  return db.transaction(async (tx) => {
    for (const user of test.normalized.users)
      test.ids.set(
        sourceKey(user.source),
        await ensureLegacyId(tx, user.source),
      );
    for (const account of test.normalized.accounts) {
      const source = legacyProviderAlias(account);
      test.ids.set(sourceKey(source), await ensureLegacyId(tx, source));
    }
    const plan = planBetterAuthImport(test.normalized, {
      importedAt,
      lookup: test.lookup,
    });
    for (const alias of plan.aliases)
      await ensureLegacyId(tx, alias.source, alias.canonicalId);
    await tx.insert(schema.user).values(plan.users).onConflictDoNothing();
    await tx.insert(schema.account).values(plan.accounts).onConflictDoNothing();
    await tx
      .insert(schema.userProfile)
      .values(plan.profiles)
      .onConflictDoNothing();
    await tx
      .insert(schema.legacyUserEmails)
      .values(plan.emails)
      .onConflictDoNothing();
    await tx
      .insert(schema.legacyAuthUsers)
      .values(plan.legacyUsers)
      .onConflictDoNothing();
    await tx
      .insert(schema.legacyAuthAccounts)
      .values(plan.legacyAccounts)
      .onConflictDoNothing();
    await tx
      .insert(schema.userAccess)
      .values(
        planLegacyUserAccess(
          test.normalized.users.map((user, i) => ({
            source: user.source,
            admin: i === 0,
          })),
          plan,
          test.lookup,
        ),
      )
      .onConflictDoNothing();
    return plan;
  });
}

async function createTestAuth(
  profile = { id: "subject-editor", email: "changed@example.test" },
) {
  const auth = createSqlAuth({
    db,
    baseURL: "https://synthetic.example.test",
    secret: "synthetic-auth-schema-test-secret-over-thirty-two-characters",
    googleClientId: "synthetic-client",
    googleClientSecret: "synthetic-secret",
  });
  const context = await auth.$context;
  const google = context.socialProviders.find(
    (provider) => provider.id === "google",
  );
  if (!google) throw new Error("Expected configured Google provider");
  // Only the resolved provider boundary is replaced; production factory options,
  // subject resolution, adapter, sessions and actual HTTP handlers are retained.
  google.options = { ...google.options, verifyIdToken: async () => true };
  google.getUserInfo = async () => ({
    user: {
      email: profile.email,
      name: "Synthetic provider",
      emailVerified: true,
    },
    data: {
      sub: profile.id,
      email: profile.email,
      email_verified: true,
      name: "Synthetic provider",
      given_name: "Synthetic",
      family_name: "Provider",
      picture: "",
      aud: "synthetic-client",
      azp: "synthetic-client",
      iss: "https://accounts.google.com",
      iat: 1_789_211_800,
      exp: 1_789_215_400,
    },
  });
  return auth;
}

const origin = "https://synthetic.example.test";
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}
function handlerRequest(
  auth: Awaited<ReturnType<typeof createTestAuth>>,
  path: string,
  options: { cookie?: string; body?: unknown; origin?: string } = {},
) {
  return auth.handler(
    new Request(`${origin}/api/auth/${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        ...(options.cookie ? { cookie: options.cookie } : {}),
        origin: options.origin ?? origin,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    }),
  );
}
async function handlerSignIn(auth: Awaited<ReturnType<typeof createTestAuth>>) {
  const response = await handlerRequest(auth, "sign-in/social", {
    body: { provider: "google", idToken: { token: "synthetic-test-only" } },
  });
  expect(response.status).toBe(200);
  return { response, cookie: cookies(response), result: await response.json() };
}

describe("synthetic PGlite auth migration", () => {
  it("completes a state-bound OAuth callback and encrypts fresh provider tokens", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const context = await auth.$context;
    const google = context.socialProviders[0];
    const accessToken = "synthetic-provider-access-token";
    const refreshToken = "synthetic-provider-refresh-token";
    google.validateAuthorizationCode = vi.fn(async () => ({
      accessToken,
      refreshToken,
      idToken: "synthetic-id-token",
      scopes: ["openid", "email", "profile"],
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    }));
    const started = await handlerRequest(auth, "sign-in/social", {
      body: {
        provider: "google",
        callbackURL: `${origin}/account`,
        disableRedirect: true,
      },
    });
    expect(started.status).toBe(200);
    const authorization = new URL((await started.json()).url);
    expect(authorization.origin).toBe("https://accounts.google.com");
    const state = authorization.searchParams.get("state");
    expect(state).toBeTruthy();
    const callback = await handlerRequest(
      auth,
      `callback/google?${new URLSearchParams({ code: "synthetic-code", state: state! })}`,
      { cookie: cookies(started) },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${origin}/account`);
    expect(google.validateAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "synthetic-code",
        codeVerifier: expect.any(String),
        redirectURI: `${origin}/api/auth/callback/google`,
      }),
    );
    const [account] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, plan.accounts[0].id!));
    expect(account.accessToken).not.toBe(accessToken);
    expect(account.refreshToken).not.toBe(refreshToken);
    expect(
      await symmetricDecrypt({
        key: context.secretConfig,
        data: account.accessToken!,
      }),
    ).toBe(accessToken);
    expect(
      await symmetricDecrypt({
        key: context.secretConfig,
        data: account.refreshToken!,
      }),
    ).toBe(refreshToken);
    expect(
      await getFreshSqlUserId(auth, new Headers({ cookie: cookies(callback) })),
    ).toBe(plan.users[0].id);
    // State is single-use: a replay cannot create a second session.
    const replay = await handlerRequest(
      auth,
      `callback/google?${new URLSearchParams({ code: "synthetic-code", state: state! })}`,
      { cookie: cookies(started) },
    );
    expect(replay.headers.get("location")).not.toBe(`${origin}/account`);
    expect(await db.select().from(schema.session)).toHaveLength(1);
    expect(google.validateAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it("issues distinct secure host-only cookies through the actual handler", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    expect(login.result.user.id).toBe(plan.users[0].id);
    const setCookies = login.response.headers.getSetCookie();
    expect(
      setCookies.some((value) =>
        value.startsWith("__Secure-magickli-sql.session_token="),
      ),
    ).toBe(true);
    expect(
      setCookies.some((value) =>
        value.startsWith("__Secure-magickli-sql.session_data="),
      ),
    ).toBe(true);
    for (const value of setCookies) {
      expect(value).toMatch(/; Secure/i);
      expect(value).toMatch(/; HttpOnly/i);
      expect(value).toMatch(/; SameSite=Lax/i);
      expect(value).not.toMatch(/; Domain=/i);
    }
    const response = await handlerRequest(auth, "get-session", {
      cookie: login.cookie,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const session = await response.json();
    expect(session.user.id).toBe(plan.users[0].id);
    expect(session.user).not.toHaveProperty("admin");
    expect(isUuidV7(session.session.id)).toBe(true);
  });

  it("ignores legacy Auth.js/Gongo credentials and forged signed SQL cookies", async () => {
    await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    const rawToken = (await db.select().from(schema.session))[0].token;
    for (const cookie of [
      `authjs.session-token=${rawToken}; next-auth.session-token=${rawToken}; nextAuthSessionToken=${rawToken}; sid=${rawToken}`,
      `__Secure-magickli-sql.session_token=${rawToken}`,
      login.cookie.replace(
        /(__Secure-magickli-sql.session_token=)([^;])/,
        (_, prefix, first) => `${prefix}${first === "x" ? "y" : "x"}`,
      ),
    ])
      expect(
        await getFreshSqlSession(auth, new Headers({ cookie })),
      ).toBeNull();
    expect(
      await getFreshSqlUserId(auth, new Headers({ cookie: login.cookie })),
    ).toBeTruthy();
  });

  it("bypasses a still-valid cookie cache after database session revocation", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    const headers = new Headers({ cookie: login.cookie });
    expect(await getFreshSqlUserId(auth, headers)).toBe(plan.users[0].id);
    await db.delete(schema.session);
    // Prove the stale cookie would still authenticate a cached UI read.
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(
      plan.users[0].id,
    );
    expect(await getFreshSqlSession(auth, headers)).toBeNull();
    expect(await getFreshSqlUserId(auth, headers)).toBeNull();
  });

  it("protects actual private ritual source after session revocation despite cached login", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    const headers = new Headers({ cookie: login.cookie });
    const groupId = createUuidV7(),
      ritualId = createUuidV7(),
      revisionId = createUuidV7();
    const source = "p Private synthetic source\r\n";
    await db
      .insert(schema.userGroups)
      .values({ id: groupId, name: "Synthetic private group" });
    await db.insert(schema.rituals).values({
      id: ritualId,
      title: "Private synthetic",
      creatorId: plan.users[0].id,
      scope: "group",
      groupId,
    });
    await db.insert(schema.ritualRevisions).values({
      id: revisionId,
      ritualId,
      authorId: plan.users[0].id!,
      source,
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      sourceFormat: "pug",
      sourceFormatVersion: "synthetic",
      createdAt: importedAt,
      updatedAt: importedAt,
    });
    await db
      .update(schema.rituals)
      .set({ currentRevisionId: revisionId })
      .where(eq(schema.rituals.id, ritualId));
    const reader = createSqlRitualReader(db, () =>
      getFreshSqlUserId(auth, headers),
    );
    expect((await reader.getCurrentSource(ritualId))?.revision.source).toBe(
      source,
    );
    await db.delete(schema.session);
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(
      plan.users[0].id,
    );
    expect(await reader.getCurrentSource(ritualId)).toBeNull();
    expect(await reader.getMetadata(ritualId)).toBeNull();
  });

  it("rejects expired and deleted-user sessions on fresh reads", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const first = await handlerSignIn(auth);
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1) });
    expect(
      await getFreshSqlSession(auth, new Headers({ cookie: first.cookie })),
    ).toBeNull();
    const second = await handlerSignIn(auth);
    await db.delete(schema.user).where(eq(schema.user.id, plan.users[0].id!));
    expect(
      await getFreshSqlSession(auth, new Headers({ cookie: second.cookie })),
    ).toBeNull();
  });

  it("does not renew valid sessions while checking a private boundary", async () => {
    await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    await db.update(schema.session).set({
      createdAt: new Date(Date.now() - 8 * 86400000),
      updatedAt: new Date(Date.now() - 3 * 86400000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const before = await db.select().from(schema.session);
    expect(
      await getFreshSqlSession(auth, new Headers({ cookie: login.cookie })),
    ).toBeTruthy();
    expect(await db.select().from(schema.session)).toEqual(before);
  });

  it("uses the actual sign-out handler to revoke the database session", async () => {
    await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    const response = await handlerRequest(auth, "sign-out", {
      cookie: login.cookie,
      body: {},
    });
    expect(response.status).toBe(200);
    expect(await db.select().from(schema.session)).toEqual([]);
    expect(
      await getFreshSqlSession(auth, new Headers({ cookie: login.cookie })),
    ).toBeNull();
  });

  it("refuses authenticated cross-origin sign-out with production origin checks", async () => {
    await importSynthetic();
    const auth = await createTestAuth();
    const login = await handlerSignIn(auth);
    // The factory explicitly retains these checks even in NODE_ENV=test.
    expect((await auth.$context).skipOriginCheck).toBe(false);
    expect((await auth.$context).skipCSRFCheck).toBe(false);
    const response = await handlerRequest(auth, "sign-out", {
      cookie: login.cookie,
      origin: "https://untrusted.example.test",
      body: {},
    });
    expect(response.status).toBe(403);
    expect(await db.select().from(schema.session)).toHaveLength(1);
    expect(
      await getFreshSqlSession(auth, new Headers({ cookie: login.cookie })),
    ).toBeTruthy();
  });

  it("creates a new Google user/account/session with UUIDv7 and no provider-derived grants", async () => {
    const auth = await createTestAuth({
      id: "brand-new-google-subject",
      email: "new@example.test",
    });
    const google = (await auth.$context).socialProviders[0];
    const getInfo = google.getUserInfo;
    google.getUserInfo = async (...args) => {
      const info = await getInfo(...args);
      return {
        ...info!,
        user: {
          ...info!.user,
          admin: true,
          role: "admin",
          groupIds: [createUuidV7()],
        },
        data: { ...info!.data, admin: true },
      };
    };
    const login = await handlerSignIn(auth);
    const users = await db.select().from(schema.user),
      accounts = await db.select().from(schema.account),
      sessions = await db.select().from(schema.session);
    expect(users).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    for (const row of [...users, ...accounts, ...sessions])
      expect(isUuidV7(row.id)).toBe(true);
    expect(accounts[0]).toMatchObject({
      accountId: "brand-new-google-subject",
      providerId: "google",
      userId: users[0].id,
    });
    expect(sessions[0].userId).toBe(users[0].id);
    expect(login.result.user).not.toHaveProperty("admin");
    expect(await db.select().from(schema.userAccess)).toEqual([]);
    expect((await loadSqlRitualPrincipal(db, users[0].id))?.globalAdmin).toBe(
      false,
    );
  });

  it("does not duplicate a Google identity when initial sign-ins race", async () => {
    const auth = await createTestAuth({
      id: "racing-google-subject",
      email: "race@example.test",
    });
    const body = {
      provider: "google",
      idToken: { token: "synthetic-test-only" },
    };
    const results = await Promise.allSettled([
      auth.api.signInSocial({ body }),
      auth.api.signInSocial({ body }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const users = await db.select().from(schema.user),
      accounts = await db.select().from(schema.account);
    expect(users).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe(users[0].id);
    const retry = await auth.api.signInSocial({ body });
    expect("user" in retry && retry.user.id).toBe(users[0].id);
    expect(await db.select().from(schema.user)).toHaveLength(1);
    expect(await db.select().from(schema.account)).toHaveLength(1);
  });

  it("rolls back a newly inserted user when its subsequent Google account insert fails", async () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const auth = await createTestAuth({
      id: "late-account-failure",
      email: "rollback@example.test",
    });
    await db.execute(
      sql`ALTER TABLE auth_account ADD CONSTRAINT synthetic_account_failure CHECK (account_id <> 'late-account-failure')`,
    );
    try {
      const response = await handlerRequest(auth, "sign-in/social", {
        body: { provider: "google", idToken: { token: "synthetic-test-only" } },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      const errorBody = await response.text();
      for (const value of [
        "synthetic-test-only",
        "late-account-failure",
        "rollback@example.test",
        "insert into",
      ])
        expect(errorBody).not.toContain(value);
      expect(logError).toHaveBeenCalled();
      for (const call of logError.mock.calls)
        expect(call).toEqual(["SQL_AUTH_ERROR"]);
      for (const call of logWarn.mock.calls)
        expect(call).toEqual(["SQL_AUTH_WARNING"]);
      expect(await db.select().from(schema.user)).toEqual([]);
      expect(await db.select().from(schema.account)).toEqual([]);
      expect(await db.select().from(schema.session)).toEqual([]);
    } finally {
      await db.execute(
        sql`ALTER TABLE auth_account DROP CONSTRAINT synthetic_account_failure`,
      );
    }
    // Removing only the synthetic failure allows the same identity to retry.
    await handlerSignIn(auth);
    expect(await db.select().from(schema.user)).toHaveLength(1);
    expect(await db.select().from(schema.account)).toHaveLength(1);
  });

  it("refuses password signup/signin and self-service account deletion", async () => {
    await importSynthetic();
    const auth = await createTestAuth();
    for (const path of ["sign-up/email", "sign-in/email"]) {
      const response = await handlerRequest(auth, path, {
        body: {
          name: "Synthetic",
          email: "new@example.test",
          password: "synthetic-password-that-must-not-work",
        },
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const login = await handlerSignIn(auth);
    expect(
      (
        await handlerRequest(auth, "delete-user", {
          cookie: login.cookie,
          body: {},
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(schema.user)).toHaveLength(2);
  });
  it("imports once with durable aliases and preserves exact rows on a rerun", async () => {
    const first = await importSynthetic();
    const before = await db.select().from(schema.legacyIdAliases);
    expect(await importSynthetic()).toEqual(first);
    expect(await db.select().from(schema.legacyIdAliases)).toEqual(before);
    expect(await db.select().from(schema.user)).toHaveLength(2);
    expect(await db.select().from(schema.account)).toHaveLength(2);
    const emails = await db.select().from(schema.legacyUserEmails);
    expect(emails).toHaveLength(3);
    expect(emails.every((email) => isUuidV7(email.id))).toBe(true);
    expect(await db.select().from(schema.session)).toEqual([]);
    expect(await db.select().from(schema.verification)).toEqual([]);
    for (const row of await db.select().from(schema.account)) {
      expect(row.accessToken).toBeNull();
      expect(row.refreshToken).toBeNull();
      expect(row.idToken).toBeNull();
      expect(row.password).toBeNull();
    }
    expect(
      (await db.select().from(schema.legacyAuthUsers))[1].createdAt,
    ).toBeNull();
  });

  it("enforces provider uniqueness, email case uniqueness, UUIDv7 and user references", async () => {
    const plan = await importSynthetic();
    await expect(
      db.insert(schema.account).values({
        userId: plan.users[1].id!,
        providerId: "google",
        accountId: "subject-editor",
      }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.user)
        .values({ name: "Collision", email: "EDITOR@example.test" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.user).values({
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Wrong version",
        email: "v4@example.test",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.session).values({
        userId: createUuidV7(),
        token: "orphan",
        expiresAt: importedAt,
      }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.user)).toHaveLength(2);
  });

  it("rolls back newly allocated aliases with failed auth writes", async () => {
    const test = fixture();
    await expect(
      db.transaction(async (tx) => {
        const id = await ensureLegacyId(tx, test.normalized.users[0].source);
        await tx
          .insert(schema.user)
          .values({ id, name: "Synthetic", email: "rollback@example.test" });
        await tx.insert(schema.account).values({
          userId: createUuidV7(),
          providerId: "google",
          accountId: "orphan",
        });
      }),
    ).rejects.toThrow();
    expect(await db.select().from(schema.user)).toEqual([]);
    expect(await db.select().from(schema.legacyIdAliases)).toEqual([]);
  });

  it("uses Better Auth's actual adapter to recognize a Google subject despite a changed email", async () => {
    const plan = await importSynthetic();
    const context = await (await createTestAuth()).$context;
    const found = await context.internalAdapter.findAccountOwnerByKey({
      accountId: "subject-editor",
      providerId: "google",
    });
    if (found?.kind !== "owned") throw new Error("Expected imported owner");
    expect(found.user.id).toBe(plan.users[0].id);
    expect(found.account.id).toBe(plan.accounts[0].id);
    expect(
      await context.internalAdapter.findAccountOwnerByKey({
        accountId: "new-subject",
        providerId: "google",
      }),
    ).toBeNull();
    expect(
      await context.internalAdapter.findUserByEmail("secondary@example.test"),
    ).toBeNull();
    const session = await context.internalAdapter.createSession(
      plan.users[0].id!,
    );
    expect(isUuidV7(session.id)).toBe(true);
    expect(session.userId).toBe(plan.users[0].id);
    expect(session.token).not.toContain("obsolete");
  });

  it("signs an imported Google identity into the original UUID even with a new email", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const result = await auth.api.signInSocial({
      body: { provider: "google", idToken: { token: "synthetic-test-only" } },
    });
    if (!("user" in result))
      throw new Error("Expected direct synthetic sign-in");
    expect(result.user.id).toBe(plan.users[0].id);
    expect(await db.select().from(schema.user)).toHaveLength(2);
    expect(await db.select().from(schema.session)).toHaveLength(1);
  });

  it("rejects implicit same-email linking even when Google verifies the email", async () => {
    await importSynthetic();
    const auth = await createTestAuth({
      id: "unlinked-subject",
      email: "editor@example.test",
    });
    await expect(
      auth.api.signInSocial({
        body: { provider: "google", idToken: { token: "synthetic-test-only" } },
      }),
    ).rejects.toMatchObject({
      body: { code: "OAUTH_LINK_ERROR", message: "account not linked" },
    });
    expect(await db.select().from(schema.account)).toHaveLength(2);
    expect(await db.select().from(schema.session)).toEqual([]);
  });

  it("uses Loom session readers with canonical IDs and rejects a revoked session", async () => {
    const plan = await importSynthetic();
    const auth = await createTestAuth();
    const response = await auth.api.signInSocial({
      body: { provider: "google", idToken: { token: "synthetic-test-only" } },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const readers = createRequestAuthSessionReaders({
      auth,
      getHeaders: () => new Headers({ cookie }),
    });
    const session = await readers.getFreshSession();
    expect(session?.user.id).toBe(plan.users[0].id);
    expect(isUuidV7(session?.session.id)).toBe(true);
    await db.delete(schema.session);
    expect(await readers.getFreshSession()).toBeNull();
  });

  it("keeps application access and profile independent of auth profile updates", async () => {
    const plan = await importSynthetic();
    const context = await (await createTestAuth()).$context;
    await context.internalAdapter.updateUser(plan.users[0].id!, {
      name: "Provider changed name",
      emailVerified: false,
    });
    expect(
      await db
        .select()
        .from(schema.userAccess)
        .where(eq(schema.userAccess.userId, plan.users[0].id!)),
    ).toEqual([{ userId: plan.users[0].id, admin: true }]);
    expect(
      (
        await db
          .select()
          .from(schema.userProfile)
          .where(eq(schema.userProfile.userId, plan.users[0].id!))
      )[0].displayName,
    ).toBe("Synthetic Editor");
    expect(
      (
        await db
          .select()
          .from(schema.legacyUserEmails)
          .where(eq(schema.legacyUserEmails.userId, plan.users[0].id!))
      ).every((email) => email.verified),
    ).toBe(true);
  });
});
