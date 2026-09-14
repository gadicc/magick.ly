import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { LOCAL_ACCEPTANCE_USERS } from "../../src/auth/localTestIdentities";
import { createSqlAuth, getFreshSqlSession } from "../../src/auth/sqlAuth";
import { legacyImportRuns } from "../../src/db/schema/legacyImportRuns";
import { userAccess } from "../../src/db/schema/userProfile";
import { isUuidV7 } from "../../src/lib/ids";
import {
  LOCAL_ACCEPTANCE_DATABASE,
  LOCAL_ACCEPTANCE_ROLE,
  prepareLocalAcceptanceOutput,
  readLocalAcceptanceConfig,
} from "./config";

const PROFILE = "magickli-local-acceptance-auth-v1";
const digest = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function absent(filename: string) {
  try {
    await access(filename, constants.F_OK);
    throw new Error("LOCAL_ACCEPTANCE_OUTPUT_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writePrivateJson(filename: string, value: unknown) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(filename, 0o600);
}

async function main() {
  const config = readLocalAcceptanceConfig(process.env);
  const output = await prepareLocalAcceptanceOutput(config);
  const filenames = Object.fromEntries(
    LOCAL_ACCEPTANCE_USERS.map(({ role }) => [
      role,
      path.join(output, `${role}.storage-state.json`),
    ]),
  ) as Record<(typeof LOCAL_ACCEPTANCE_USERS)[number]["role"], string>;
  const manifestFilename = path.join(output, "manifest.json");
  for (const filename of [...Object.values(filenames), manifestFilename])
    await absent(filename);

  const { db } = await import("../../src/db/neonFull");
  const target = await db.execute(sql<{
    database_name: string;
    role_name: string;
    users: number;
    sessions: number;
    access_rows: number;
    import_runs: number;
  }>`select current_database() as database_name,
    current_user as role_name,
    (select count(*)::int from auth_user) as users,
    (select count(*)::int from auth_session) as sessions,
    (select count(*)::int from user_access) as access_rows,
    (select count(*)::int from legacy_import_runs) as import_runs`);
  const identity = target[0];
  if (
    !identity ||
    identity.database_name !== LOCAL_ACCEPTANCE_DATABASE ||
    identity.role_name !== LOCAL_ACCEPTANCE_ROLE
  )
    throw new Error("LOCAL_ACCEPTANCE_TARGET_MISMATCH");
  if (
    [
      identity.users,
      identity.sessions,
      identity.access_rows,
      identity.import_runs,
    ].some((count) => count !== 0)
  )
    throw new Error("LOCAL_ACCEPTANCE_DATABASE_NOT_EMPTY");

  const productionAuth = createSqlAuth({
    db,
    baseURL: config.origin,
    secret: config.authSecret,
    googleClientId: "synthetic-local-acceptance-client",
    googleClientSecret: "synthetic-local-acceptance-secret",
  });
  const productionOptions: BetterAuthOptions = productionAuth.options;
  const testAuth = betterAuth({
    ...productionOptions,
    plugins: [...(productionOptions.plugins ?? []), testUtils()],
  });
  const context = await testAuth.$context;
  const now = new Date();
  const importPayload = JSON.stringify({
    profile: "magickli-local-acceptance-readiness-v1",
    synthetic: true,
  });
  const expectedRowsSha256 = digest(
    "magickli-local-acceptance-synthetic-rows-v1",
  );
  const states: Record<string, unknown> = {};
  for (const identity of LOCAL_ACCEPTANCE_USERS) {
    if (!isUuidV7(identity.id))
      throw new Error("LOCAL_ACCEPTANCE_FIXTURE_INVALID");
    await context.test.saveUser(
      context.test.createUser({
        id: identity.id,
        name: identity.name,
        email: identity.email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    if (identity.role === "admin")
      await db.insert(userAccess).values({ userId: identity.id, admin: true });
    const login = await context.test.login({ userId: identity.id });
    if (
      login.cookies.length !== 1 ||
      login.cookies[0].name !== "magickli-sql.session_token" ||
      login.cookies[0].domain !== "127.0.0.1" ||
      login.cookies[0].path !== "/" ||
      login.cookies[0].httpOnly !== true ||
      login.cookies[0].secure === true ||
      login.cookies[0].sameSite !== "Lax"
    )
      throw new Error("LOCAL_ACCEPTANCE_COOKIE_INVALID");
    const verified = await getFreshSqlSession(productionAuth, login.headers);
    if (verified?.user.id !== identity.id)
      throw new Error("LOCAL_ACCEPTANCE_SESSION_INVALID");
    states[identity.role] = { cookies: login.cookies, origins: [] };
  }
  await db.insert(legacyImportRuns).values({
    runId: "019a0000-0000-7000-8000-000000000010",
    slot: 1,
    profile: "magickli-legacy-import-run-v1",
    sourceManifestSha256: digest("local-acceptance-source-manifest"),
    sourceDescriptorSha256: digest("local-acceptance-source-descriptor"),
    configurationSha256: digest("local-acceptance-configuration"),
    schemaSha256: digest("local-acceptance-schema"),
    targetSha256: digest("local-acceptance-target"),
    payloadSha256: digest(importPayload),
    expectedRowsSha256,
    payload: importPayload,
    importedAt: now,
    preparedAt: now,
    completedAt: now,
    reconciliationSha256: expectedRowsSha256,
  });

  const temporary: string[] = [];
  try {
    for (const identity of LOCAL_ACCEPTANCE_USERS) {
      const filename = `${filenames[identity.role]}.new`;
      temporary.push(filename);
      await writePrivateJson(filename, states[identity.role]);
    }
    const manifest = {
      profile: PROFILE,
      database: LOCAL_ACCEPTANCE_DATABASE,
      role: LOCAL_ACCEPTANCE_ROLE,
      origin: config.origin,
      identities: LOCAL_ACCEPTANCE_USERS.map(({ role, id }) => ({
        role,
        id,
        storageState: path.basename(filenames[role]),
      })),
    };
    const manifestTemp = `${manifestFilename}.new`;
    temporary.push(manifestTemp);
    await writePrivateJson(manifestTemp, manifest);
    for (const identity of LOCAL_ACCEPTANCE_USERS)
      await rename(`${filenames[identity.role]}.new`, filenames[identity.role]);
    await rename(manifestTemp, manifestFilename);
    console.log(
      JSON.stringify({
        success: true,
        profile: PROFILE,
        identities: LOCAL_ACCEPTANCE_USERS.map(({ role, id }) => ({
          role,
          id,
        })),
        output,
      }),
    );
  } finally {
    await Promise.all(
      temporary.map((filename) => rm(filename, { force: true })),
    );
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    const code =
      error instanceof Error && /^LOCAL_ACCEPTANCE_[A-Z_]+$/.test(error.message)
        ? error.message
        : "LOCAL_ACCEPTANCE_SEED_FAILED";
    console.error(code);
    process.exitCode = 1;
  } finally {
    const client = (
      globalThis as typeof globalThis & {
        __loomNeonFullSql?: {
          end(options?: { timeout?: number }): Promise<void>;
        };
      }
    ).__loomNeonFullSql;
    await client?.end({ timeout: 1 }).catch(() => {});
  }
}

void run();
