import { createHash } from "node:crypto";
import { getTableColumns, sql } from "drizzle-orm";
import type {
  AnyPgColumn,
  PgDatabase,
  PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import type { PreparedLegacyImportV1 } from "./prepareLegacyImport";

/** Closed application inventory. The eventual import-run table is separate. */
export const LEGACY_IMPORT_TABLES = {
  legacy_id_aliases: schema.legacyIdAliases,
  auth_user: schema.user,
  auth_account: schema.account,
  user_profile: schema.userProfile,
  user_access: schema.userAccess,
  legacy_user_emails: schema.legacyUserEmails,
  legacy_auth_users: schema.legacyAuthUsers,
  legacy_auth_accounts: schema.legacyAuthAccounts,
  user_groups: schema.userGroups,
  temples: schema.temples,
  user_group_grants: schema.userGroupGrants,
  legacy_user_group_grants: schema.legacyUserGroupGrants,
  temple_invites: schema.templeInvites,
  temple_memberships: schema.templeMemberships,
  rituals: schema.rituals,
  ritual_revisions: schema.ritualRevisions,
  legacy_ritual_compiled_archives: schema.legacyRitualCompiledArchives,
  study_progress: schema.studyProgress,
  study_card_states: schema.studyCardStates,
  legacy_study_snapshots: schema.legacyStudySnapshots,
  loom_files: schema.loomFilesTable,
  legacy_file_snapshots: schema.legacyFileSnapshots,
  discourse_user_links: schema.discourseUserLinks,
  auth_session: schema.session,
  auth_verification: schema.verification,
  ritual_compiled_artifacts: schema.ritualCompiledArtifacts,
  ritual_write_receipts_v2: schema.ritualWriteReceipts,
  temple_creation_receipts: schema.templeCreationReceipts,
  study_review_receipts: schema.studyReviewReceipts,
  ritual_upload_intents: schema.ritualUploadIntents,
  ritual_file_links: schema.ritualFileLinks,
  ritual_bundle_publication_intents: schema.ritualBundlePublicationIntents,
  ritual_bundle_assets: schema.ritualBundleAssets,
  ritual_bundles: schema.ritualBundles,
} as const;
type TableName = keyof typeof LEGACY_IMPORT_TABLES;
type Row = Record<string, unknown>;
const names = Object.keys(LEGACY_IMPORT_TABLES) as TableName[];
const profile = "magickli-import-complete-rows-v1";
const accountIdentity = [
  "id",
  "userId",
  "providerId",
  "accountId",
  "createdAt",
  "updatedAt",
];

/** Protected complete rows use Drizzle property names, never caller-selected tables. */
export type LegacyImportRows = Record<TableName, Row[]>;
/** Safe aggregate evidence; no identifiers, source text, emails or storage locations. */
export interface LegacyImportRowReceipt {
  sha256: string;
  counts: Record<TableName, number>;
}

export class LegacyImportRowsError extends Error {
  constructor(
    public readonly code: "INVALID_ROWS" | "TARGET_MISMATCH" | "READ_FAILED",
  ) {
    super(code);
    this.name = "LegacyImportRowsError";
  }
}
function fail(code: LegacyImportRowsError["code"] = "INVALID_ROWS"): never {
  throw new LegacyImportRowsError(code);
}
function copy<T>(value: T): T {
  try {
    return parseLegacyImportValue(serializeLegacyImportValue(value)) as T;
  } catch {
    return fail();
  }
}
function object(value: unknown): Row {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  return value as Row;
}
function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\0")
  )
    fail();
  return value;
}
function json(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map(json);
  return Object.fromEntries(
    Object.entries(object(value))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [text(key), json(item)]),
  );
}
function cell(column: AnyPgColumn, value: unknown): unknown {
  if (value === null) return column.notNull ? fail() : null;
  switch (column.dataType) {
    case "string": {
      const result = text(value);
      if (
        column.columnType === "PgUUID" &&
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(result)
      )
        fail();
      if (column.enumValues?.length && !column.enumValues.includes(result))
        fail();
      return result;
    }
    case "number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Object.is(value, -0) ||
        (column.columnType !== "PgDoublePrecision" &&
          !Number.isSafeInteger(value))
      )
        fail();
      return value;
    case "boolean":
      return typeof value === "boolean" ? value : fail();
    case "date":
      return value instanceof Date && Number.isFinite(value.getTime())
        ? value
        : fail();
    case "json":
      return json(value);
    default:
      return fail();
  }
}
function complete(
  name: TableName,
  input: unknown,
  nullableDefaults: boolean,
): Row {
  const row = object(input),
    columns = getTableColumns(LEGACY_IMPORT_TABLES[name]);
  if (Object.keys(row).some((key) => !Object.hasOwn(columns, key))) fail();
  return Object.fromEntries(
    Object.entries(columns).map(([key, column]) => {
      if (!Object.hasOwn(row, key) && (!nullableDefaults || column.notNull))
        fail();
      const value = cell(column, Object.hasOwn(row, key) ? row[key] : null);
      if (
        name === "auth_account" &&
        !accountIdentity.includes(key) &&
        value !== null
      )
        fail();
      return [key, value];
    }),
  );
}

/**
 * Materialize only nullable omissions. Required values (including SQL defaults)
 * must already be explicit in the verified plan. No IDs, dates or defaults run.
 * Final parent pointers are checked here; insertion still needs ritual shells.
 */
export function projectLegacyImportRows(
  prepared: PreparedLegacyImportV1,
): LegacyImportRows {
  try {
    const p = copy(prepared);
    if (p.profile !== "magickli-prepared-legacy-import-v1") fail();
    const rows: LegacyImportRows = {
      legacy_id_aliases: p.aliases.map(({ source, ...row }) => ({
        ...row,
        ...source,
      })),
      auth_user: p.auth.users,
      auth_account: p.auth.accounts,
      user_profile: p.auth.profiles,
      user_access: p.access,
      legacy_user_emails: p.auth.emails,
      legacy_auth_users: p.auth.legacyUsers,
      legacy_auth_accounts: p.auth.legacyAccounts,
      user_groups: p.memberships.groups,
      temples: p.memberships.temples,
      user_group_grants: p.memberships.grants,
      legacy_user_group_grants: p.memberships.grantEvidence,
      temple_invites: p.memberships.invites,
      temple_memberships: p.memberships.memberships,
      rituals: p.rituals.rituals,
      ritual_revisions: p.rituals.revisions,
      legacy_ritual_compiled_archives: p.rituals.archives,
      study_progress: p.study.progress,
      study_card_states: p.study.cards,
      legacy_study_snapshots: p.study.snapshots,
      loom_files: p.files.files,
      legacy_file_snapshots: p.files.snapshots,
      discourse_user_links: p.discourse.links,
      auth_session: [],
      auth_verification: [],
      ritual_compiled_artifacts: [],
      ritual_write_receipts_v2: [],
      temple_creation_receipts: [],
      study_review_receipts: [],
      ritual_upload_intents: [],
      ritual_file_links: [],
      ritual_bundle_publication_intents: [],
      ritual_bundle_assets: [],
      ritual_bundles: [],
    };
    for (const name of names)
      rows[name] = rows[name].map((row) => complete(name, row, true));
    const parents = new Map(rows.rituals.map((row) => [row.id, row]));
    const revisions = new Map(
      rows.ritual_revisions.map((row) => [row.id, row]),
    );
    if (
      parents.size !== rows.rituals.length ||
      revisions.size !== rows.ritual_revisions.length
    )
      fail();
    const assigned = new Set<string>();
    for (const { ritualId, revisionId } of p.rituals.currentRevisions) {
      const parent = parents.get(ritualId),
        revision = revisions.get(revisionId);
      if (
        !parent ||
        !revision ||
        revision.ritualId !== ritualId ||
        assigned.has(ritualId) ||
        parent.currentRevisionId !== null
      )
        fail();
      parent.currentRevisionId = revisionId;
      assigned.add(ritualId);
    }
    if (assigned.size !== parents.size) fail();
    return rows;
  } catch {
    return fail();
  }
}

function fingerprint(rows: LegacyImportRows): LegacyImportRowReceipt {
  object(rows);
  if (
    Object.keys(rows).length !== names.length ||
    names.some((name) => !Object.hasOwn(rows, name))
  )
    fail();
  let total = 0;
  const tables = names.map((name) => {
    if (!Array.isArray(rows[name])) fail();
    total += rows[name].length;
    if (total > 100_000) fail();
    // Row order and JSONB object order are immaterial. Text and array order are not.
    const values = rows[name]
      .map((row) => serializeLegacyImportValue(complete(name, row, false)))
      .sort();
    return [name, values];
  });
  return {
    sha256: createHash("sha256")
      .update(serializeLegacyImportValue({ profile, tables }))
      .digest("hex"),
    counts: Object.fromEntries(
      names.map((name) => [name, rows[name].length]),
    ) as Record<TableName, number>,
  };
}

/** Versioned complete-row fingerprint, computed independently of database contents. */
export function fingerprintLegacyImportRows(
  rows: LegacyImportRows,
): LegacyImportRowReceipt {
  try {
    return fingerprint(copy(rows));
  } catch {
    return fail();
  }
}

/**
 * Compare exact multisets in PostgreSQL, preserving microseconds, JSONB numeric
 * precision and SQL NULL versus JSON null. Text uses C collation, bypassing both
 * driver BOM decoding and locale-dependent equality. Caller owns the transaction,
 * schema/target fence, table locks and deadline; this helper performs only reads.
 */
export async function reconcileLegacyImportRows(
  tx: Pick<PgDatabase<PgQueryResultHKT>, "select">,
  expected: LegacyImportRows,
): Promise<LegacyImportRowReceipt> {
  const rows = copy(expected);
  const receipt = fingerprintLegacyImportRows(rows);
  try {
    for (const name of names) {
      const columns = Object.entries(
        getTableColumns(LEGACY_IMPORT_TABLES[name]),
      );
      const table = sql`${sql.identifier("public")}.${sql.identifier(name)}`;
      const projection = sql.join(
        columns.map(([, column]) => {
          const id = sql.identifier(column.name);
          return column.columnType === "PgText" ? sql`${id} collate "C"` : id;
        }),
        sql`, `,
      );
      // Explicit column mapping: no row defaults, object spreading into SQL or
      // date-looking-string revival. Naive timestamps retain their UTC wall time.
      const payload = JSON.stringify(
        rows[name].map((row) =>
          Object.fromEntries(
            columns.map(([key, column]) => [column.name, row[key]]),
          ),
        ),
      );
      const query = sql`(
        with expected as (
          select ${projection} from jsonb_populate_recordset(null::${table}, ${payload}::jsonb)
        ), actual as (select ${projection} from ${table})
        select not exists (
          (select * from expected except all select * from actual)
          union all
          (select * from actual except all select * from expected)
        ) as matches
      ) as verification`;
      const result = await tx
        .select({ matches: sql<boolean>`verification.matches` })
        .from(query);
      if (result.length !== 1 || result[0].matches !== true)
        fail("TARGET_MISMATCH");
    }
    return receipt;
  } catch (error) {
    if (error instanceof LegacyImportRowsError)
      throw new LegacyImportRowsError(error.code);
    return fail("READ_FAILED");
  }
}
