import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
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
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import * as schema from "../db/schema";
import { captureLegacyImportCatalog } from "./legacyImportCatalog";
import { createLegacyImportCheckpoint } from "./legacyImportCheckpoint";
import { createLegacyImportMigrationManifest } from "./legacyImportMigrations";
import { LEGACY_IMPORT_TABLES } from "./legacyImportRows";
import { prepareLegacyImport } from "./prepareLegacyImport";
import {
  createSqlLegacyImporter,
  legacyImportSchemaIdentity,
  type SqlLegacyImportContract,
  type SqlLegacyImportDatabase,
  SqlLegacyImportError,
} from "./sqlLegacyImport";

const harness = await createMemoryPgliteHarness({ schema });
const { db, client } = harness;
afterAll(() => client.close());
afterEach(() => vi.restoreAllMocks());
await client.exec(
  "set search_path = pg_catalog, public, pg_temp; create schema if not exists drizzle; create table if not exists drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint)",
);
const migrations = createLegacyImportMigrationManifest(
  readMigrationFiles({ migrationsFolder: "drizzle" }),
);
for (const entry of migrations.entries)
  await client.query(
    "insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)",
    [entry.sha256, entry.createdAt],
  );
const catalog = await captureLegacyImportCatalog(db);
const target = (
  await client.query<{ database: string; role: string }>(
    "select current_database() as database, current_user as role",
  )
).rows[0];
const contract: SqlLegacyImportContract = {
  database: target.database,
  role: target.role,
  migrations,
  catalog,
  binding: {
    runId: "01993000-0000-7000-8000-eeeeeeeeeeee",
    sourceManifestSha256: "a".repeat(64),
    sourceDescriptorSha256: "b".repeat(64),
    targetSha256: "c".repeat(64),
    schemaSha256: legacyImportSchemaIdentity(migrations, catalog),
  },
};
function fixture() {
  const source = legacyImportFixture();
  const prepared = prepareLegacyImport(source.input, source.options);
  return {
    prepared,
    checkpoint: createLegacyImportCheckpoint(prepared, contract.binding),
    service: createSqlLegacyImporter(db, contract),
  };
}
beforeEach(async () => {
  await client.exec(
    `truncate public.legacy_import_runs, ${Object.keys(LEGACY_IMPORT_TABLES)
      .map((name) => `public."${name}"`)
      .join(",")} cascade`,
  );
});
async function refused(work: Promise<unknown>, code: string) {
  await expect(work).rejects.toEqual(
    new SqlLegacyImportError(code as SqlLegacyImportError["code"]),
  );
}
async function count(table: string) {
  return Number(
    (
      await client.query<{ count: string }>(
        `select count(*)::text as count from public."${table}"`,
      )
    ).rows[0].count,
  );
}
describe("fenced atomic legacy import", () => {
  it("keeps temporary tables from shadowing durable checkpoints and imported rows", async () => {
    await client.exec(
      "create temp table legacy_import_runs (like public.legacy_import_runs including all); create temp table auth_user (like public.auth_user including all)",
    );
    try {
      const { service, checkpoint } = fixture();
      const pending = await service.prepare(checkpoint);
      expect(pending.state).toBe("prepared");
      expect(await count("legacy_import_runs")).toBe(1);
      const complete = await service.apply(checkpoint.payloadSha256);
      expect(complete.state).toBe("completed");
      expect(await count("auth_user")).toBe(2);
      expect(await service.inspect()).toEqual(complete);
      for (const name of ["legacy_import_runs", "auth_user"])
        expect(
          (
            await client.query<{ count: number }>(
              `select count(*)::integer as count from pg_temp."${name}"`,
            )
          ).rows[0].count,
        ).toBe(0);
    } finally {
      await client.exec(
        "drop table pg_temp.legacy_import_runs, pg_temp.auth_user",
      );
    }
  });
  it("prepares only a stable checkpoint, atomically applies complete rows, and retries unchanged", async () => {
    const { service, checkpoint } = fixture();
    expect(await service.inspect()).toBeNull();
    const pending = await service.prepare(checkpoint);
    expect(pending.state).toBe("prepared");
    expect(await count("legacy_import_runs")).toBe(1);
    for (const name of Object.keys(LEGACY_IMPORT_TABLES))
      expect(await count(name)).toBe(0);
    expect(await service.prepare(checkpoint)).toEqual(pending);
    const complete = await service.apply(checkpoint.payloadSha256);
    expect(complete.state).toBe("completed");
    expect(complete.preparedAt).toEqual(pending.preparedAt);
    expect(complete.completedAt!.getTime()).toBeGreaterThanOrEqual(
      pending.preparedAt.getTime(),
    );
    for (const [name, total] of Object.entries(complete.counts))
      expect(await count(name)).toBe(total);
    expect(await service.inspect()).toEqual(complete);
    expect(await service.prepare(checkpoint)).toEqual(complete);
    expect(await service.apply(checkpoint.payloadSha256)).toEqual(complete);
    const saved = (await db.select().from(schema.legacyImportRuns))[0];
    expect(saved.payload).toBe(checkpoint.payload);
    expect(JSON.stringify(complete)).not.toContain(importSecret);
    expect(JSON.stringify(complete)).not.toContain('payload"');
  });
  it("refuses apply without durable preparation", async () => {
    const { service, checkpoint } = fixture();
    await refused(service.apply(checkpoint.payloadSha256), "MISSING_RUN");
  });
  it("refuses another run claiming the reserved singleton", async () => {
    const { service, checkpoint, prepared } = fixture();
    await service.prepare(checkpoint);
    const other = structuredClone(contract);
    other.binding.runId = "01993000-0000-7000-8000-eeeeeeeeeeef";
    const competitor = createSqlLegacyImporter(db, other);
    await refused(
      competitor.prepare(createLegacyImportCheckpoint(prepared, other.binding)),
      "RUN_CONFLICT",
    );
    expect(await count("legacy_import_runs")).toBe(1);
    expect(await count("auth_user")).toBe(0);
  });
  it("refuses changed source/options for an existing run", async () => {
    const { service, checkpoint, prepared } = fixture();
    await service.prepare(checkpoint);
    prepared.auth.users[0].name = "Changed prepared value";
    await refused(
      service.prepare(createLegacyImportCheckpoint(prepared, contract.binding)),
      "RUN_CONFLICT",
    );
    await refused(service.apply("f".repeat(64)), "RUN_CONFLICT");
  });
  it("refuses data written between prepare and apply without overwriting it", async () => {
    const { service, checkpoint } = fixture();
    await service.prepare(checkpoint);
    await db.insert(schema.user).values({
      id: "01993000-0000-7000-8000-000000000fff",
      name: "Existing",
      email: "existing@example.test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await refused(service.apply(checkpoint.payloadSha256), "TARGET_CHANGED");
    expect(await count("auth_user")).toBe(1);
    expect(
      (await db.select().from(schema.legacyImportRuns))[0].completedAt,
    ).toBeNull();
  });
  it("refuses a nonempty target during initial preparation", async () => {
    const { service, checkpoint } = fixture();
    await db.insert(schema.verification).values({
      id: "01993000-0000-7000-8000-000000000fff",
      identifier: "existing",
      value: "existing",
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await refused(service.prepare(checkpoint), "TARGET_CHANGED");
    expect(await count("legacy_import_runs")).toBe(0);
  });
  it("rolls back all application rows after a late foreign-key failure and preserves preparation", async () => {
    const { service, prepared } = fixture();
    prepared.discourse.links[0].userId = "01993000-0000-7000-8000-000000000fff";
    const checkpoint = createLegacyImportCheckpoint(prepared, contract.binding);
    await service.prepare(checkpoint);
    await refused(service.apply(checkpoint.payloadSha256), "IMPORT_FAILED");
    for (const name of Object.keys(LEGACY_IMPORT_TABLES))
      expect(await count(name)).toBe(0);
    expect((await service.inspect())!.state).toBe("prepared");
  });
  it("reports a lost commit acknowledgement and resumes the same completed run", async () => {
    const { service, checkpoint } = fixture();
    await service.prepare(checkpoint);
    const uncertain: SqlLegacyImportDatabase = {
      transaction: async (work, options) => {
        await db.transaction(work, options);
        throw new Error("synthetic lost acknowledgement");
      },
    };
    await refused(
      createSqlLegacyImporter(uncertain, contract).apply(
        checkpoint.payloadSha256,
      ),
      "OUTCOME_UNKNOWN",
    );
    expect((await service.apply(checkpoint.payloadSha256)).state).toBe(
      "completed",
    );
    expect(await count("auth_user")).toBe(2);
  });
  it("does not recreate a deleted row after completion", async () => {
    const { service, checkpoint } = fixture();
    await service.prepare(checkpoint);
    await service.apply(checkpoint.payloadSha256);
    await db.delete(schema.discourseUserLinks);
    await refused(service.apply(checkpoint.payloadSha256), "TARGET_CHANGED");
    expect(await count("discourse_user_links")).toBe(0);
  });
  it.each(["imported_at", "prepared_at", "completed_at"])(
    "does not round a changed %s header back into a valid checkpoint",
    async (column) => {
      const { service, checkpoint } = fixture();
      await service.prepare(checkpoint);
      await service.apply(checkpoint.payloadSha256);
      await client.exec(
        `update public.legacy_import_runs set ${column}=${column}+interval '0.000001 second'`,
      );
      await refused(service.inspect(), "INCONSISTENT_RUN");
    },
  );
  it("refuses stale migration history before reserving any run", async () => {
    const { service, checkpoint } = fixture();
    const rollback = new Error("rollback synthetic journal");
    const txdb: SqlLegacyImportDatabase = {
      transaction: async (work, options) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`update drizzle.__drizzle_migrations set hash=repeat('f',64) where created_at=(select min(created_at) from drizzle.__drizzle_migrations)`,
          );
          try {
            await work(tx);
          } catch (error) {
            expect((error as SqlLegacyImportError).code).toBe("FENCE_FAILED");
            throw rollback;
          }
          throw new Error("accepted changed journal");
        }, options),
    };
    await refused(
      createSqlLegacyImporter(txdb, contract).prepare(checkpoint),
      "IMPORT_FAILED",
    );
    expect(await count("legacy_import_runs")).toBe(0);
    expect(await service.inspect()).toBeNull();
  });
  it("compares the selected database and role independently of caller hash labels", async () => {
    const { checkpoint } = fixture();
    for (const property of ["database", "role"] as const) {
      const wrong = structuredClone(contract);
      wrong[property] = "other";
      await refused(
        createSqlLegacyImporter(db, wrong).prepare(checkpoint),
        "FENCE_FAILED",
      );
    }
  });
  it("rejects header divergence even when the saved payload is intact", async () => {
    const { service, checkpoint } = fixture();
    await service.prepare(checkpoint);
    await db
      .update(schema.legacyImportRuns)
      .set({ expectedRowsSha256: "f".repeat(64) })
      .where(eq(schema.legacyImportRuns.slot, 1));
    await refused(service.apply(checkpoint.payloadSha256), "INCONSISTENT_RUN");
  });
  it("resumes preparation after a lost acknowledgement without allocating new rows", async () => {
    const { service, checkpoint } = fixture();
    const uncertain: SqlLegacyImportDatabase = {
      transaction: async (work, options) => {
        await db.transaction(work, options);
        throw new Error("lost prepare acknowledgement");
      },
    };
    await refused(
      createSqlLegacyImporter(uncertain, contract).prepare(checkpoint),
      "OUTCOME_UNKNOWN",
    );
    expect((await service.prepare(checkpoint)).state).toBe("prepared");
    expect(await count("legacy_import_runs")).toBe(1);
    expect(await count("auth_user")).toBe(0);
  });
  it("copies the trusted contract before the caller changes it", async () => {
    const { checkpoint } = fixture();
    const input = structuredClone(contract),
      service = createSqlLegacyImporter(db, input);
    input.database = "different";
    input.binding.targetSha256 = "f".repeat(64);
    input.catalog.snapshot.relations.length = 0;
    expect((await service.prepare(checkpoint)).state).toBe("prepared");
  });
  it("copies the prepared payload before awaiting the database", async () => {
    const { service, checkpoint } = fixture();
    const original = checkpoint.payloadSha256;
    const work = service.prepare(checkpoint);
    checkpoint.payload = "changed after invocation";
    checkpoint.payloadSha256 = "f".repeat(64);
    expect((await work).payloadSha256).toBe(original);
  });
  it.each([
    "sourceManifestSha256",
    "sourceDescriptorSha256",
    "schemaSha256",
    "targetSha256",
  ] as const)("refuses a changed saved %s binding", async (key) => {
    const { service, checkpoint } = fixture();
    await service.prepare(checkpoint);
    await db.update(schema.legacyImportRuns).set({ [key]: "f".repeat(64) });
    await refused(service.inspect(), "RUN_CONFLICT");
  });
  it.each(["payload", "configurationSha256", "importedAt"] as const)(
    "refuses internally inconsistent %s evidence",
    async (key) => {
      const { service, checkpoint } = fixture();
      await service.prepare(checkpoint);
      if (key === "payload") {
        const payload = '["invalid saved codec profile"]';
        await db.update(schema.legacyImportRuns).set({
          payload,
          payloadSha256: createHash("sha256").update(payload).digest("hex"),
        });
      } else if (key === "configurationSha256")
        await db
          .update(schema.legacyImportRuns)
          .set({ configurationSha256: "f".repeat(64) });
      else
        await db
          .update(schema.legacyImportRuns)
          .set({ importedAt: new Date("2000-01-01T00:00:00Z") });
      await refused(service.inspect(), "INCONSISTENT_RUN");
    },
  );
  it.each(["", "F".repeat(64), "a".repeat(63)])(
    "refuses invalid apply digest %j",
    async (value) => {
      await refused(fixture().service.apply(value), "INVALID_IMPORT");
    },
  );
  it("refuses an invalid checkpoint before any database access", async () => {
    const broken: SqlLegacyImportDatabase = {
      transaction: async () => {
        throw new Error("must not query");
      },
    };
    const { checkpoint } = fixture();
    checkpoint.payload = "changed";
    await refused(
      createSqlLegacyImporter(broken, contract).prepare(checkpoint),
      "INVALID_IMPORT",
    );
  });
  it("maps an early connection failure without exposing its diagnostic", async () => {
    const broken: SqlLegacyImportDatabase = {
      transaction: async () => {
        throw new Error("private database host and role");
      },
    };
    await refused(
      createSqlLegacyImporter(broken, contract).inspect(),
      "IMPORT_FAILED",
    );
  });
  it("stops an elapsed operation before taking database locks", async () => {
    const { service } = fixture();
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(30_001);
    await refused(service.inspect(), "DEADLINE_EXCEEDED");
  });
  it.each([
    ["null contract", () => null],
    [
      "extra contract property",
      (v: SqlLegacyImportContract) => ({ ...v, extra: "private" }),
    ],
    [
      "missing role",
      (v: SqlLegacyImportContract) => {
        delete (v as Partial<SqlLegacyImportContract>).role;
        return v;
      },
    ],
    [
      "extra binding property",
      (v: SqlLegacyImportContract) => ({
        ...v,
        binding: { ...v.binding, extra: "private" },
      }),
    ],
    [
      "invalid run ID",
      (v: SqlLegacyImportContract) => {
        v.binding.runId = "bad";
        return v;
      },
    ],
    [
      "uppercase run ID",
      (v: SqlLegacyImportContract) => {
        v.binding.runId = v.binding.runId.toUpperCase();
        return v;
      },
    ],
    [
      "invalid source hash",
      (v: SqlLegacyImportContract) => {
        v.binding.sourceManifestSha256 = "bad";
        return v;
      },
    ],
    [
      "schema identity drift",
      (v: SqlLegacyImportContract) => {
        v.binding.schemaSha256 = "f".repeat(64);
        return v;
      },
    ],
    [
      "invalid catalog hash",
      (v: SqlLegacyImportContract) => {
        v.catalog.sha256 = "bad";
        return v;
      },
    ],
    [
      "invalid migration hash",
      (v: SqlLegacyImportContract) => {
        v.migrations.sha256 = "bad";
        return v;
      },
    ],
    [
      "empty role",
      (v: SqlLegacyImportContract) => {
        v.role = "";
        return v;
      },
    ],
    [
      "overlong database",
      (v: SqlLegacyImportContract) => {
        v.database = "a".repeat(64);
        return v;
      },
    ],
    [
      "NUL role",
      (v: SqlLegacyImportContract) => {
        v.role = "a\0b";
        return v;
      },
    ],
    [
      "missing application table",
      (v: SqlLegacyImportContract) => {
        v.catalog.snapshot.relations = v.catalog.snapshot.relations.filter(
          (r) => r.name !== "auth_user",
        );
        return v;
      },
    ],
    [
      "extra application table",
      (v: SqlLegacyImportContract) => {
        v.catalog.snapshot.relations.push({ name: "unexpected", kind: "r" });
        return v;
      },
    ],
    [
      "invalid relation name",
      (v: SqlLegacyImportContract) => {
        v.catalog.snapshot.relations[0].name = 1 as unknown as string;
        return v;
      },
    ],
  ])("rejects %s constructor state", (_name, change) => {
    expect(() =>
      createSqlLegacyImporter(
        db,
        change(structuredClone(contract)) as SqlLegacyImportContract,
      ),
    ).toThrow(new SqlLegacyImportError("INVALID_IMPORT"));
  });
});
