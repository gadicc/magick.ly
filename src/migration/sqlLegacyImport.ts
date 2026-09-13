import { createHash } from "node:crypto";
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTable,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { legacyImportRuns } from "../db/schema/legacyImportRuns";
import { rituals } from "../db/schema/rituals";
import { isUuidV7 } from "../lib/ids";
import {
  type LegacyImportCatalog,
  verifyLegacyImportCatalog,
} from "./legacyImportCatalog";
import {
  type LegacyImportBinding,
  type LegacyImportCheckpoint,
  readLegacyImportCheckpoint,
} from "./legacyImportCheckpoint";
import {
  type LegacyImportMigrationManifest,
  verifyLegacyImportMigrations,
} from "./legacyImportMigrations";
import {
  fingerprintLegacyImportRows,
  LEGACY_IMPORT_TABLES,
  type LegacyImportRowReceipt,
  type LegacyImportRows,
  projectLegacyImportRows,
  reconcileLegacyImportRows,
} from "./legacyImportRows";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";

type Tx = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "execute"
>;
/** Transaction-capable connection already bound to its destination by the trusted launcher. */
export interface SqlLegacyImportDatabase {
  transaction<T>(
    work: (tx: Tx) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}
/**
 * A maintenance contract, never an HTTP request. Database/role checks cannot
 * establish Neon branch identity; the launcher must verify the selected URL and
 * provider project/branch/endpoint binding before handing this connection over.
 */
export interface SqlLegacyImportContract {
  binding: LegacyImportBinding;
  database: string;
  role: string;
  migrations: LegacyImportMigrationManifest;
  catalog: LegacyImportCatalog;
}
/** Safe receipt only. The saved private payload is never returned from this service. */
export interface SqlLegacyImportReceipt extends LegacyImportBinding {
  payloadSha256: string;
  configurationSha256: string;
  expectedRowsSha256: string;
  state: "prepared" | "completed";
  preparedAt: Date;
  completedAt: Date | null;
  counts: LegacyImportRowReceipt["counts"];
}
type Code =
  | "INVALID_IMPORT"
  | "FENCE_FAILED"
  | "RUN_CONFLICT"
  | "MISSING_RUN"
  | "TARGET_CHANGED"
  | "INCONSISTENT_RUN"
  | "DEADLINE_EXCEEDED"
  | "IMPORT_FAILED"
  | "OUTCOME_UNKNOWN";
export class SqlLegacyImportError extends Error {
  constructor(public readonly code: Code) {
    super(code);
    this.name = "SqlLegacyImportError";
  }
}
function fail(code: Code): never {
  throw new SqlLegacyImportError(code);
}
function copy<T>(value: T): T {
  try {
    return parseLegacyImportValue(serializeLegacyImportValue(value)) as T;
  } catch {
    return fail("INVALID_IMPORT");
  }
}
function fields(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("INVALID_IMPORT");
}
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const names = Object.keys(LEGACY_IMPORT_TABLES) as (keyof LegacyImportRows)[];
const principalOrder = [
  "auth_user",
  "user_access",
  "user_group_grants",
  "temple_memberships",
];
const lockNames = [
  ...principalOrder,
  ...names.filter((name) => !principalOrder.includes(name)),
];
type Saved = typeof legacyImportRuns.$inferSelect;

/** Identity of the reviewed migration and engine-specific catalog baseline. */
export function legacyImportSchemaIdentity(
  migrations: LegacyImportMigrationManifest,
  catalog: LegacyImportCatalog,
) {
  if (
    !migrations ||
    !catalog ||
    !digest(migrations.sha256) ||
    !digest(catalog.sha256)
  )
    fail("INVALID_IMPORT");
  return createHash("sha256")
    .update(
      serializeLegacyImportValue({
        profile: "magickli-import-schema-v1",
        migrations: migrations.sha256,
        catalog: catalog.sha256,
      }),
    )
    .digest("hex");
}

/** Prepare once, then atomically apply only saved rows; no repair/reset/upsert API. */
export function createSqlLegacyImporter(
  db: SqlLegacyImportDatabase,
  contract: SqlLegacyImportContract,
) {
  const expected = copy(contract);
  fields(expected, ["binding", "database", "role", "migrations", "catalog"]);
  const binding = expected.binding;
  fields(binding, [
    "runId",
    "sourceManifestSha256",
    "sourceDescriptorSha256",
    "schemaSha256",
    "targetSha256",
  ]);
  if (
    !binding ||
    !isUuidV7(binding.runId) ||
    binding.runId !== binding.runId.toLowerCase() ||
    ![
      binding.sourceManifestSha256,
      binding.sourceDescriptorSha256,
      binding.schemaSha256,
      binding.targetSha256,
    ].every(digest) ||
    binding.schemaSha256 !==
      legacyImportSchemaIdentity(expected.migrations, expected.catalog) ||
    [expected.database, expected.role].some(
      (value) =>
        typeof value !== "string" ||
        !value.length ||
        value.includes("\0") ||
        Buffer.byteLength(value) > 63,
    )
  )
    fail("INVALID_IMPORT");
  const relations = expected.catalog.snapshot?.relations;
  if (
    !Array.isArray(relations) ||
    relations.some(
      (relation) =>
        !relation ||
        typeof relation.name !== "string" ||
        typeof relation.kind !== "string",
    )
  )
    fail("INVALID_IMPORT");
  const ordinary = relations
    .filter((relation) => relation.kind === "r")
    .map((relation) => relation.name)
    .sort();
  if (
    JSON.stringify(ordinary) !==
    JSON.stringify([...names, "legacy_import_runs"].sort())
  )
    fail("INVALID_IMPORT");

  async function catalogFence(tx: Tx) {
    try {
      await verifyLegacyImportMigrations(tx, expected.migrations);
      await verifyLegacyImportCatalog(tx, expected.catalog);
    } catch {
      fail("FENCE_FAILED");
    }
  }
  async function fenced<T>(
    work: (tx: Tx, active: () => void) => Promise<T>,
  ): Promise<T> {
    const deadline = performance.now() + 30_000;
    const active = () => {
      if (performance.now() >= deadline) fail("DEADLINE_EXCEEDED");
    };
    let returned = false;
    try {
      return await db.transaction(
        async (tx) => {
          active();
          await tx.execute(sql`set local lock_timeout = '5s'`);
          await tx.execute(sql`set local statement_timeout = '30s'`);
          // PostgreSQL otherwise searches implicit pg_temp before public tables.
          // Put it last so pooled temporary relations cannot shadow durable rows.
          await tx.execute(
            sql`set local search_path = pg_catalog, public, pg_temp`,
          );
          // Constant across all run IDs, source hashes and caller target labels.
          await tx.execute(
            sql`select pg_advisory_xact_lock(7421902612275280::bigint)`,
          );
          await tx.execute(
            sql`lock table drizzle.__drizzle_migrations, public.legacy_import_runs, ${sql.join(
              lockNames.map(
                (name) =>
                  sql`${sql.identifier("public")}.${sql.identifier(name)}`,
              ),
              sql`, `,
            )} in exclusive mode`,
          );
          active();
          const target = await tx
            .select({
              database: sql<string>`current_database()`,
              role: sql<string>`current_user`,
              sessionRole: sql<string>`session_user`,
              readOnly: sql<string>`current_setting('transaction_read_only')`,
              recovery: sql<boolean>`pg_is_in_recovery()`,
            })
            .from(sql`(select 1) as target_probe`);
          if (
            target.length !== 1 ||
            target[0].database !== expected.database ||
            target[0].role !== expected.role ||
            target[0].sessionRole !== expected.role ||
            target[0].readOnly !== "off" ||
            target[0].recovery !== false
          )
            fail("FENCE_FAILED");
          await catalogFence(tx);
          active();
          const result = await work(tx, active);
          active();
          returned = true;
          return result;
        },
        { isolationLevel: "read committed", accessMode: "read write" },
      );
    } catch (error) {
      if (returned) fail("OUTCOME_UNKNOWN");
      if (error instanceof SqlLegacyImportError)
        throw new SqlLegacyImportError(error.code);
      return fail("IMPORT_FAILED");
    }
  }
  function decode(checkpoint: LegacyImportCheckpoint) {
    try {
      const prepared = readLegacyImportCheckpoint(checkpoint, binding);
      const rows = projectLegacyImportRows(prepared);
      return { prepared, rows, fingerprint: fingerprintLegacyImportRows(rows) };
    } catch {
      return fail("INVALID_IMPORT");
    }
  }
  async function load(tx: Tx) {
    const records = await tx
      .select({
        ...getTableColumns(legacyImportRuns),
        importedMilliseconds: sql<string>`(extract(epoch from ${legacyImportRuns.importedAt})*1000)::text`,
        preparedMilliseconds: sql<string>`(extract(epoch from ${legacyImportRuns.preparedAt})*1000)::text`,
        completedMilliseconds: sql<
          string | null
        >`(extract(epoch from ${legacyImportRuns.completedAt})*1000)::text`,
      })
      .from(legacyImportRuns);
    if (records.length > 1) fail("INCONSISTENT_RUN");
    const record = records[0];
    if (!record) return null;
    // Header timestamps obey the same millisecond domain as the saved codec.
    // Reading them as Date alone would hide a sub-millisecond database change.
    for (const [date, exact] of [
      [record.importedAt, record.importedMilliseconds],
      [record.preparedAt, record.preparedMilliseconds],
      [record.completedAt, record.completedMilliseconds],
    ] as const) {
      if (
        date === null
          ? exact !== null
          : typeof exact !== "string" ||
            !/^-?(0|[1-9][0-9]*)(?:\.0+)?$/.test(exact) ||
            !Number.isSafeInteger(Number(exact)) ||
            date.getTime() !== Number(exact)
      )
        fail("INCONSISTENT_RUN");
    }
    if (record.runId !== binding.runId) fail("RUN_CONFLICT");
    for (const key of [
      "sourceManifestSha256",
      "sourceDescriptorSha256",
      "schemaSha256",
      "targetSha256",
    ] as const)
      if (record[key] !== binding[key]) fail("RUN_CONFLICT");
    let decoded: ReturnType<typeof decode>;
    try {
      decoded = decode({
        payload: record.payload,
        payloadSha256: record.payloadSha256,
        configurationSha256: record.configurationSha256,
      });
    } catch {
      return fail("INCONSISTENT_RUN");
    }
    if (
      record.slot !== 1 ||
      record.profile !== "magickli-legacy-import-run-v1" ||
      decoded.fingerprint.sha256 !== record.expectedRowsSha256 ||
      record.importedAt.getTime() !== decoded.prepared.importedAt.getTime() ||
      !Number.isFinite(record.preparedAt.getTime()) ||
      (record.completedAt === null
        ? record.reconciliationSha256 !== null
        : !Number.isFinite(record.completedAt.getTime()) ||
          record.completedAt < record.preparedAt ||
          record.reconciliationSha256 !== record.expectedRowsSha256)
    )
      fail("INCONSISTENT_RUN");
    return { record, ...decoded };
  }
  function receipt(
    record: Saved,
    fingerprint: LegacyImportRowReceipt,
  ): SqlLegacyImportReceipt {
    return {
      ...binding,
      payloadSha256: record.payloadSha256,
      configurationSha256: record.configurationSha256,
      expectedRowsSha256: record.expectedRowsSha256,
      state: record.completedAt ? "completed" : "prepared",
      preparedAt: new Date(record.preparedAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      counts: { ...fingerprint.counts },
    };
  }
  async function reconcile(tx: Tx, rows: LegacyImportRows) {
    try {
      await reconcileLegacyImportRows(tx, rows);
    } catch {
      fail("TARGET_CHANGED");
    }
  }
  const empty = Object.fromEntries(
    names.map((name) => [name, [] as LegacyImportRows[typeof name]]),
  ) as LegacyImportRows;
  async function clock(tx: Tx) {
    const result = await tx
      .select({
        now: sql<Date>`date_trunc('milliseconds',clock_timestamp())`.mapWith(
          (value: string | Date) => new Date(value),
        ),
      })
      .from(sql`(select 1) as clock_probe`);
    if (result.length !== 1 || !Number.isFinite(result[0].now.getTime()))
      fail("IMPORT_FAILED");
    return result[0].now;
  }
  return {
    async inspect(): Promise<SqlLegacyImportReceipt | null> {
      return fenced(async (tx) => {
        const saved = await load(tx);
        if (!saved) return null;
        await reconcile(tx, saved.record.completedAt ? saved.rows : empty);
        return receipt(saved.record, saved.fingerprint);
      });
    },
    async prepare(
      input: LegacyImportCheckpoint,
    ): Promise<SqlLegacyImportReceipt> {
      const checkpoint = copy(input),
        wanted = decode(checkpoint);
      return fenced(async (tx, active) => {
        const saved = await load(tx);
        if (saved) {
          if (
            saved.record.payload !== checkpoint.payload ||
            saved.record.payloadSha256 !== checkpoint.payloadSha256 ||
            saved.record.configurationSha256 !== checkpoint.configurationSha256
          )
            fail("RUN_CONFLICT");
          await reconcile(tx, saved.record.completedAt ? saved.rows : empty);
          return receipt(saved.record, saved.fingerprint);
        }
        await reconcile(tx, empty);
        active();
        const record: Saved = {
          ...binding,
          ...checkpoint,
          profile: "magickli-legacy-import-run-v1",
          slot: 1,
          expectedRowsSha256: wanted.fingerprint.sha256,
          importedAt: wanted.prepared.importedAt,
          preparedAt: await clock(tx),
          completedAt: null,
          reconciliationSha256: null,
        };
        await tx.insert(legacyImportRuns).values(record);
        const stored = await load(tx);
        if (!stored || stored.record.payload !== checkpoint.payload)
          fail("INCONSISTENT_RUN");
        await catalogFence(tx);
        return receipt(stored.record, stored.fingerprint);
      });
    },
    async apply(payloadSha256: string): Promise<SqlLegacyImportReceipt> {
      if (!digest(payloadSha256)) fail("INVALID_IMPORT");
      return fenced(async (tx, active) => {
        const saved = await load(tx);
        if (!saved) fail("MISSING_RUN");
        if (saved.record.payloadSha256 !== payloadSha256) fail("RUN_CONFLICT");
        if (saved.record.completedAt) {
          await reconcile(tx, saved.rows);
          return receipt(saved.record, saved.fingerprint);
        }
        await reconcile(tx, empty);
        for (const name of names) {
          const table: PgTable = LEGACY_IMPORT_TABLES[name];
          const rows = saved.rows[name];
          // Parameter-sized chunks share this one transaction; no partial commit.
          for (let offset = 0; offset < rows.length; offset += 500) {
            active();
            const chunk = rows.slice(offset, offset + 500);
            await tx
              .insert(table)
              .values(
                name === "rituals"
                  ? chunk.map((row) => ({ ...row, currentRevisionId: null }))
                  : chunk,
              );
          }
        }
        for (const row of saved.rows.rituals) {
          active();
          const result = await tx
            .update(rituals)
            .set({ currentRevisionId: row.currentRevisionId as string })
            .where(
              and(
                eq(rituals.id, row.id as string),
                isNull(rituals.currentRevisionId),
                isNull(rituals.currentCompiledArtifactId),
                eq(rituals.version, 0),
              ),
            )
            .returning({ id: rituals.id });
          if (result.length !== 1) fail("INCONSISTENT_RUN");
        }
        await reconcile(tx, saved.rows);
        await catalogFence(tx);
        active();
        const completedAt = await clock(tx);
        const result = await tx
          .update(legacyImportRuns)
          .set({ completedAt, reconciliationSha256: saved.fingerprint.sha256 })
          .where(
            and(
              eq(legacyImportRuns.runId, binding.runId),
              isNull(legacyImportRuns.completedAt),
            ),
          )
          .returning();
        if (result.length !== 1) fail("INCONSISTENT_RUN");
        return receipt(result[0], saved.fingerprint);
      });
    },
  };
}
