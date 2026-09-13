import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";

const profile = "magickli-import-catalog-v1";
const searchPath = "pg_catalog, public, pg_temp";
const maxBytes = 16 * 1024 * 1024;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type CatalogFact = { [key: string]: Json };
type Transaction = Pick<PgDatabase<PgQueryResultHKT>, "select">;

/** Public namespace only. The importer separately checks the required ordinary tables. */
export interface LegacyImportCatalogRelation extends CatalogFact {
  name: string;
  kind: string;
}
/** Protected definitions and role names; never a log-safe or browser projection. */
export interface LegacyImportCatalogSnapshot {
  database: CatalogFact;
  relations: LegacyImportCatalogRelation[];
  columns: CatalogFact[];
  constraints: CatalogFact[];
  indexes: CatalogFact[];
  enums: CatalogFact[];
  triggers: CatalogFact[];
  policies: CatalogFact[];
  routines: CatalogFact[];
  extensions: CatalogFact[];
  collations: CatalogFact[];
  types: CatalogFact[];
  rules: CatalogFact[];
  sequences: CatalogFact[];
}
/** Evidence from a separately reviewed fresh-migration rehearsal, never authorization. */
export interface LegacyImportCatalog {
  profile: typeof profile;
  snapshot: LegacyImportCatalogSnapshot;
  sha256: string;
}
export class LegacyImportCatalogError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CATALOG"
      | "CATALOG_MISMATCH"
      | "READ_FAILED",
  ) {
    super(code);
    this.name = "LegacyImportCatalogError";
  }
}
function fail(
  code: LegacyImportCatalogError["code"] = "INVALID_CATALOG",
): never {
  throw new LegacyImportCatalogError(code);
}
function copy<T>(value: T): T {
  try {
    return parseLegacyImportValue(serializeLegacyImportValue(value)) as T;
  } catch {
    return fail();
  }
}
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const row = object(value);
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    fail();
  return row;
}
function canonical(value: unknown): Json {
  if (value === null || typeof value === "boolean") return value;
  // The preceding codec copy already rejects non-finite numbers and negative zero.
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (!value.isWellFormed() || value.includes("\0")) fail();
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(
    Object.entries(object(value))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)]),
  );
}
const sections = [
  "relations",
  "columns",
  "constraints",
  "indexes",
  "enums",
  "triggers",
  "policies",
  "routines",
  "extensions",
  "collations",
  "types",
  "rules",
  "sequences",
] as const;
function checked(value: unknown): LegacyImportCatalogSnapshot {
  const row = exact(value, ["database", ...sections]);
  const database = object(row.database);
  if (
    database.searchPath !== searchPath ||
    !Number.isSafeInteger(database.postgresMajor) ||
    (database.postgresMajor as number) < 15 ||
    typeof database.encoding !== "string"
  )
    fail();
  for (const section of sections) {
    const rows = row[section];
    if (!Array.isArray(rows) || rows.length > 50_000) fail();
    for (const item of rows) object(item);
  }
  for (const relation of row.relations as Record<string, unknown>[]) {
    if (
      typeof relation.name !== "string" ||
      !relation.name ||
      typeof relation.kind !== "string"
    )
      fail();
  }
  // Current migrations contain ordinary functions. An aggregate's transition
  // machinery cannot be represented faithfully by pg_get_functiondef.
  if (
    (row.routines as Record<string, unknown>[]).some(
      (routine) => !["f", "p", "w"].includes(routine.kind as string),
    )
  )
    fail();
  return canonical(row) as unknown as LegacyImportCatalogSnapshot;
}
function evidence(snapshot: unknown): LegacyImportCatalog {
  const owned = checked(copy(snapshot));
  const encoded = serializeLegacyImportValue({ profile, snapshot: owned });
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) fail();
  return {
    profile,
    snapshot: owned,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

// Every catalog/function reference is qualified. Deparser output is meaningful
// only under the separately checked fixed search_path; no SET is issued here.
const snapshotQuery = sql`(
  with public_relations as (
    select c.* from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  )
  select pg_catalog.jsonb_build_object(
    'database', (
      select pg_catalog.jsonb_build_object(
        'postgresMajor', pg_catalog.current_setting('server_version_num')::integer / 10000,
        'searchPath', pg_catalog.current_setting('search_path'),
        'encoding', pg_catalog.pg_encoding_to_char(d.encoding),
        'localeProvider', d.datlocprovider, 'collate', d.datcollate, 'ctype', d.datctype,
        'locale', pg_catalog.to_jsonb(d)->>'datlocale',
        'icuLocale', pg_catalog.to_jsonb(d)->>'daticulocale',
        'icuRules', pg_catalog.to_jsonb(d)->>'daticurules',
        'collationVersion', d.datcollversion,
        'actualCollationVersion', pg_catalog.pg_database_collation_actual_version(d.oid)
      ) from pg_catalog.pg_database d where d.datname = pg_catalog.current_database()
    ),
    'relations', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', c.relname, 'kind', c.relkind, 'persistence', c.relpersistence,
        'owner', pg_catalog.pg_get_userbyid(c.relowner),
        'acl', (select pg_catalog.jsonb_agg(a::text order by a::text collate "C") from pg_catalog.unnest(c.relacl) a),
        'options', (select pg_catalog.jsonb_agg(o order by o collate "C") from pg_catalog.unnest(c.reloptions) o),
        'rowSecurity', c.relrowsecurity, 'forceRowSecurity', c.relforcerowsecurity,
        'replicaIdentity', c.relreplident, 'isPartition', c.relispartition,
        'accessMethod', am.amname, 'tablespace', ts.spcname,
        'viewDefinition', case when c.relkind in ('v','m') then pg_catalog.pg_get_viewdef(c.oid, false) else null end,
        'partitionKey', case when c.relkind = 'p' then pg_catalog.pg_get_partkeydef(c.oid) else null end,
        'partitionBound', pg_catalog.pg_get_expr(c.relpartbound, c.oid, false),
        'parents', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('schema', pn.nspname, 'name', pc.relname) order by i.inhseqno)
          from pg_catalog.pg_inherits i join pg_catalog.pg_class pc on pc.oid = i.inhparent
          join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace where i.inhrelid = c.oid)
      ) order by c.relname collate "C") from public_relations c
      left join pg_catalog.pg_am am on am.oid = c.relam
      left join pg_catalog.pg_tablespace ts on ts.oid = c.reltablespace
    ), '[]'::jsonb),
    'columns', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'relation', c.relname, 'position', a.attnum, 'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'dimensions', a.attndims,
        'notNull', a.attnotnull, 'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false),
        'identity', a.attidentity, 'generated', a.attgenerated,
        'collationSchema', cn.nspname, 'collation', col.collname,
        'storage', a.attstorage, 'compression', a.attcompression,
        'options', a.attoptions, 'foreignOptions', a.attfdwoptions,
        'acl', (select pg_catalog.jsonb_agg(ac::text order by ac::text collate "C") from pg_catalog.unnest(a.attacl) ac)
      ) order by c.relname collate "C", a.attnum)
      from public_relations c join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      left join pg_catalog.pg_collation col on col.oid = a.attcollation
      left join pg_catalog.pg_namespace cn on cn.oid = col.collnamespace
    ), '[]'::jsonb),
    'constraints', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'relation', c.relname, 'domain', t.typname, 'name', k.conname, 'kind', k.contype,
        'definition', pg_catalog.pg_get_constraintdef(k.oid, false),
        'validated', k.convalidated, 'deferrable', k.condeferrable,
        'initiallyDeferred', k.condeferred, 'noInherit', k.connoinherit
      ) order by coalesce(c.relname, '') collate "C", coalesce(t.typname, '') collate "C", k.conname collate "C")
      from pg_catalog.pg_constraint k join pg_catalog.pg_namespace n on n.oid = k.connamespace
      left join pg_catalog.pg_class c on c.oid = k.conrelid
      left join pg_catalog.pg_type t on t.oid = k.contypid where n.nspname = 'public'
    ), '[]'::jsonb),
    'indexes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', i.relname, 'relation', c.relname, 'definition', pg_catalog.pg_get_indexdef(x.indexrelid),
        'valid', x.indisvalid, 'ready', x.indisready, 'live', x.indislive,
        'unique', x.indisunique, 'primary', x.indisprimary, 'exclusion', x.indisexclusion,
        'immediate', x.indimmediate, 'nullsNotDistinct', x.indnullsnotdistinct,
        'clustered', x.indisclustered, 'replicaIdentity', x.indisreplident
      ) order by i.relname collate "C")
      from pg_catalog.pg_index x join public_relations c on c.oid = x.indrelid
      join pg_catalog.pg_class i on i.oid = x.indexrelid
    ), '[]'::jsonb),
    'enums', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', t.typname, 'labels', (select pg_catalog.jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid = t.oid)
      ) order by t.typname collate "C") from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'
    ), '[]'::jsonb),
    'triggers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'relation', c.relname, 'name', t.tgname, 'enabled', t.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
      ) order by c.relname collate "C", t.tgname collate "C")
      from pg_catalog.pg_trigger t join public_relations c on c.oid = t.tgrelid where not t.tgisinternal
    ), '[]'::jsonb),
    'policies', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'relation', c.relname, 'name', p.polname, 'command', p.polcmd, 'permissive', p.polpermissive,
        'roles', (select pg_catalog.jsonb_agg(role_name order by role_name collate "C") from
          (select case when role_id = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_id) end as role_name from pg_catalog.unnest(p.polroles) role_id) roles),
        'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, false),
        'check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
      ) order by c.relname collate "C", p.polname collate "C") from pg_catalog.pg_policy p join public_relations c on c.oid = p.polrelid
    ), '[]'::jsonb),
    'routines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', p.proname, 'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid), 'kind', p.prokind,
        'owner', pg_catalog.pg_get_userbyid(p.proowner),
        'acl', (select pg_catalog.jsonb_agg(a::text order by a::text collate "C") from pg_catalog.unnest(p.proacl) a),
        'definition', case when p.prokind <> 'a' then pg_catalog.pg_get_functiondef(p.oid) else null end
      ) order by p.proname collate "C", pg_catalog.pg_get_function_identity_arguments(p.oid) collate "C")
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    ), '[]'::jsonb),
    'extensions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', e.extname, 'version', e.extversion, 'schema', n.nspname, 'relocatable', e.extrelocatable
      ) order by e.extname collate "C") from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    ), '[]'::jsonb),
    'collations', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'schema', n.nspname, 'name', c.collname, 'provider', c.collprovider,
        'deterministic', c.collisdeterministic, 'encoding', c.collencoding,
        'collate', c.collcollate, 'ctype', c.collctype,
        'locale', pg_catalog.to_jsonb(c)->>'colllocale',
        'icuLocale', pg_catalog.to_jsonb(c)->>'colliculocale',
        'icuRules', pg_catalog.to_jsonb(c)->>'collicurules',
        'version', c.collversion, 'actualVersion', pg_catalog.pg_collation_actual_version(c.oid)
      ) order by n.nspname collate "C", c.collname collate "C")
      from pg_catalog.pg_collation c join pg_catalog.pg_namespace n on n.oid = c.collnamespace
      where n.nspname = 'public' or c.oid in (
        select a.attcollation from pg_catalog.pg_attribute a join public_relations r on r.oid = a.attrelid where not a.attisdropped
        union select pg_catalog.unnest(i.indcollation::oid[]) from pg_catalog.pg_index i join public_relations r on r.oid = i.indrelid
      )
    ), '[]'::jsonb),
    'types', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', t.typname, 'kind', t.typtype, 'category', t.typcategory,
        'base', case when t.typbasetype <> 0 then pg_catalog.format_type(t.typbasetype, t.typtypmod) else null end,
        'element', case when t.typelem <> 0 then pg_catalog.format_type(t.typelem, null) else null end,
        'notNull', t.typnotnull, 'default', pg_catalog.pg_get_expr(t.typdefaultbin, 0, false),
        'input', t.typinput::regprocedure::text, 'output', t.typoutput::regprocedure::text,
        'receive', t.typreceive::regprocedure::text, 'send', t.typsend::regprocedure::text,
        'length', t.typlen, 'byValue', t.typbyval, 'alignment', t.typalign, 'storage', t.typstorage,
        'delimiter', t.typdelim, 'defined', t.typisdefined
      ) order by t.typname collate "C") from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typrelid = 0
    ), '[]'::jsonb),
    'rules', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'relation', c.relname, 'name', r.rulename, 'enabled', r.ev_enabled,
        'definition', pg_catalog.pg_get_ruledef(r.oid, false)
      ) order by c.relname collate "C", r.rulename collate "C") from pg_catalog.pg_rewrite r join public_relations c on c.oid = r.ev_class
    ), '[]'::jsonb),
    'sequences', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', c.relname, 'type', pg_catalog.format_type(s.seqtypid, null),
        'start', s.seqstart::text, 'increment', s.seqincrement::text,
        'minimum', s.seqmin::text, 'maximum', s.seqmax::text,
        'cache', s.seqcache::text, 'cycle', s.seqcycle
      ) order by c.relname collate "C") from pg_catalog.pg_sequence s join public_relations c on c.oid = s.seqrelid
    ), '[]'::jsonb)
  ) as snapshot
) as catalog_snapshot`;

/**
 * Capture evidence only. Caller must set exactly `SET LOCAL search_path =
 * pg_catalog, public, pg_temp`, hold its fenced transaction/locks and enforce a deadline.
 * Explicitly last pg_temp keeps unqualified app relations ahead of pooled temp tables.
 * Definitions are engine/environment specific: PostgreSQL major, locale,
 * extensions, UUID helper and owners are not normalized across rehearsals.
 * No OIDs, sequence values, relation statistics or application rows are captured.
 * The 16 MiB limit bounds accepted serialized evidence, not server query memory.
 */
export async function captureLegacyImportCatalog(
  tx: Transaction,
): Promise<LegacyImportCatalog> {
  try {
    const context = await tx
      .select({
        searchPath: sql<string>`pg_catalog.current_setting('search_path')`,
      })
      .from(sql`(select 1) as fixed_context`);
    if (context.length !== 1 || context[0].searchPath !== searchPath) fail();
    const rows = await tx
      .select({ snapshot: sql<unknown>`catalog_snapshot.snapshot` })
      .from(snapshotQuery);
    if (rows.length !== 1) fail();
    return evidence(rows[0].snapshot);
  } catch (error) {
    if (error instanceof LegacyImportCatalogError)
      throw new LegacyImportCatalogError(error.code);
    return fail("READ_FAILED");
  }
}

/** Compare to a separately reviewed baseline; never capture-and-adopt the target. */
export async function verifyLegacyImportCatalog(
  tx: Transaction,
  expected: LegacyImportCatalog,
): Promise<string> {
  const saved = copy(expected);
  exact(saved, ["profile", "snapshot", "sha256"]);
  const baseline = evidence(saved.snapshot);
  if (saved.profile !== profile || saved.sha256 !== baseline.sha256) fail();
  const current = await captureLegacyImportCatalog(tx);
  if (current.sha256 !== baseline.sha256) fail("CATALOG_MISMATCH");
  return baseline.sha256;
}
