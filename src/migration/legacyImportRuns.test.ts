import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { legacyImportRuns as runs } from "../db/schema/legacyImportRuns";

// Deliberately independent of the app schema barrel and migration files.
const harness = await createMemoryPgliteHarness({ schema: { runs } });
const { db, client } = harness;
afterAll(() => client.close());
beforeEach(async () => {
  await db.delete(runs);
});
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
type Insert = typeof runs.$inferInsert;
const hashColumns = [
  "sourceManifestSha256",
  "sourceDescriptorSha256",
  "configurationSha256",
  "schemaSha256",
  "targetSha256",
  "payloadSha256",
  "expectedRowsSha256",
] as const;
const required = [
  "runId",
  "slot",
  "profile",
  ...hashColumns,
  "payload",
  "importedAt",
  "preparedAt",
] as const;
function fixture(): Insert {
  const payload =
    '["synthetic protected checkpoint",{"source":"e\u0301 🌍\\r\\n"}]';
  return {
    runId: "01993000-0000-7000-8000-000000000001",
    slot: 1,
    profile: "magickli-legacy-import-run-v1",
    sourceManifestSha256: "a".repeat(64),
    sourceDescriptorSha256: "b".repeat(64),
    configurationSha256: "c".repeat(64),
    schemaSha256: "d".repeat(64),
    targetSha256: "e".repeat(64),
    payloadSha256: hash(payload),
    expectedRowsSha256: "f".repeat(64),
    payload,
    importedAt: new Date("2026-09-13T10:00:00.123Z"),
    preparedAt: new Date("2026-09-13T11:00:00.456Z"),
    completedAt: null,
    reconciliationSha256: null,
  };
}
async function violation(
  work: PromiseLike<unknown>,
  expectedCode: "23502" | "23505" | "23514",
  constraint?: string,
) {
  let details: { code?: string; constraint?: string } = {};
  try {
    await work;
  } catch (caught) {
    let error = caught;
    for (
      let depth = 0;
      depth < 4 && error && typeof error === "object";
      depth++
    ) {
      if ("code" in error && typeof error.code === "string") {
        details = {
          code: error.code,
          constraint:
            "constraint" in error && typeof error.constraint === "string"
              ? error.constraint
              : undefined,
        };
        break;
      }
      error = "cause" in error ? error.cause : undefined;
    }
  }
  // Assert only fixed PostgreSQL categories; never print stored checkpoint data.
  expect(details.code).toBe(expectedCode);
  if (constraint) expect(details.constraint).toBe(constraint);
}

describe("protected singleton legacy import run schema", () => {
  it("stores a pending checkpoint with exact explicit identity, hashes and millisecond dates", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    expect(await db.select().from(runs)).toEqual([row]);
  });

  it("accepts matching completion at or after preparation without replacing the saved plan", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    await db
      .update(runs)
      .set({
        completedAt: row.preparedAt,
        reconciliationSha256: row.expectedRowsSha256,
      })
      .where(eq(runs.runId, row.runId));
    expect(await db.select().from(runs)).toEqual([
      {
        ...row,
        completedAt: row.preparedAt,
        reconciliationSha256: row.expectedRowsSha256,
      },
    ]);
    const completedAt = new Date(row.preparedAt.getTime() + 1);
    await db.update(runs).set({ completedAt });
    expect((await db.select().from(runs))[0].completedAt).toEqual(completedAt);
  });

  it("allows a direct completed insert only with the complete matching evidence", async () => {
    const row = fixture();
    row.completedAt = new Date(row.preparedAt.getTime() + 1000);
    row.reconciliationSha256 = row.expectedRowsSha256;
    await db.insert(runs).values(row);
    expect(await db.select().from(runs)).toEqual([row]);
  });

  it("rejects a competing run even when its UUID, target and payload differ", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    const second = {
      ...row,
      runId: "01993000-0000-7000-8000-000000000002",
      targetSha256: "1".repeat(64),
      payload: "different synthetic checkpoint",
      payloadSha256: hash("different synthetic checkpoint"),
    };
    await violation(
      db.insert(runs).values(second),
      "23505",
      "legacy_import_runs_slot_unique",
    );
    expect(await db.select().from(runs)).toEqual([row]);
  });

  it("rejects a duplicate primary run identity", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    await violation(db.insert(runs).values(row), "23505");
    expect(await db.select().from(runs)).toHaveLength(1);
  });

  it.each([0, 2, -1])("rejects singleton slot %s", async (slot) => {
    await violation(
      db.insert(runs).values({ ...fixture(), slot }),
      "23514",
      "legacy_import_runs_singleton",
    );
  });

  it.each([
    "01993000-0000-4000-8000-000000000001",
    "01993000-0000-7000-7000-000000000001",
    "01993000-0000-7000-c000-000000000001",
  ])("rejects invalid UUID version/variant %s", async (runId) => {
    await violation(
      db.insert(runs).values({ ...fixture(), runId }),
      "23514",
      "legacy_import_runs_id_v7",
    );
  });

  it("rejects an unrecognized run profile", async () => {
    await violation(
      db.insert(runs).values({ ...fixture(), profile: "unknown" as never }),
      "23514",
      "legacy_import_runs_profile",
    );
  });

  it.each(hashColumns)("requires canonical lower-case %s", async (key) => {
    for (const value of [
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
    ]) {
      const row = { ...fixture(), [key]: value };
      await violation(db.insert(runs).values(row), "23514");
      expect(await db.select({ id: runs.runId }).from(runs)).toEqual([]);
    }
  });

  it.each(required)("has no fallback/default for omitted %s", async (key) => {
    const row: Partial<Insert> = fixture();
    delete row[key];
    await violation(db.insert(runs).values(row as Insert), "23502");
  });

  it("has no database/runtime defaults, identity generation or domain foreign keys", async () => {
    const columns = Object.values(getTableColumns(runs));
    expect(
      columns.every((c) => !c.hasDefault && !c.defaultFn && !c.onUpdateFn),
    ).toBe(true);
    expect(getTableConfig(runs).foreignKeys).toEqual([]);
    const result = await client.query<{
      column_name: string;
      column_default: string | null;
      is_identity: string;
    }>(
      "select column_name, column_default, is_identity from information_schema.columns where table_schema = 'public' and table_name = 'legacy_import_runs' order by ordinal_position",
    );
    expect(result.rows).toHaveLength(columns.length);
    expect(
      result.rows.every(
        (c) => c.column_default === null && c.is_identity === "NO",
      ),
    ).toBe(true);
    const foreignKeys = await client.query(
      "select conname from pg_constraint where conrelid = 'public.legacy_import_runs'::regclass and contype = 'f'",
    );
    expect(foreignKeys.rows).toEqual([]);
  });

  it("preserves exact BOM, CRLF, Unicode and JSON-looking payload bytes", async () => {
    const row = fixture();
    row.payload = '\uFEFF["e\u0301 🌍"]\r\n';
    row.payloadSha256 = hash(row.payload);
    await db.insert(runs).values(row);
    const [stored] = await db
      .select({
        // PGlite's plain text decoder consumes a leading BOM; JSON decoding does not.
        payload: sql<string>`to_json(${runs.payload})`,
        sha256: sql<string>`encode(sha256(convert_to(${runs.payload}, 'UTF8')), 'hex')`,
        hex: sql<string>`encode(convert_to(${runs.payload}, 'UTF8'), 'hex')`,
      })
      .from(runs);
    expect(stored.payload).toBe(row.payload);
    expect(stored.sha256).toBe(row.payloadSha256);
    expect(stored.hex).toBe(Buffer.from(row.payload, "utf8").toString("hex"));
  });

  it("rejects changed protected payload bytes without the exact matching hash", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    await violation(
      db.update(runs).set({ payload: `${row.payload} ` }),
      "23514",
      "legacy_import_runs_payload_hash",
    );
    await violation(
      db.update(runs).set({ payloadSha256: "0".repeat(64) }),
      "23514",
      "legacy_import_runs_payload_hash",
    );
    expect(await db.select().from(runs)).toEqual([row]);
  });

  it("enforces a positive payload byte count independently of codec shape", async () => {
    await violation(
      db
        .insert(runs)
        .values({ ...fixture(), payload: "", payloadSha256: hash("") }),
      "23514",
      "legacy_import_runs_payload_bytes",
    );
    const row = { ...fixture(), payload: "x", payloadSha256: hash("x") };
    await db.insert(runs).values(row);
    expect(
      (await db.select({ payload: runs.payload }).from(runs))[0].payload,
    ).toBe("x");
  });

  it("bounds UTF-8 bytes rather than character count at 64 MiB", async () => {
    // 33,554,433 characters fit below the character limit but exceed 64 MiB.
    // Construct only inside the isolated database, without a second JS copy.
    await violation(
      db.insert(runs).values({
        ...fixture(),
        payload: sql<string>`repeat('é', 33554433)`,
      }),
      "23514",
      "legacy_import_runs_payload_bytes",
    );
    expect(await db.select({ id: runs.runId }).from(runs)).toEqual([]);
  }, 30_000);

  it.each([
    [
      "completion time only",
      (r: Insert) => {
        r.completedAt = r.preparedAt;
      },
    ],
    [
      "reconciliation only",
      (r: Insert) => {
        r.reconciliationSha256 = r.expectedRowsSha256;
      },
    ],
    [
      "different reconciliation",
      (r: Insert) => {
        r.completedAt = r.preparedAt;
        r.reconciliationSha256 = "0".repeat(64);
      },
    ],
    [
      "noncanonical reconciliation",
      (r: Insert) => {
        r.completedAt = r.preparedAt;
        r.reconciliationSha256 = r.expectedRowsSha256.toUpperCase();
      },
    ],
    [
      "completion before preparation",
      (r: Insert) => {
        r.completedAt = new Date(r.preparedAt.getTime() - 1);
        r.reconciliationSha256 = r.expectedRowsSha256;
      },
    ],
  ] as const)("rejects %s", async (_name, mutate) => {
    const row = fixture();
    mutate(row);
    await violation(
      db.insert(runs).values(row),
      "23514",
      "legacy_import_runs_completion",
    );
  });

  it("keeps the prior pending checkpoint when a completion transaction rolls back", async () => {
    const row = fixture();
    await db.insert(runs).values(row);
    await expect(
      db.transaction(async (tx) => {
        await tx.update(runs).set({
          completedAt: row.preparedAt,
          reconciliationSha256: row.expectedRowsSha256,
        });
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    expect(await db.select().from(runs)).toEqual([row]);
  });

  it.each([
    ["imported_at", "infinity"],
    ["imported_at", "-infinity"],
    ["prepared_at", "infinity"],
    ["prepared_at", "-infinity"],
    ["completed_at", "infinity"],
    ["completed_at", "-infinity"],
  ] as const)(
    "refuses raw SQL %s=%s beyond the Date codec range",
    async (column, value) => {
      const row = fixture();
      await db.insert(runs).values(row);
      const statement =
        column === "completed_at"
          ? `update legacy_import_runs set completed_at = $1::timestamptz, reconciliation_sha256 = expected_rows_sha256`
          : `update legacy_import_runs set ${column} = $1::timestamptz`;
      await violation(
        client.query(statement, [value]),
        "23514",
        // A past infinite completion also independently violates the ordering rule.
        column === "completed_at" && value === "-infinity"
          ? "legacy_import_runs_completion"
          : "legacy_import_runs_finite_timestamps",
      );
      expect(await db.select().from(runs)).toEqual([row]);
    },
  );
});
