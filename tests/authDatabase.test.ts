import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import {
  createBetterAuthSessionConfig,
  requireBetterAuthSecret,
} from "@gadicc/loom/next/auth";
import { createRequestAuthSessionReaders } from "@gadicc/loom/next/auth/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureLegacyId } from "../src/db/legacyIds";
import * as schema from "../src/db/schema";
import { createUuidV7, isUuidV7 } from "../src/lib/ids";
import {
  legacyProviderAlias,
  planBetterAuthImport,
  planLegacyUserAccess,
} from "../src/migration/planBetterAuthImport";
import { fixture, importedAt, sourceKey } from "./authFixtures";

const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());
beforeEach(async () => {
  await db.delete(schema.user);
  await db.delete(schema.verification);
  await db.delete(schema.legacyIdAliases);
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

function createTestAuth(
  profile = { id: "subject-editor", email: "changed@example.test" },
) {
  return betterAuth({
    baseURL: "https://synthetic.example.test",
    secret: requireBetterAuthSecret({
      env: {
        BETTER_AUTH_SECRET:
          "synthetic-auth-schema-test-secret-over-thirty-two-characters",
      },
    }),
    session: createBetterAuthSessionConfig(),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        account: schema.account,
        session: schema.session,
        verification: schema.verification,
      },
    }),
    advanced: { database: { generateId: createUuidV7 } },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    socialProviders: {
      google: {
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        // Test-only provider boundary; no Google JWT verification or network I/O.
        verifyIdToken: async () => true,
        getUserInfo: async () => ({
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
        }),
      },
    },
    logger: { disabled: true },
  });
}

describe("synthetic PGlite auth migration", () => {
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
    const context = await createTestAuth().$context;
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
    const auth = createTestAuth();
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
    const auth = createTestAuth({
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
    const auth = createTestAuth();
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
    const context = await createTestAuth().$context;
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
