import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { uuidV7 } from "./ids";
import { temples, userGroups } from "./memberships";

const instant = (name: string) => timestamp(name, { withTimezone: true });
const v7 = (name: string, id: AnyPgColumn) =>
  check(
    name,
    sql`substring(${id}::text from 15 for 1) = '7' and substring(${id}::text from 20 for 1) in ('8', '9', 'a', 'b')`,
  );
const hashMatches = (name: string, hash: AnyPgColumn, value: AnyPgColumn) =>
  check(
    name,
    sql`${hash} = encode(sha256(convert_to(${value}, 'UTF8')), 'hex')`,
  );
const nonempty = (name: string, value: AnyPgColumn) =>
  check(name, sql`length(btrim(${value})) > 0`);
const history = () => ({
  createdAt: instant("created_at"),
  updatedAt: instant("updated_at"),
  legacySyncUpdatedAtMilliseconds: bigint(
    "legacy_sync_updated_at_milliseconds",
    { mode: "number" },
  ),
});

export const ritualScopeKind = pgEnum("ritual_scope_kind", [
  "public",
  "group",
  "temple",
]);

/** Policy columns feed src/doc/access; a null creator grants nobody ownership. */
export const rituals = pgTable(
  "rituals",
  {
    id: uuidV7("id").primaryKey(),
    title: text("title").notNull(),
    creatorId: uuid("creator_id").references(() => user.id),
    scope: ritualScopeKind("scope").notNull(),
    groupId: uuid("group_id").references(() => userGroups.id),
    templeId: uuid("temple_id").references(() => temples.id),
    minGrade: bigint("min_grade", { mode: "number" }),
    // Dependency-ordered import/create starts here; readers must withhold shells.
    currentRevisionId: uuid("current_revision_id"),
    // Null preserves imported legacy archive authority; new saves select explicitly.
    currentCompiledArtifactId: uuid("current_compiled_artifact_id"),
    // A new SQL concurrency token; legacy timestamps remain separate evidence.
    version: bigint("version", { mode: "number" }).notNull().default(0),
    ...history(),
  },
  (table) => [
    v7("rituals_id_v7", table.id),
    check(
      "rituals_exclusive_scope",
      sql`
    (${table.scope} = 'public' and ${table.groupId} is null and ${table.templeId} is null and ${table.minGrade} is null)
    or (${table.scope} = 'group' and ${table.groupId} is not null and ${table.templeId} is null and ${table.minGrade} is null)
    or (${table.scope} = 'temple' and ${table.groupId} is null and ${table.templeId} is not null and ${table.minGrade} is not null and ${table.minGrade} between 0 and 9007199254740991)`,
    ),
    check(
      "rituals_version_safe",
      sql`${table.version} between 0 and 9007199254740991`,
    ),
    foreignKey({
      name: "rituals_current_revision_own_parent",
      columns: [table.id, table.currentRevisionId],
      foreignColumns: [ritualRevisions.ritualId, ritualRevisions.id],
    }),
    foreignKey({
      name: "rituals_current_artifact_own_revision",
      columns: [table.currentRevisionId, table.currentCompiledArtifactId],
      foreignColumns: [
        ritualCompiledArtifacts.revisionId,
        ritualCompiledArtifacts.id,
      ],
    }),
    check(
      "rituals_selected_artifact_requires_revision",
      sql`${table.currentCompiledArtifactId} is null or ${table.currentRevisionId} is not null`,
    ),
    index("rituals_group_idx").on(table.groupId),
    index("rituals_temple_idx").on(table.templeId),
    index("rituals_creator_idx").on(table.creatorId),
  ],
);

/** Immutable source history. Legacy format versions are explicitly unknown, never guessed. */
export const ritualRevisions = pgTable(
  "ritual_revisions",
  {
    id: uuidV7("id").primaryKey(),
    ritualId: uuid("ritual_id")
      .notNull()
      .references((): AnyPgColumn => rituals.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    source: text("source").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    sourceFormat: text("source_format").notNull(),
    sourceFormatVersion: text("source_format_version").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    legacySyncUpdatedAtMilliseconds: bigint(
      "legacy_sync_updated_at_milliseconds",
      { mode: "number" },
    ),
  },
  (table) => [
    v7("ritual_revisions_id_v7", table.id),
    unique("ritual_revisions_parent_id_unique").on(table.ritualId, table.id),
    unique("ritual_revisions_source_hash_unique").on(
      table.id,
      table.sourceSha256,
    ),
    hashMatches(
      "ritual_revisions_source_hash_matches",
      table.sourceSha256,
      table.source,
    ),
    nonempty("ritual_revisions_format_nonempty", table.sourceFormat),
    nonempty(
      "ritual_revisions_format_version_nonempty",
      table.sourceFormatVersion,
    ),
    index("ritual_revisions_author_idx").on(table.authorId),
  ],
);

/**
 * Protected original decoded JSON serialization, including forMe and unknown JRT
 * attributes. The claimed pointer records legacy linkage, not verified source parity.
 * Keep the original BSON backup too: this is not an archive of BSON wire bytes.
 */
export const legacyRitualCompiledArchives = pgTable(
  "legacy_ritual_compiled_archives",
  {
    ritualId: uuid("ritual_id")
      .primaryKey()
      .references(() => rituals.id),
    claimedRevisionId: uuid("claimed_revision_id").notNull(),
    contentJson: text("content_json").notNull(),
    contentSha256: text("content_sha256").notNull(),
    serializationVersion: text("serialization_version").notNull(),
    importedAt: instant("imported_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "legacy_ritual_archive_own_revision",
      columns: [table.ritualId, table.claimedRevisionId],
      foreignColumns: [ritualRevisions.ritualId, ritualRevisions.id],
    }),
    hashMatches(
      "legacy_ritual_archive_hash_matches",
      table.contentSha256,
      table.contentJson,
    ),
    check(
      "legacy_ritual_archive_json_object",
      sql`json_typeof(${table.contentJson}::json) = 'object'`,
    ),
    check(
      "legacy_ritual_archive_serialization",
      sql`${table.serializationVersion} = 'json-stringify-utf8-v1'`,
    ),
  ],
);

/** A compiler run is a separate artifact; its hash is tied to the exact source revision. */
export const ritualCompiledArtifacts = pgTable(
  "ritual_compiled_artifacts",
  {
    id: uuidV7("id").primaryKey(),
    revisionId: uuid("revision_id").notNull(),
    sourceSha256: text("source_sha256").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    outputFormat: text("output_format").notNull(),
    outputFormatVersion: text("output_format_version").notNull(),
    // Empty means no cleanup. A future forMe removal requires a named, versioned transform.
    transformations: text("transformations").array().notNull(),
    contentJson: text("content_json").notNull(),
    contentSha256: text("content_sha256").notNull(),
    compiledAt: instant("compiled_at").notNull(),
  },
  (table) => [
    v7("ritual_compiled_artifacts_id_v7", table.id),
    unique("ritual_compiled_artifacts_revision_id_unique").on(
      table.revisionId,
      table.id,
    ),
    foreignKey({
      name: "ritual_compiled_artifact_exact_source",
      columns: [table.revisionId, table.sourceSha256],
      foreignColumns: [ritualRevisions.id, ritualRevisions.sourceSha256],
    }),
    hashMatches(
      "ritual_compiled_artifact_hash_matches",
      table.contentSha256,
      table.contentJson,
    ),
    check(
      "ritual_compiled_artifact_json_object",
      sql`json_typeof(${table.contentJson}::json) = 'object'`,
    ),
    nonempty(
      "ritual_compiled_artifact_compiler_nonempty",
      table.compilerVersion,
    ),
    nonempty("ritual_compiled_artifact_format_nonempty", table.outputFormat),
    nonempty(
      "ritual_compiled_artifact_format_version_nonempty",
      table.outputFormatVersion,
    ),
    check(
      "ritual_compiled_artifact_transformations_named",
      sql`array_position(${table.transformations}, NULL) is null and array_position(${table.transformations}, '') is null`,
    ),
    index("ritual_compiled_artifact_revision_idx").on(table.revisionId),
  ],
);
