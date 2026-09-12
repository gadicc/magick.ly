import type {
  LoomFileBody,
  LoomFileCreateInput,
  LoomFileRecord,
  LoomFileStorageAdapter,
} from "@gadicc/loom/files";
import type {
  InitiateRitualUpload,
  RitualImageType,
  RitualUploadCode,
  RitualUploadReceipt,
} from "./ritualUploadProtocol";

/** Server-created locations; these never arrive from a finalize request. */
export interface RitualUploadLocation {
  provider: string;
  bucket: string;
  objectKey: string;
}
/** Persisted immutable intent plus its current worker lease. This is not an authorization grant. */
export interface RitualUploadClaim {
  request: InitiateRitualUpload;
  fileId: string;
  attachmentId: string;
  staging: RitualUploadLocation;
  canonical: RitualUploadLocation;
  intentExpiresAtMs: number;
  claimId: string;
  claimExpiresAtMs: number;
}
/** Real decoder evidence, including every frame rather than just image headers. */
export interface ValidatedRitualImage {
  contentType: RitualImageType;
  width: number;
  frameHeight: number;
  frames: number;
  decodedPixels: number;
}
/**
 * SQL adapter contract: both claim/replay and commit must resolve current persisted
 * grants. Commit inserts the file, parent link and receipt in ONE transaction, with
 * the live claim token fenced. No file may be inserted outside this callback.
 * Replay checks current parent/attachment existence and access; it never resurrects.
 */
export interface RitualUploadPublication {
  claimAuthorized(
    input: { operationId: string; actorId: string; nowMs: number },
    signal: AbortSignal,
  ): Promise<
    | { kind: "claimed"; claim: RitualUploadClaim }
    | { kind: "completed"; receipt: RitualUploadReceipt }
  >;
  findBySha256(
    sha256: string,
    signal: AbortSignal,
  ): Promise<LoomFileRecord | null>;
  commitAuthorized(
    input: {
      claim: RitualUploadClaim;
      actorId: string;
      file: LoomFileCreateInput;
      image: ValidatedRitualImage;
    },
    signal: AbortSignal,
  ): Promise<{ record: LoomFileRecord; receipt: RitualUploadReceipt }>;
  /** Best-effort fenced release; if it fails the lease must expire, not unlock a newer worker. */
  releaseClaim(
    claim: RitualUploadClaim,
    code: RitualUploadCode,
    signal: AbortSignal,
  ): Promise<void>;
}
/** A provider response must support cancellation of the underlying stream even while Loom owns its reader. */
export interface RitualStagingObject {
  body: LoomFileBody;
  byteSize?: number;
  close(): void;
}
/**
 * Provider-specific construction remains deferred. Canonical storage must use
 * conditional writes and reconcile only this claim's owned key on a verified retry.
 * It must never expose canonical writes through the direct-upload capability.
 */
export interface RitualUploadStorage {
  readStaging(
    claim: RitualUploadClaim,
    signal: AbortSignal,
  ): Promise<RitualStagingObject | null>;
  canonicalStorage(
    claim: RitualUploadClaim,
    signal: AbortSignal,
  ): LoomFileStorageAdapter;
}
export interface RitualImageValidator {
  validate(
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<ValidatedRitualImage>;
}
