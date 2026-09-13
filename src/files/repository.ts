import "server-only";

import type {
  LoomFileCreateInput,
  LoomFileRecord,
  LoomFileRepository,
} from "@gadicc/loom/files";
import { and, eq, getTableColumns, isNotNull, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { db } from "../db/neon";
import { loomFilesTable } from "../db/schema/loomFiles";
import { ritualFileLinks, ritualUploadIntents } from "../db/schema/ritualFiles";
import { isCanonicalUploadId, isRitualImageType } from "./ritualUploadProtocol";

export interface RitualFileRecord extends LoomFileRecord {
  ritualId: string;
  attachmentId: string;
  operationId: string;
}

export type RitualFileRepository = LoomFileRepository<RitualFileRecord> & {
  findById(id: string): Promise<RitualFileRecord | null>;
};

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
const columns = getTableColumns(loomFilesTable);
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

function trusted(row: Record<string, unknown>): RitualFileRecord | null {
  const file = row.file as typeof loomFilesTable.$inferSelect | undefined;
  const link = row.link as
    | Pick<
        typeof ritualFileLinks.$inferSelect,
        "id" | "operationId" | "ritualId" | "fileId" | "uploaderId"
      >
    | undefined;
  const intent = row.intent as
    | Pick<
        typeof ritualUploadIntents.$inferSelect,
        | "operationId"
        | "actorId"
        | "ritualId"
        | "fileId"
        | "attachmentId"
        | "filename"
        | "byteSize"
        | "contentType"
        | "sha256"
        | "canonicalProvider"
        | "canonicalBucket"
        | "canonicalObjectKey"
      >
    | undefined;
  if (
    !file ||
    !link ||
    !intent ||
    ![
      file.id,
      link.id,
      link.operationId,
      link.ritualId,
      link.fileId,
      link.uploaderId,
      intent.operationId,
      intent.actorId,
      intent.ritualId,
      intent.fileId,
      intent.attachmentId,
    ].every(isCanonicalUploadId) ||
    link.id !== intent.attachmentId ||
    link.operationId !== intent.operationId ||
    link.ritualId !== intent.ritualId ||
    link.fileId !== intent.fileId ||
    link.uploaderId !== intent.actorId ||
    file.id !== intent.fileId ||
    file.deletedAt !== null ||
    file.kind !== "image" ||
    !isRitualImageType(file.contentType) ||
    file.detectedContentType !== file.contentType ||
    file.contentType !== intent.contentType ||
    file.byteSize !== intent.byteSize ||
    file.sha256 !== intent.sha256 ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    file.originalFilename !== intent.filename ||
    file.ownerType !== "user" ||
    file.ownerId !== intent.actorId ||
    file.visibility !== "private" ||
    file.storageProvider !== "r2" ||
    file.storageProvider !== intent.canonicalProvider ||
    file.bucket !== intent.canonicalBucket ||
    file.objectKey !== intent.canonicalObjectKey ||
    typeof file.bucket !== "string" ||
    !file.bucket ||
    typeof file.objectKey !== "string" ||
    !file.objectKey ||
    !plain(file.meta) ||
    Object.keys(file.meta).length !== 0 ||
    !plain(file.imageMeta) ||
    file.audioMeta !== null
  )
    return null;
  return {
    ...file,
    kind: "image",
    contentType: file.contentType,
    detectedContentType: file.contentType,
    visibility: "private",
    ritualId: link.ritualId,
    attachmentId: link.id,
    operationId: link.operationId,
  };
}

/** Finalized private ritual attachments only; legacy/public rows never enter this repository. */
export function createSqlRitualFileRepository(
  database: ReadDatabase,
): RitualFileRepository {
  return {
    async findById(id) {
      if (!isCanonicalUploadId(id)) return null;
      const rows = await database
        .select({
          file: columns,
          link: {
            id: ritualFileLinks.id,
            operationId: ritualFileLinks.operationId,
            ritualId: ritualFileLinks.ritualId,
            fileId: ritualFileLinks.fileId,
            uploaderId: ritualFileLinks.uploaderId,
          },
          intent: {
            operationId: ritualUploadIntents.operationId,
            actorId: ritualUploadIntents.actorId,
            ritualId: ritualUploadIntents.ritualId,
            fileId: ritualUploadIntents.fileId,
            attachmentId: ritualUploadIntents.attachmentId,
            filename: ritualUploadIntents.filename,
            byteSize: ritualUploadIntents.byteSize,
            contentType: ritualUploadIntents.contentType,
            sha256: ritualUploadIntents.sha256,
            canonicalProvider: ritualUploadIntents.canonicalProvider,
            canonicalBucket: ritualUploadIntents.canonicalBucket,
            canonicalObjectKey: ritualUploadIntents.canonicalObjectKey,
          },
        })
        .from(loomFilesTable)
        .innerJoin(
          ritualFileLinks,
          and(
            eq(ritualFileLinks.fileId, loomFilesTable.id),
            isNull(ritualFileLinks.deletedAt),
          ),
        )
        .innerJoin(
          ritualUploadIntents,
          and(
            eq(ritualUploadIntents.operationId, ritualFileLinks.operationId),
            eq(ritualUploadIntents.ritualId, ritualFileLinks.ritualId),
            eq(ritualUploadIntents.fileId, ritualFileLinks.fileId),
            eq(ritualUploadIntents.attachmentId, ritualFileLinks.id),
            eq(ritualUploadIntents.actorId, ritualFileLinks.uploaderId),
            isNotNull(ritualUploadIntents.completedAt),
          ),
        )
        .where(and(eq(loomFilesTable.id, id), isNull(loomFilesTable.deletedAt)))
        .limit(2);
      return rows.length === 1
        ? trusted(rows[0] as unknown as Record<string, unknown>)
        : null;
    },
    /** Digest lookup would make a private file portable across ritual associations. */
    async findBySha256() {
      return null;
    },
    async insert(_input: LoomFileCreateInput) {
      throw new Error("Generic ritual file writes are disabled");
    },
  };
}

/** Configured Loom repository; all reads retain finalized ritual association checks. */
export const filesRepository: RitualFileRepository =
  createSqlRitualFileRepository(db);
