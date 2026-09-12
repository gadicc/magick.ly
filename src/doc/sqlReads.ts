import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import {
  legacyRitualCompiledArchives,
  ritualCompiledArtifacts,
  ritualRevisions,
  rituals,
} from "../db/schema/rituals";
import { isUuidV7 } from "../lib/ids";
import {
  getRitualAccess,
  type RitualAccess,
  type RitualPrincipal,
} from "./access";

import {
  RITUAL_OUTPUT_FORMAT,
  RITUAL_OUTPUT_FORMAT_VERSION,
} from "./compileContract";
import {
  type SqlRitualParentRow as ParentRow,
  sqlRitualParentFields as parentFields,
  sqlRitualPolicy as policy,
  loadSqlRitualPrincipal as principal,
} from "./sqlPolicy";

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
/** Use the transaction-capable server database, not the Neon HTTP query adapter. */
export interface SqlRitualReadDatabase {
  transaction<T>(
    work: (tx: ReadDatabase) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

/** Permitted list/detail metadata only; this is not a rendered ritual or an offline snapshot. */
export interface SqlRitualMetadata {
  id: string;
  title: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  canEdit: boolean;
}

/** Exact current archived renderer input, excluding source/history and import provenance. */
export interface SqlRenderedRitual {
  ritual: SqlRitualMetadata;
  contentJson: string;
  contentSha256: string;
}

const revisionMetadataFields = {
  id: ritualRevisions.id,
  ritualId: ritualRevisions.ritualId,
  authorId: ritualRevisions.authorId,
  createdAt: ritualRevisions.createdAt,
  updatedAt: ritualRevisions.updatedAt,
  sourceSha256: ritualRevisions.sourceSha256,
  sourceFormat: ritualRevisions.sourceFormat,
  sourceFormatVersion: ritualRevisions.sourceFormatVersion,
};

/** Editing-only source identity and provenance, excluding legacy import evidence. */
export type SqlRitualRevisionMetadata = Pick<
  typeof ritualRevisions.$inferSelect,
  keyof typeof revisionMetadataFields
>;

/** Exact stored source; no compilation, cleanup or Unicode normalization takes place. */
export type SqlRitualRevisionSource = SqlRitualRevisionMetadata & {
  source: string;
};

/** Current parent concurrency state for an authorized editor, never a legacy timestamp token. */
export interface SqlRitualEditorParent {
  ritual: SqlRitualMetadata;
  currentRevisionId: string;
  version: number;
}

/** Revision metadata ordered by updated time, with an independent explicit current pointer. */
export interface SqlRitualSourceHistory extends SqlRitualEditorParent {
  revisions: SqlRitualRevisionMetadata[];
}

/** A requested current/historical revision alongside its parent's current editing state. */
export interface SqlRitualSourceRead extends SqlRitualEditorParent {
  revision: SqlRitualRevisionSource;
}

function canonicalId(value: unknown): string | null {
  return isUuidV7(value) ? value.toLowerCase() : null;
}

function metadata(row: ParentRow, access: RitualAccess): SqlRitualMetadata {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit: access.edit,
  };
}

async function parent(
  tx: ReadDatabase,
  id: string,
  actor: RitualPrincipal | null,
  required: "read" | "readSourceHistory",
) {
  const [row] = await tx
    .select(parentFields)
    .from(rituals)
    .where(and(eq(rituals.id, id), isNotNull(rituals.currentRevisionId)));
  if (!row || row.currentRevisionId === null) return null;
  const access = getRitualAccess(policy(row), actor);
  if (!access[required]) return null;
  return {
    row,
    metadata: metadata(row, access),
    currentRevisionId: row.currentRevisionId,
  };
}

/**
 * Server-only authorization/read repository. getVerifiedActorId must verify the
 * request's current session; never feed it a body/query ID or a cached principal.
 * No auth/session implementation is activated here. Each call reloads persisted
 * grants and policy in one read-only repeatable-read snapshot; a concurrent change
 * takes effect on the next call. Errors propagate to the future transport boundary.
 * Missing, invalid and unauthorized IDs share null/empty results. No legacy aliases,
 * provider tokens or import provenance are exposed. Rendering uses only the exact
 * selected artifact bound to the current revision, or its original legacy archive
 * when no artifact is selected. Missing selected output never falls back.
 */
export function createSqlRitualReader(
  db: SqlRitualReadDatabase,
  getVerifiedActorId: () => Promise<string | null>,
) {
  async function read<T>(
    work: (tx: ReadDatabase, actor: RitualPrincipal | null) => Promise<T>,
  ): Promise<T> {
    const actorId = await getVerifiedActorId();
    return db.transaction(
      async (tx) => work(tx, await principal(tx, actorId)),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async function sourceRead(
    ritualId: string,
    revisionId?: string,
  ): Promise<SqlRitualSourceRead | null> {
    const id = canonicalId(ritualId);
    const requestedRevisionId =
      revisionId === undefined ? undefined : canonicalId(revisionId);
    if (!id || requestedRevisionId === null) return null;
    return read(async (tx, actor) => {
      const found = await parent(tx, id, actor, "readSourceHistory");
      if (!found) return null;
      const [revision] = await tx
        .select({ ...revisionMetadataFields, source: ritualRevisions.source })
        .from(ritualRevisions)
        .where(
          and(
            eq(ritualRevisions.ritualId, id),
            eq(
              ritualRevisions.id,
              requestedRevisionId ?? found.currentRevisionId,
            ),
          ),
        );
      if (!revision) return null;
      return {
        ritual: found.metadata,
        currentRevisionId: found.currentRevisionId,
        version: found.row.version,
        revision,
      };
    });
  }

  return {
    /** One batched grant load and one metadata query, regardless of ritual count. */
    async listMetadata(): Promise<SqlRitualMetadata[]> {
      return read(async (tx, actor) => {
        const rows = await tx
          .select(parentFields)
          .from(rituals)
          .where(isNotNull(rituals.currentRevisionId))
          .orderBy(asc(rituals.id));
        return rows.flatMap((row) => {
          const access = getRitualAccess(policy(row), actor);
          return access.read ? [metadata(row, access)] : [];
        });
      });
    },
    async getMetadata(ritualId: string): Promise<SqlRitualMetadata | null> {
      const id = canonicalId(ritualId);
      if (!id) return null;
      return read(
        async (tx, actor) =>
          (await parent(tx, id, actor, "read"))?.metadata ?? null,
      );
    },
    /**
     * Exact selected JSON for an ordinary reader. A selected artifact must match
     * the current revision and supported output format; failures return null. Only
     * imported parents without a selected artifact may use their matching legacy
     * archive. No unselected artifact, source recompile or cleanup substitutes.
     */
    async getRendered(ritualId: string): Promise<SqlRenderedRitual | null> {
      const id = canonicalId(ritualId);
      if (!id) return null;
      return read(async (tx, actor) => {
        const found = await parent(tx, id, actor, "read");
        if (!found) return null;
        if (found.row.currentCompiledArtifactId !== null) {
          const [artifact] = await tx
            .select({
              contentJson: ritualCompiledArtifacts.contentJson,
              contentSha256: ritualCompiledArtifacts.contentSha256,
            })
            .from(ritualCompiledArtifacts)
            .where(
              and(
                eq(
                  ritualCompiledArtifacts.id,
                  found.row.currentCompiledArtifactId,
                ),
                eq(ritualCompiledArtifacts.revisionId, found.currentRevisionId),
                eq(ritualCompiledArtifacts.outputFormat, RITUAL_OUTPUT_FORMAT),
                eq(
                  ritualCompiledArtifacts.outputFormatVersion,
                  RITUAL_OUTPUT_FORMAT_VERSION,
                ),
              ),
            );
          return artifact ? { ritual: found.metadata, ...artifact } : null;
        }
        const [archive] = await tx
          .select({
            contentJson: legacyRitualCompiledArchives.contentJson,
            contentSha256: legacyRitualCompiledArchives.contentSha256,
          })
          .from(legacyRitualCompiledArchives)
          .where(
            and(
              eq(legacyRitualCompiledArchives.ritualId, id),
              eq(
                legacyRitualCompiledArchives.claimedRevisionId,
                found.currentRevisionId,
              ),
            ),
          );
        return archive ? { ritual: found.metadata, ...archive } : null;
      });
    },
    /** Source history metadata stays private even when the parent is publicly readable. */
    async listSourceHistory(
      ritualId: string,
    ): Promise<SqlRitualSourceHistory | null> {
      const id = canonicalId(ritualId);
      if (!id) return null;
      return read(async (tx, actor) => {
        const found = await parent(tx, id, actor, "readSourceHistory");
        if (!found) return null;
        const revisions = await tx
          .select(revisionMetadataFields)
          .from(ritualRevisions)
          .where(eq(ritualRevisions.ritualId, id))
          .orderBy(desc(ritualRevisions.updatedAt), asc(ritualRevisions.id));
        return {
          ritual: found.metadata,
          currentRevisionId: found.currentRevisionId,
          version: found.row.version,
          revisions,
        };
      });
    },
    /** Reads the persisted current pointer rather than guessing from timestamps. */
    getCurrentSource: (ritualId: string) => sourceRead(ritualId),
    /** Both IDs bind the query; knowing an editable parent never grants another parent's source. */
    getRevisionSource: (ritualId: string, revisionId: string) =>
      sourceRead(ritualId, revisionId),
  };
}
