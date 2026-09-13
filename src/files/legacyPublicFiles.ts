import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { legacyFileSnapshots } from "../db/schema/legacyFiles";
import { loomFilesTable } from "../db/schema/loomFiles";
import { isUuidV7 } from "../lib/ids";

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;

const LEGACY_PUBLIC_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const MAX_LEGACY_PUBLIC_BYTES = 20 * 1024 * 1024;

export interface LegacyPublicFile {
  id: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  originalFilename: string | null;
  storageProvider: string;
  bucket: string;
  objectKey: string;
}

const fields = {
  id: loomFilesTable.id,
  sha256: loomFilesTable.sha256,
  byteSize: loomFilesTable.byteSize,
  contentType: loomFilesTable.contentType,
  originalFilename: loomFilesTable.originalFilename,
  kind: loomFilesTable.kind,
  storageProvider: loomFilesTable.storageProvider,
  bucket: loomFilesTable.bucket,
  objectKey: loomFilesTable.objectKey,
  ownerType: loomFilesTable.ownerType,
  ownerId: loomFilesTable.ownerId,
  visibility: loomFilesTable.visibility,
  deletedAt: loomFilesTable.deletedAt,
  snapshotFileId: legacyFileSnapshots.fileId,
  sourceSystem: legacyFileSnapshots.sourceSystem,
  serializationVersion: legacyFileSnapshots.serializationVersion,
  sourceEjson: legacyFileSnapshots.sourceEjson,
  sourceSha256: legacyFileSnapshots.sourceSha256,
  legacyPublicPath: legacyFileSnapshots.legacyPublicPath,
  sourceStorageProvider: legacyFileSnapshots.sourceStorageProvider,
  sourceBucket: legacyFileSnapshots.sourceBucket,
  sourceObjectKey: legacyFileSnapshots.sourceObjectKey,
  sourceObjectKeyPrefix: legacyFileSnapshots.sourceObjectKeyPrefix,
};

function trusted(row: Record<string, unknown>): LegacyPublicFile | null {
  if (
    !isUuidV7(row.id) ||
    typeof row.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    typeof row.byteSize !== "number" ||
    !Number.isSafeInteger(row.byteSize) ||
    row.byteSize < 1 ||
    row.byteSize > MAX_LEGACY_PUBLIC_BYTES ||
    typeof row.contentType !== "string" ||
    !LEGACY_PUBLIC_TYPES.has(row.contentType) ||
    (row.originalFilename !== null &&
      typeof row.originalFilename !== "string") ||
    row.kind !== "image" ||
    row.visibility !== "public" ||
    row.ownerType !== null ||
    row.ownerId !== null ||
    row.deletedAt !== null ||
    row.snapshotFileId !== row.id ||
    row.sourceSystem !== "mongodb" ||
    row.serializationVersion !== "bson-canonical-ejson-v1" ||
    typeof row.storageProvider !== "string" ||
    !row.storageProvider ||
    row.storageProvider !== row.sourceStorageProvider ||
    typeof row.bucket !== "string" ||
    !row.bucket ||
    row.bucket !== row.sourceBucket ||
    typeof row.objectKey !== "string" ||
    !row.objectKey ||
    row.objectKey !== row.sourceObjectKey ||
    typeof row.sourceObjectKeyPrefix !== "string" ||
    row.objectKey !== `${row.sourceObjectKeyPrefix}${row.sha256}` ||
    row.legacyPublicPath !== `/api/file2?sha256=${row.sha256}` ||
    typeof row.sourceEjson !== "string" ||
    Buffer.byteLength(row.sourceEjson, "utf8") > 1024 * 1024 ||
    typeof row.sourceSha256 !== "string" ||
    createHash("sha256").update(row.sourceEjson, "utf8").digest("hex") !==
      row.sourceSha256
  )
    return null;
  let archived: unknown;
  try {
    archived = JSON.parse(row.sourceEjson);
  } catch {
    return null;
  }
  if (
    !archived ||
    typeof archived !== "object" ||
    Array.isArray(archived) ||
    (archived as Record<string, unknown>).sha256 !== row.sha256 ||
    (row.originalFilename !== null &&
      (!row.originalFilename.isWellFormed() ||
        row.originalFilename.includes("\0") ||
        row.originalFilename.length > 1024))
  )
    return null;
  return {
    id: row.id,
    sha256: row.sha256,
    byteSize: row.byteSize,
    contentType: row.contentType,
    originalFilename: row.originalFilename,
    storageProvider: row.storageProvider,
    bucket: row.bucket,
    objectKey: row.objectKey,
  };
}

/** Only rows joined to the exact protected legacy snapshot remain publicly readable. */
export function createSqlLegacyPublicFileReader(database: ReadDatabase) {
  return async (sha256: string): Promise<LegacyPublicFile | null> => {
    if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
    const [row] = await database
      .select(fields)
      .from(loomFilesTable)
      .innerJoin(
        legacyFileSnapshots,
        eq(legacyFileSnapshots.fileId, loomFilesTable.id),
      )
      .where(
        and(
          eq(loomFilesTable.sha256, sha256),
          eq(loomFilesTable.visibility, "public"),
          isNull(loomFilesTable.ownerType),
          isNull(loomFilesTable.ownerId),
          isNull(loomFilesTable.deletedAt),
        ),
      );
    return row ? trusted(row as Record<string, unknown>) : null;
  };
}

export function sameLegacyPublicFile(
  left: LegacyPublicFile,
  right: LegacyPublicFile,
) {
  return (Object.keys(left) as (keyof LegacyPublicFile)[]).every(
    (key) => left[key] === right[key],
  );
}
