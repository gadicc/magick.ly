import { createHash } from "node:crypto";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { client, db } from "../../tests/memory-pglite";
import {
  createLegacyImportMigrationManifest as create,
  type LegacyImportMigrationManifest,
  LegacyImportMigrationsError,
  verifyLegacyImportMigrations as verify,
} from "./legacyImportMigrations";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const read = () => readMigrationFiles({ migrationsFolder: "drizzle" });
const migration = (source = "select 1;", when = 1): MigrationMeta => ({
  sql: source.split("--> statement-breakpoint"),
  bps: true,
  folderMillis: when,
  hash: hash(source),
});
await client.exec(
  "create schema if not exists drizzle; create table if not exists drizzle.__drizzle_migrations (id serial primary key, created_at bigint, hash text not null)",
);
beforeEach(async () => {
  await client.exec("truncate drizzle.__drizzle_migrations");
});
async function insert(manifest: LegacyImportMigrationManifest) {
  for (const row of manifest.entries)
    await client.query(
      "insert into drizzle.__drizzle_migrations(created_at,hash) values ($1,$2)",
      [row.createdAt, row.sha256],
    );
}
describe("exact applied migration history", () => {
  it("uses the installed reader's actual artifact and verifies all historical records", async () => {
    const manifest = create(read());
    expect(manifest.entries.length).toBeGreaterThanOrEqual(13);
    await insert(manifest);
    expect(await verify(db, manifest)).toBe(manifest.sha256);
    expect(create(read())).toEqual(manifest);
  });
  it("preserves exact SQL bytes, breakpoints and timestamps in its identity", () => {
    const source =
      "\uFEFF-- e\u0301\r\nselect 1;--> statement-breakpoint\nselect 2;";
    const first = create([migration(source)]);
    expect(first.entries[0].sha256).toBe(hash(source));
    expect(create([migration(source.replace(/\r\n/g, "\n"))]).sha256).not.toBe(
      first.sha256,
    );
    expect(create([{ ...migration(source), bps: false }]).sha256).not.toBe(
      first.sha256,
    );
    expect(create([migration(source, 2)]).sha256).not.toBe(first.sha256);
  });
  it.each([
    ["empty", []],
    ["non-array", {}],
    [
      "too many",
      Array.from({ length: 1001 }, (_, i) => migration("select 1;", i + 1)),
    ],
    ["duplicate timestamp", [migration(), migration()]],
    ["reversed timestamp", [migration("select 2;", 2), migration()]],
    ["zero timestamp", [migration("select 1;", 0)]],
    ["fractional timestamp", [migration("select 1;", 1.5)]],
    ["unsafe timestamp", [migration("select 1;", Number.MAX_SAFE_INTEGER + 1)]],
    ["missing SQL", [{ ...migration(), sql: [] }]],
    ["wrong SQL type", [{ ...migration(), sql: [1] }]],
    ["null SQL", [{ ...migration(), sql: null }]],
    ["empty SQL", [migration("")]],
    ["NUL SQL", [migration("select '\0';")]],
    ["unpaired surrogate", [migration("\uD800")]],
    ["false hash", [{ ...migration(), hash: "f".repeat(64) }]],
    [
      "missing field",
      [{ sql: ["select 1;"], folderMillis: 1, hash: hash("select 1;") }],
    ],
    ["extra field", [{ ...migration(), extra: "private" }]],
    ["nonboolean breakpoints", [{ ...migration(), bps: "yes" }]],
    ["over byte budget", [migration("-".repeat(16 * 1024 * 1024 + 1))]],
  ])("refuses %s before any database operation", (_label, input) => {
    expect(() => create(input as MigrationMeta[])).toThrow(
      new LegacyImportMigrationsError("INVALID_MIGRATIONS"),
    );
  });
  it("does not call an accessor while copying the source", () => {
    let called = false;
    const source = migration();
    Object.defineProperty(source, "hash", {
      enumerable: true,
      get() {
        called = true;
        return "private";
      },
    });
    expect(() => create([source])).toThrow(LegacyImportMigrationsError);
    expect(called).toBe(false);
  });
  it.each([
    "update drizzle.__drizzle_migrations set hash=repeat('f',64) where created_at=1",
    "delete from drizzle.__drizzle_migrations where created_at=1",
    "insert into drizzle.__drizzle_migrations(created_at,hash) values(3,repeat('a',64))",
    "insert into drizzle.__drizzle_migrations(created_at,hash) select created_at,hash from drizzle.__drizzle_migrations where created_at=1",
    "update drizzle.__drizzle_migrations set created_at=0 where created_at=1",
    "update drizzle.__drizzle_migrations set created_at=null where created_at=1",
  ])(
    "rejects historical drift with a matching newest entry: %s",
    async (change) => {
      const manifest = create([migration(), migration("select 2;", 2)]);
      await insert(manifest);
      await client.exec(change);
      await expect(verify(db, manifest)).rejects.toEqual(
        new LegacyImportMigrationsError("MIGRATIONS_MISMATCH"),
      );
    },
  );
  it("does not depend on the database's row order or incidental journal IDs", async () => {
    const manifest = create([migration(), migration("select 2;", 2)]);
    await insert({ ...manifest, entries: manifest.entries.toReversed() });
    await client.exec("update drizzle.__drizzle_migrations set id=id+20");
    expect(await verify(db, manifest)).toBe(manifest.sha256);
  });
  it.each([
    (m: Record<string, unknown>) => {
      m.profile = "unsupported";
    },
    (m: Record<string, unknown>) => {
      m.sha256 = "f".repeat(64);
    },
    (m: Record<string, unknown>) => {
      m.extra = true;
    },
    (m: Record<string, unknown>) => {
      m.entries = [{ createdAt: 1, sha256: "F".repeat(64), breakpoints: true }];
    },
  ])("refuses a changed manifest before querying", async (mutate) => {
    const manifest = create([migration()]);
    mutate(manifest as unknown as Record<string, unknown>);
    await expect(verify(db, manifest)).rejects.toEqual(
      new LegacyImportMigrationsError("INVALID_MIGRATIONS"),
    );
  });
  it("snapshots the expected journal before an asynchronous caller can mutate it", async () => {
    const manifest = create([migration()]);
    const digest = manifest.sha256;
    await insert(manifest);
    const work = verify(db, manifest);
    manifest.entries[0].sha256 = "f".repeat(64);
    manifest.sha256 = "f".repeat(64);
    expect(await work).toBe(digest);
  });
  it("suppresses database diagnostics when a query fails", async () => {
    const broken = {
      select: (() => {
        throw new Error("private diagnostic");
      }) as typeof db.select,
    };
    await expect(verify(broken, create([migration()]))).rejects.toEqual(
      new LegacyImportMigrationsError("READ_FAILED"),
    );
  });
});
