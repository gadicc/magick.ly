import "server-only";

import {
  type LoomFileService,
  type LoomFileStorageAdapter,
  readLoomFileBodyBytes,
  sha256Hex,
} from "@gadicc/loom/files";
import type { RitualFileRecord } from "./repository";
import type { RitualFileLocator } from "./ritualFileLocator";
import { RITUAL_UPLOAD_MAX_BYTES } from "./ritualUploadProtocol";

export interface RitualFileRepositoryRead {
  findById(id: string): Promise<RitualFileRecord | null>;
}

export interface AuthorizedRitualFile {
  record: RitualFileRecord;
  bytes: Uint8Array;
}

function wipeBody(body: unknown) {
  if (body instanceof Uint8Array) body.fill(0);
  if (body && typeof body === "object" && "cancel" in body)
    void (body as ReadableStream).cancel().catch(() => {});
}

function loomBody(body: BodyInit) {
  if (
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof ReadableStream
  )
    return body;
  throw new TypeError("Unsupported ritual file body");
}

/** Reads exact bytes between two fresh association and policy checks. */
export function createAuthorizedRitualFileReader(options: {
  repository: RitualFileRepositoryRead;
  storage: LoomFileStorageAdapter;
  authorize(
    record: RitualFileRecord,
    locator: RitualFileLocator,
  ): Promise<boolean>;
}) {
  return async function read(
    locator: RitualFileLocator,
  ): Promise<AuthorizedRitualFile | null> {
    const first = await options.repository.findById(locator.fileId);
    if (!first || !(await options.authorize(first, locator))) return null;
    let object: Awaited<
      ReturnType<NonNullable<LoomFileStorageAdapter["getObject"]>>
    >;
    try {
      object =
        (await options.storage.getObject?.({
          bucket: first.bucket,
          objectKey: first.objectKey,
          record: first,
        })) ?? null;
    } catch {
      return null;
    }
    if (!object) return null;
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readLoomFileBodyBytes(loomBody(object.body), {
        maxBytes: Math.min(first.byteSize, RITUAL_UPLOAD_MAX_BYTES),
      });
      if (
        bytes.byteLength !== first.byteSize ||
        (object.byteSize !== undefined && object.byteSize !== first.byteSize) ||
        (object.contentType !== undefined &&
          object.contentType !== first.contentType) ||
        (await sha256Hex(bytes)) !== first.sha256
      )
        return null;
      const second = await options.repository.findById(locator.fileId);
      if (
        !second ||
        second.ritualId !== first.ritualId ||
        second.attachmentId !== first.attachmentId ||
        second.operationId !== first.operationId ||
        second.sha256 !== first.sha256 ||
        second.byteSize !== first.byteSize ||
        second.contentType !== first.contentType ||
        second.bucket !== first.bucket ||
        second.objectKey !== first.objectKey ||
        !(await options.authorize(second, locator))
      )
        return null;
      const owned = Uint8Array.from(bytes);
      return { record: second, bytes: owned };
    } catch {
      return null;
    } finally {
      bytes?.fill(0);
      wipeBody(object.body);
    }
  };
}

/** Read-only Loom service for the managed route; every download gets a post-I/O recheck. */
export function createRitualFileLoomService(options: {
  repository: RitualFileRepositoryRead;
  readAuthorized(
    locator: RitualFileLocator,
  ): Promise<AuthorizedRitualFile | null>;
}): LoomFileService<RitualFileRecord> {
  return {
    async getFileById(id) {
      const record = await options.repository.findById(id);
      // Inline delivery does not need an uploader-supplied filename, and omitting
      // it also keeps disposition construction ASCII-safe for every locale.
      return record ? { ...record, originalFilename: null } : null;
    },
    async getFileBySha256() {
      return null;
    },
    async getDownloadObject(record) {
      const result = await options.readAuthorized({
        ritualId: record.ritualId,
        attachmentId: record.attachmentId,
        fileId: record.id,
      });
      if (!result) throw new Error("Ritual file unavailable");
      return {
        body: new Blob([result.bytes.slice().buffer]),
        byteSize: result.record.byteSize,
        contentType: result.record.contentType,
        etag: `\"${result.record.sha256}\"`,
      };
    },
    async saveFile() {
      throw new Error("Generic ritual file writes are disabled");
    },
  };
}
