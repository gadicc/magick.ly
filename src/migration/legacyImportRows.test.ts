import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { legacyImportFixture } from "../../tests/legacyImportFixtures";
import * as schema from "../db/schema";
import {
  fingerprintLegacyImportRows,
  LEGACY_IMPORT_TABLES,
  type LegacyImportRows,
  LegacyImportRowsError,
  projectLegacyImportRows,
  reconcileLegacyImportRows,
} from "./legacyImportRows";
import { prepareLegacyImport } from "./prepareLegacyImport";

const harness = await createMemoryPgliteHarness({ schema });
const { db, client } = harness;
afterAll(() => client.close());
let expected: LegacyImportRows;
beforeEach(async () => {
  await client.exec(
    `truncate ${Object.keys(LEGACY_IMPORT_TABLES)
      .map((name) => `"${name}"`)
      .join(",")} cascade`,
  );
  await client.exec("set time zone 'UTC'");
  const fixture = legacyImportFixture();
  expected = projectLegacyImportRows(
    prepareLegacyImport(fixture.input, fixture.options),
  );
  await db.transaction(async (tx) => {
    for (const [name, definition] of Object.entries(LEGACY_IMPORT_TABLES)) {
      const table: PgTable = definition;
      const rows = expected[name as keyof LegacyImportRows];
      if (rows.length)
        await tx
          .insert(table)
          .values(
            name === "rituals"
              ? rows.map((row) => ({ ...row, currentRevisionId: null }))
              : rows,
          );
    }
    for (const row of expected.rituals)
      await tx
        .update(schema.rituals)
        .set({ currentRevisionId: row.currentRevisionId as string })
        .where(eq(schema.rituals.id, row.id as string));
  });
});
async function mismatch() {
  await expect(reconcileLegacyImportRows(db, expected)).rejects.toMatchObject({
    name: "LegacyImportRowsError",
    code: "TARGET_MISMATCH",
  });
}
describe("complete SQL import reconciliation", () => {
  it("compares the complete populated and deliberately empty database to precomputed rows", async () => {
    const receipt = fingerprintLegacyImportRows(expected);
    expect(await reconcileLegacyImportRows(db, expected)).toEqual(receipt);
    expect(receipt.counts.auth_user).toBe(2);
    expect(receipt.counts.auth_session).toBe(0);
    expect(receipt.counts.discourse_user_links).toBe(1);
    expect(receipt.counts.rituals).toBe(3);
  });
  it("preserves naive timestamp wall time and timestamptz instants under a non-UTC session", async () => {
    await client.exec("set time zone 'Pacific/Auckland'");
    expect(await reconcileLegacyImportRows(db, expected)).toEqual(
      fingerprintLegacyImportRows(expected),
    );
  });
  it("does not let the driver's BOM text decoding hide a leading character", async () => {
    const row = expected.loom_files[0];
    expect(row.originalFilename).toMatch(/^\uFEFF/);
    await db.update(schema.loomFilesTable).set({
      originalFilename: (row.originalFilename as string).slice(1),
      updatedAt: row.updatedAt as Date,
    });
    await mismatch();
  });
  it.each(["é", "e\u0301", "\r\n", "\n", "\uFEFF"])(
    "compares exact text bytes for %j",
    async (suffix) => {
      await client.query(
        "update auth_user set name = name || $1 where id = $2",
        [suffix, expected.auth_user[0].id],
      );
      await mismatch();
    },
  );
  it.each(["auth_user", "loom_files"])(
    "detects a single microsecond in %s without rounding it through JavaScript",
    async (table) => {
      await client.exec(
        `update ${table} set updated_at = updated_at + interval '0.000001 seconds'`,
      );
      await mismatch();
    },
  );
  it("compares JSONB numbers in PostgreSQL without silently rounding an altered decimal", async () => {
    await client.exec(
      `update loom_files set image_meta = jsonb_set(image_meta, '{width}', '8.000000000000000000001'::jsonb)`,
    );
    await mismatch();
  });
  it("distinguishes a SQL NULL from a JSON null in nullable metadata", async () => {
    expect(expected.loom_files[0].audioMeta).toBeNull();
    await client.exec("update loom_files set audio_meta = 'null'::jsonb");
    await mismatch();
  });
  it("ignores JSONB key order but preserves every value and array position", async () => {
    expected.loom_files[0].meta = { z: [1, 2], a: { second: 2, first: 1 } };
    await client.exec(
      `update loom_files set meta = '{"a":{"first":1,"second":2},"z":[1,2]}'::jsonb`,
    );
    await expect(reconcileLegacyImportRows(db, expected)).resolves.toEqual(
      fingerprintLegacyImportRows(expected),
    );
    await client.exec(
      `update loom_files set meta = jsonb_set(meta, '{z}', '[2,1]'::jsonb)`,
    );
    await mismatch();
  });
  it("detects a missing row instead of adopting the remaining rows", async () => {
    await db.delete(schema.discourseUserLinks);
    await mismatch();
  });
  it("detects an extra row even when all expected primary keys still exist", async () => {
    await db.insert(schema.user).values({
      ...expected.auth_user[0],
      id: "01993000-0000-7000-8000-000000000fff",
      name: "Extra",
      email: "extra@example.test",
    } as typeof schema.user.$inferInsert);
    await mismatch();
  });
  it("refuses an old session in a table expected to be empty", async () => {
    await db.insert(schema.session).values({
      id: "01993000-0000-7000-8000-000000000fff",
      userId: expected.auth_user[0].id as string,
      token: "synthetic-session",
      expiresAt: new Date("2027-01-01"),
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
    await mismatch();
  });
  it("refuses study review receipts created before the legacy import checkpoint", async () => {
    const progress = expected.study_progress[0];
    await db.insert(schema.studyReviewReceipts).values({
      eventId: "01993000-0000-7000-8000-000000000fff",
      actorId: progress.userId as string,
      requestHash: "a".repeat(64),
      progressId: progress.id as string,
      acceptedVersion: 1,
      acceptedAt: new Date("2026-01-01"),
    });
    await mismatch();
  });
  it("does not accept duplicate expected rows as a matching set", async () => {
    expected.auth_user.push({ ...expected.auth_user[0] });
    await mismatch();
  });
  it("does not renew the expected state through a caller mutation during the first await", async () => {
    const receipt = fingerprintLegacyImportRows(expected);
    const original = db.select.bind(db);
    let first = true;
    const tx = {
      select: ((...args: Parameters<typeof db.select>) => {
        if (first) {
          first = false;
          expected.auth_user[0].name = "Changed while waiting";
        }
        return original(...args);
      }) as typeof db.select,
    };
    expect(await reconcileLegacyImportRows(tx, expected)).toEqual(receipt);
  });
  it("returns only a fixed category for a database failure", async () => {
    const tx = {
      select: (() => {
        throw new Error("synthetic private database diagnostic");
      }) as typeof db.select,
    };
    await expect(reconcileLegacyImportRows(tx, expected)).rejects.toEqual(
      new LegacyImportRowsError("READ_FAILED"),
    );
  });
  it("refuses incomplete expected data before executing a query", async () => {
    delete expected.auth_user[0].createdAt;
    const tx = {
      select: (() => {
        throw new Error("must not query");
      }) as typeof db.select,
    };
    await expect(reconcileLegacyImportRows(tx, expected)).rejects.toEqual(
      new LegacyImportRowsError("INVALID_ROWS"),
    );
  });
  it("does not write while reconciling", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction read only`);
      expect(await reconcileLegacyImportRows(tx, expected)).toEqual(
        fingerprintLegacyImportRows(expected),
      );
    });
  });
});
