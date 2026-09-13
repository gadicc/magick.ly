import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MigrationMeta } from "drizzle-orm/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";

const profile = "magickli-import-migrations-v1";
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
type Entry = { createdAt: number; sha256: string; breakpoints: boolean };
/** Exact ordered migration SQL identities from the installed Drizzle reader. */
export interface LegacyImportMigrationManifest {
  profile: typeof profile;
  entries: Entry[];
  sha256: string;
}
export class LegacyImportMigrationsError extends Error {
  constructor(
    public readonly code:
      | "INVALID_MIGRATIONS"
      | "MIGRATIONS_MISMATCH"
      | "READ_FAILED",
  ) {
    super(code);
    this.name = "LegacyImportMigrationsError";
  }
}
function fail(
  code: LegacyImportMigrationsError["code"] = "INVALID_MIGRATIONS",
): never {
  throw new LegacyImportMigrationsError(code);
}
function copy<T>(value: T): T {
  try {
    return parseLegacyImportValue(serializeLegacyImportValue(value)) as T;
  } catch {
    return fail();
  }
}
function fields(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
}
function entries(input: unknown): Entry[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 1000) fail();
  let previous = 0;
  return input.map((entry) => {
    fields(entry, ["createdAt", "sha256", "breakpoints"]);
    if (
      !Number.isSafeInteger(entry.createdAt) ||
      (entry.createdAt as number) <= previous ||
      typeof entry.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      typeof entry.breakpoints !== "boolean"
    )
      fail();
    previous = entry.createdAt as number;
    return {
      createdAt: previous,
      sha256: entry.sha256,
      breakpoints: entry.breakpoints,
    };
  });
}
function digest(values: Entry[]) {
  return hash(serializeLegacyImportValue({ profile, entries: values }));
}

/**
 * Run the installed readMigrationFiles against the reviewed artifact, then bind
 * its exact SQL bytes and ordered timestamps here. This function performs no
 * filesystem/env/database access and never executes migration statements.
 */
export function createLegacyImportMigrationManifest(
  input: readonly MigrationMeta[],
): LegacyImportMigrationManifest {
  try {
    const migrations = copy(input);
    if (
      !Array.isArray(migrations) ||
      migrations.length < 1 ||
      migrations.length > 1000
    )
      fail();
    let bytes = 0;
    const values = entries(
      migrations.map((migration) => {
        fields(migration, ["sql", "bps", "folderMillis", "hash"]);
        if (
          !Array.isArray(migration.sql) ||
          !migration.sql.length ||
          migration.sql.some(
            (statement) =>
              typeof statement !== "string" ||
              !statement.isWellFormed() ||
              statement.includes("\0"),
          )
        )
          fail();
        // This is the exact inverse of Drizzle's current split; no trimming or
        // newline normalization may change the hash already stored in PostgreSQL.
        const source = migration.sql.join("--> statement-breakpoint");
        bytes += Buffer.byteLength(source);
        if (
          !source.length ||
          bytes > 16 * 1024 * 1024 ||
          hash(source) !== migration.hash
        )
          fail();
        return {
          createdAt: migration.folderMillis,
          sha256: migration.hash,
          breakpoints: migration.bps,
        };
      }),
    );
    return { profile, entries: values, sha256: digest(values) };
  } catch {
    return fail();
  }
}

/**
 * Check every applied historical hash/timestamp, including missing/extra rows.
 * Caller holds the journal lock in its fenced import transaction. A matching
 * journal is necessary but does not establish an unchanged database catalog.
 */
export async function verifyLegacyImportMigrations(
  tx: Pick<PgDatabase<PgQueryResultHKT>, "select">,
  expected: LegacyImportMigrationManifest,
): Promise<string> {
  const manifest = copy(expected);
  fields(manifest, ["profile", "entries", "sha256"]);
  const values = entries(manifest.entries);
  const sha256 = digest(values);
  if (manifest.profile !== profile || manifest.sha256 !== sha256) fail();
  const payload = JSON.stringify(
    values.map((entry) => ({
      created_at: entry.createdAt,
      hash: entry.sha256,
    })),
  );
  try {
    const result = await tx
      .select({ matches: sql<boolean>`verification.matches` })
      .from(sql`(
      with expected as (
        select created_at, hash collate "C" from jsonb_to_recordset(${payload}::jsonb) as record(created_at bigint, hash text)
      ), actual as (
        select created_at, hash collate "C" from drizzle.__drizzle_migrations
      )
      select not exists (
        (select * from expected except all select * from actual)
        union all
        (select * from actual except all select * from expected)
      ) as matches
    ) as verification`);
    if (result.length !== 1 || result[0].matches !== true)
      fail("MIGRATIONS_MISMATCH");
    return sha256;
  } catch (error) {
    if (error instanceof LegacyImportMigrationsError)
      throw new LegacyImportMigrationsError(error.code);
    return fail("READ_FAILED");
  }
}
