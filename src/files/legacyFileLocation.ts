import "server-only";

import type {
  legacyFileRelocations,
  legacyFileSnapshots,
} from "../db/schema/legacyFiles";
import type { loomFilesTable } from "../db/schema/loomFiles";

export const LEGACY_FILE_RELOCATION_BUCKET = "magickli-files-production";
export const LEGACY_FILE_RELOCATION_PREFIX = "legacy-file2/";
export const LEGACY_FILE_RELOCATION_PROFILE =
  "magickli-legacy-file-relocation-v1";

type FileIdentity = Pick<
  typeof loomFilesTable.$inferSelect,
  "id" | "sha256" | "byteSize"
>;
type SourceIdentity = Pick<
  typeof legacyFileSnapshots.$inferSelect,
  | "fileId"
  | "sourceStorageProvider"
  | "sourceBucket"
  | "sourceObjectKey"
  | "sourceSha256"
  | "importedAt"
>;

export interface LegacyFileStorageLocation {
  storageProvider: string;
  bucket: string;
  objectKey: string;
  relocationVerified: boolean;
}

/**
 * Selects a relocation only when its complete verification record still binds
 * the imported source and current content identity. A malformed present record
 * is rejected rather than silently falling back to the old object.
 */
export function resolveLegacyFileStorageLocation(
  file: FileIdentity,
  snapshot: SourceIdentity,
  relocation: typeof legacyFileRelocations.$inferSelect | null | undefined,
): LegacyFileStorageLocation | null {
  if (!relocation)
    return {
      storageProvider: snapshot.sourceStorageProvider,
      bucket: snapshot.sourceBucket,
      objectKey: snapshot.sourceObjectKey,
      relocationVerified: false,
    };
  if (
    relocation.fileId !== file.id ||
    snapshot.fileId !== file.id ||
    relocation.sourceStorageProvider !== snapshot.sourceStorageProvider ||
    relocation.sourceBucket !== snapshot.sourceBucket ||
    relocation.sourceObjectKey !== snapshot.sourceObjectKey ||
    relocation.sourceMetadataSha256 !== snapshot.sourceSha256 ||
    relocation.contentSha256 !== file.sha256 ||
    relocation.byteSize !== file.byteSize ||
    relocation.destinationStorageProvider !== "r2" ||
    relocation.destinationBucket !== LEGACY_FILE_RELOCATION_BUCKET ||
    relocation.destinationObjectKey !==
      `${LEGACY_FILE_RELOCATION_PREFIX}${file.sha256}` ||
    relocation.verificationProfile !== LEGACY_FILE_RELOCATION_PROFILE ||
    !(relocation.verifiedAt instanceof Date) ||
    !Number.isFinite(relocation.verifiedAt.getTime()) ||
    relocation.verifiedAt.getTime() < 0 ||
    !(snapshot.importedAt instanceof Date) ||
    !Number.isFinite(snapshot.importedAt.getTime()) ||
    relocation.verifiedAt < snapshot.importedAt ||
    (relocation.sourceStorageProvider ===
      relocation.destinationStorageProvider &&
      relocation.sourceBucket === relocation.destinationBucket &&
      relocation.sourceObjectKey === relocation.destinationObjectKey)
  )
    return null;
  return {
    storageProvider: relocation.destinationStorageProvider,
    bucket: relocation.destinationBucket,
    objectKey: relocation.destinationObjectKey,
    relocationVerified: true,
  };
}
