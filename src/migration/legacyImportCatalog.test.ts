import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import {
  captureLegacyImportCatalog as capture,
  type LegacyImportCatalog,
  LegacyImportCatalogError,
  verifyLegacyImportCatalog as verify,
} from "./legacyImportCatalog";
import { serializeLegacyImportValue } from "./legacyImportValue";

const harness = await createMemoryPgliteHarness({ schema });
const { db, client } = harness;
afterAll(() => client.close());
await client.exec("set search_path = pg_catalog, public, pg_temp");
const baseline = await capture(db);
type Tx = Parameters<typeof capture>[0];

async function refused(
  work: Promise<unknown>,
  code: LegacyImportCatalogError["code"],
) {
  let caught: unknown;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LegacyImportCatalogError);
  expect((caught as LegacyImportCatalogError).code).toBe(code);
  expect((caught as Error).message).toBe(code);
  expect(Reflect.ownKeys(caught as object).sort()).toEqual([
    "code",
    "message",
    "name",
    "stack",
  ]);
}
async function rollback(
  work: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<void>,
) {
  const stop = new Error("synthetic transaction rollback");
  await expect(
    db.transaction(async (tx) => {
      await work(tx);
      throw stop;
    }),
  ).rejects.toBe(stop);
}
function rehash(value: LegacyImportCatalog) {
  // Useful only to test that a changed baseline is rejected by comparison; the
  // caller must never accept a newly captured target as its reviewed baseline.
  value.sha256 = createHash("sha256")
    .update(
      serializeLegacyImportValue({
        profile: value.profile,
        snapshot: value.snapshot,
      }),
    )
    .digest("hex");
}

describe("reviewed legacy import catalog evidence", () => {
  it("captures the actual fresh schema without row data, relation OIDs or database names", async () => {
    expect(baseline.profile).toBe("magickli-import-catalog-v1");
    expect(baseline.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await capture(db)).toEqual(baseline);
    expect(await verify(db, baseline)).toBe(baseline.sha256);
    const ordinary = baseline.snapshot.relations.filter((r) => r.kind === "r");
    expect(ordinary.map((r) => r.name)).toContain("auth_user");
    expect(ordinary.map((r) => r.name)).toContain("rituals");
    expect(ordinary.length).toBeGreaterThanOrEqual(33);
    expect(
      baseline.snapshot.columns.some(
        (c) => c.relation === "rituals" && c.name === "current_revision_id",
      ),
    ).toBe(true);
    expect(
      baseline.snapshot.constraints.some(
        (c) =>
          c.name === "rituals_current_revision_own_parent" &&
          c.kind === "f" &&
          c.validated === true,
      ),
    ).toBe(true);
    expect(
      baseline.snapshot.routines.some(
        (r) =>
          r.name === "uuid_generate_v7" && typeof r.definition === "string",
      ),
    ).toBe(true);
    expect(
      baseline.snapshot.extensions.some(
        (e) => e.name === "plpgsql" && typeof e.version === "string",
      ),
    ).toBe(true);
    expect(baseline.snapshot.database.searchPath).toBe(
      "pg_catalog, public, pg_temp",
    );
    expect(baseline.snapshot.database.postgresMajor).toBeGreaterThanOrEqual(15);
    expect(baseline.snapshot.database.encoding).toBe("UTF8");
    function keys(value: unknown): string[] {
      if (!value || typeof value !== "object") return [];
      return [...Object.keys(value), ...Object.values(value).flatMap(keys)];
    }
    expect(
      keys(baseline).some((k) =>
        /(^oid$|oid$|relfilenode|reltuples|datname|last_value)/i.test(k),
      ),
    ).toBe(false);
  });

  it("does not change when only application data changes", async () => {
    await rollback(async (tx) => {
      await tx.insert(schema.user).values({
        id: "01993000-0000-7000-8000-000000000abc",
        name: "SYNTHETIC_PRIVATE_ROW",
        email: "synthetic-catalog@example.test",
      });
      const current = await capture(tx);
      expect(current).toEqual(baseline);
      expect(JSON.stringify(current)).not.toContain("SYNTHETIC_PRIVATE_ROW");
    });
  });

  const changes = [
    [
      "missing constraint",
      "alter table public.rituals drop constraint rituals_version_safe",
    ],
    [
      "changed check definition",
      [
        "alter table public.rituals drop constraint rituals_version_safe",
        "alter table public.rituals add constraint rituals_version_safe check(version between 0 and 100)",
      ],
    ],
    [
      "not validated constraint",
      [
        "alter table public.rituals drop constraint rituals_version_safe",
        "alter table public.rituals add constraint rituals_version_safe check(version between 0 and 9007199254740991) not valid",
      ],
    ],
    [
      "default",
      "alter table public.auth_user alter column email_verified set default true",
    ],
    [
      "column type",
      "alter table public.user_profile alter column display_name type varchar(300)",
    ],
    [
      "nullability",
      "alter table public.user_profile alter column display_name set not null",
    ],
    [
      "column collation",
      'alter table public.user_profile alter column display_name type text collate "C"',
    ],
    [
      "added column",
      "alter table public.user_profile add column synthetic_extra text",
    ],
    [
      "extra relation",
      "create table public.synthetic_extra(id integer primary key)",
    ],
    ["missing relation", "drop table public.user_profile"],
    [
      "view",
      "create view public.synthetic_view as select user_id from public.user_profile",
    ],
    [
      "materialized view",
      "create materialized view public.synthetic_matview as select user_id from public.user_profile",
    ],
    [
      "unique index",
      "create unique index synthetic_unique on public.user_profile(display_name)",
    ],
    [
      "partial expression index",
      "create index synthetic_partial on public.user_profile(lower(display_name)) where display_name is not null",
    ],
    ["enum label", "alter type public.legacy_id_type add value 'synthetic'"],
    [
      "enum label ordering",
      "alter type public.legacy_id_type add value 'synthetic' before 'objectid'",
    ],
    ["new enum", "create type public.synthetic_enum as enum ('a','b')"],
    [
      "domain definition",
      "create domain public.synthetic_domain as text check(value <> '')",
    ],
    [
      "RLS enabled",
      "alter table public.user_profile enable row level security",
    ],
    ["RLS forced", "alter table public.user_profile force row level security"],
    [
      "RLS policy",
      "create policy synthetic_policy on public.user_profile for select to public using (false)",
    ],
    ["table privilege", "grant select on public.user_profile to public"],
    [
      "column privilege",
      "grant select(display_name) on public.user_profile to public",
    ],
    [
      "function body",
      "create or replace function public.uuid_generate_v7() returns uuid language sql as 'select null::uuid'",
    ],
    [
      "function security",
      "alter function public.uuid_generate_v7() security definer",
    ],
    [
      "function search path",
      "alter function public.uuid_generate_v7() set search_path = public",
    ],
    [
      "function privilege",
      "revoke execute on function public.uuid_generate_v7() from public",
    ],
    [
      "extra function",
      "create function public.synthetic_function() returns integer language sql as 'select 7'",
    ],
    [
      "generated column",
      "alter table public.user_profile add column synthetic_computed text generated always as (upper(display_name)) stored",
    ],
    [
      "identity column",
      "alter table public.user_profile add column synthetic_identity bigint generated always as identity",
    ],
    ["sequence", "create sequence public.synthetic_sequence increment 7"],
    [
      "rewrite rule",
      "create rule synthetic_rule as on delete to public.user_profile do instead nothing",
    ],
  ] as const;
  it.each(changes)("detects %s drift", async (_name, change) => {
    await rollback(async (tx) => {
      for (const statement of typeof change === "string" ? [change] : change)
        await tx.execute(sql.raw(statement));
      const altered = await capture(tx);
      expect(altered.sha256).not.toBe(baseline.sha256);
      await refused(verify(tx, baseline), "CATALOG_MISMATCH");
    });
    expect(await verify(db, baseline)).toBe(baseline.sha256);
  });

  it("captures trigger definitions and disabled trigger state", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql.raw(
          "create function public.synthetic_trigger() returns trigger language plpgsql as 'begin return new; end'",
        ),
      );
      await tx.execute(
        sql.raw(
          "create trigger synthetic_trigger before insert on public.user_profile for each row execute function public.synthetic_trigger()",
        ),
      );
      const enabled = await capture(tx);
      expect(
        enabled.snapshot.triggers.some(
          (t) => t.name === "synthetic_trigger" && t.enabled === "O",
        ),
      ).toBe(true);
      await refused(verify(tx, baseline), "CATALOG_MISMATCH");
      await tx.execute(
        sql.raw(
          "alter table public.user_profile disable trigger synthetic_trigger",
        ),
      );
      const disabled = await capture(tx);
      expect(
        disabled.snapshot.triggers.some(
          (t) => t.name === "synthetic_trigger" && t.enabled === "D",
        ),
      ).toBe(true);
      await refused(verify(tx, enabled), "CATALOG_MISMATCH");
    });
  });

  it("keeps sequence values and consumed transaction IDs out of static evidence", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql.raw(
          "create sequence public.synthetic_sequence start 1 increment 3",
        ),
      );
      const before = await capture(tx);
      await tx.execute(sql.raw("select nextval('public.synthetic_sequence')"));
      expect(await capture(tx)).toEqual(before);
      await tx.execute(
        sql.raw("alter sequence public.synthetic_sequence increment 4"),
      );
      await refused(verify(tx, before), "CATALOG_MISMATCH");
    });
  });

  it("does not bind transient relation OIDs", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql.raw(
          "create table public.synthetic_same(id integer not null, value text)",
        ),
      );
      const before = await capture(tx);
      await tx.execute(sql.raw("drop table public.synthetic_same"));
      await tx.execute(
        sql.raw(
          "create table public.synthetic_same(id integer not null, value text)",
        ),
      );
      expect(await capture(tx)).toEqual(before);
    });
  });

  it("refuses an aggregate instead of pretending to deparse its transition machinery", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql.raw(
          "create aggregate public.synthetic_sum(integer) (sfunc = pg_catalog.int4pl, stype = integer, initcond = '0')",
        ),
      );
      await refused(capture(tx), "INVALID_CATALOG");
    });
  });

  it("keeps public relation and deparser resolution ahead of unrelated temporary tables", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql`create temporary table auth_user (synthetic_value text)`,
      );
      await tx.execute(
        sql`create temporary table legacy_import_runs (synthetic_value text)`,
      );
      const resolution = await tx
        .select({
          user: sql<boolean>`pg_catalog.to_regclass('auth_user') = 'public.auth_user'::pg_catalog.regclass`,
          run: sql<boolean>`pg_catalog.to_regclass('legacy_import_runs') = 'public.legacy_import_runs'::pg_catalog.regclass`,
        })
        .from(sql`(select 1) as resolution`);
      expect(resolution).toEqual([{ user: true, run: true }]);
      expect(await capture(tx)).toEqual(baseline);
      expect(await verify(tx, baseline)).toBe(baseline.sha256);
    });
  });

  it.each([
    "public",
    "pg_catalog",
    "pg_catalog, public",
    "pg_catalog, pg_temp, public",
    '"pg_catalog", "public", "pg_temp"',
  ])(
    "requires the exact fixed search_path instead of adopting %s",
    async (path) => {
      await rollback(async (tx) => {
        await tx.execute(
          sql`select pg_catalog.set_config('search_path', ${path}, true)`,
        );
        await refused(capture(tx), "INVALID_CATALOG");
      });
    },
  );

  it.each([
    [
      "profile",
      (v: LegacyImportCatalog) => {
        (v as unknown as Record<string, unknown>).profile = "other";
      },
    ],
    [
      "hash",
      (v: LegacyImportCatalog) => {
        v.sha256 = "0".repeat(64);
      },
    ],
    [
      "snapshot content",
      (v: LegacyImportCatalog) => {
        v.snapshot.relations.pop();
      },
    ],
    [
      "extra field",
      (v: LegacyImportCatalog) => {
        (v as unknown as Record<string, unknown>).extra = true;
      },
    ],
    [
      "missing section",
      (v: LegacyImportCatalog) => {
        delete (v.snapshot as unknown as Record<string, unknown>).columns;
      },
    ],
    [
      "invalid section",
      (v: LegacyImportCatalog) => {
        (v.snapshot as unknown as Record<string, unknown>).relations = null;
      },
    ],
    [
      "Date object",
      (v: LegacyImportCatalog) => {
        (v.snapshot.database as Record<string, unknown>).encoding = new Date();
      },
    ],
  ] as const)(
    "refuses changed expected %s before any query",
    async (_name, mutate) => {
      const saved = structuredClone(baseline);
      mutate(saved);
      let queries = 0;
      const never = {
        select() {
          queries++;
          throw new Error("synthetic diagnostic");
        },
      } as unknown as Tx;
      await refused(verify(never, saved), "INVALID_CATALOG");
      expect(queries).toBe(0);
    },
  );

  it("will not accept a self-consistent baseline for a different database environment", async () => {
    const saved = structuredClone(baseline);
    saved.snapshot.database.encoding = "LATIN1";
    rehash(saved);
    await refused(verify(db, saved), "CATALOG_MISMATCH");
  });

  it("does not invoke expected accessors or leak their error text", async () => {
    const saved = structuredClone(baseline);
    let accessed = false;
    Object.defineProperty(saved, "sha256", {
      enumerable: true,
      get() {
        accessed = true;
        throw new Error("synthetic private text");
      },
    });
    await refused(verify(db, saved), "INVALID_CATALOG");
    expect(accessed).toBe(false);
  });

  it("owns the expected baseline before awaiting a query", async () => {
    const saved = structuredClone(baseline);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = {
      select: (...args: Parameters<typeof db.select>) => ({
        from: async (
          from: Parameters<ReturnType<typeof db.select>["from"]>[0],
        ) => {
          await waiting;
          return db.select(...args).from(from);
        },
      }),
    } as unknown as Tx;
    const work = verify(delayed, saved);
    saved.snapshot.relations.length = 0;
    saved.sha256 = "0".repeat(64);
    release();
    expect(await work).toBe(baseline.sha256);
  });

  it("does not let mutation during a wait replace an approved baseline with existing drift", async () => {
    await rollback(async (tx) => {
      await tx.execute(
        sql.raw("create table public.synthetic_unapproved(id integer)"),
      );
      const changed = await capture(tx);
      const saved = structuredClone(baseline);
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = {
        select: (...args: Parameters<typeof tx.select>) => ({
          from: async (
            from: Parameters<ReturnType<typeof tx.select>["from"]>[0],
          ) => {
            await waiting;
            return tx.select(...args).from(from);
          },
        }),
      } as unknown as Tx;
      const work = verify(delayed, saved);
      Object.assign(saved, changed);
      release();
      await refused(work, "CATALOG_MISMATCH");
    });
  });

  it("projects query failures to a safe code with no provider details", async () => {
    const broken = {
      select() {
        throw new Error("synthetic private DB diagnostic");
      },
    } as unknown as Tx;
    await refused(capture(broken), "READ_FAILED");
    await refused(verify(broken, baseline), "READ_FAILED");
  });

  it.each([
    [
      "non-object snapshot",
      (v: LegacyImportCatalog) => {
        (v as unknown as Record<string, unknown>).snapshot = null;
      },
    ],
    [
      "non-object fact",
      (v: LegacyImportCatalog) => {
        v.snapshot.indexes.push(null as never);
      },
    ],
    [
      "invalid relation identity",
      (v: LegacyImportCatalog) => {
        v.snapshot.relations[0].name = "";
      },
    ],
    [
      "invalid relation kind",
      (v: LegacyImportCatalog) => {
        v.snapshot.relations[0].kind = false as never;
      },
    ],
    [
      "NUL routine source",
      (v: LegacyImportCatalog) => {
        v.snapshot.routines[0].definition = "source\0suffix";
      },
    ],
  ] as const)("refuses %s as an invalid baseline", async (_name, mutate) => {
    const saved = structuredClone(baseline);
    mutate(saved);
    await refused(verify(db, saved), "INVALID_CATALOG");
  });

  it("refuses malformed result cardinality instead of accepting absent or ambiguous catalog evidence", async () => {
    for (const responses of [
      [[]],
      [[{ searchPath: "pg_catalog, public, pg_temp" }], []],
      [
        [{ searchPath: "pg_catalog, public, pg_temp" }],
        [{ snapshot: baseline.snapshot }, { snapshot: baseline.snapshot }],
      ],
    ]) {
      let call = 0;
      const malformed = {
        select: () => ({ from: async () => responses[call++] }),
      } as unknown as Tx;
      await refused(capture(malformed), "INVALID_CATALOG");
    }
  });

  it("refuses excessive function-definition evidence before handing out a baseline", async () => {
    const snapshot = structuredClone(baseline.snapshot);
    snapshot.routines[0].definition = "-".repeat(16 * 1024 * 1024);
    let call = 0;
    const oversized = {
      select: () => ({
        from: async () =>
          ++call === 1
            ? [{ searchPath: "pg_catalog, public, pg_temp" }]
            : [{ snapshot }],
      }),
    } as unknown as Tx;
    await refused(capture(oversized), "INVALID_CATALOG");
  }, 30_000);
});
