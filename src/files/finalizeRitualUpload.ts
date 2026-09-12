import "server-only";

import {
  assertExpectedSha256,
  createLoomFileService,
  detectLoomFileMetadata,
  type LoomFileCreateInput,
  LoomFileDuplicateError,
  type LoomFileRecord,
  readLoomFileBodyBytes,
  sha256Hex,
} from "@gadicc/loom/files";
import type {
  RitualImageValidator,
  RitualStagingObject,
  RitualUploadClaim,
  RitualUploadPublication,
  RitualUploadStorage,
  ValidatedRitualImage,
} from "./ritualUploadContracts";
import {
  isCanonicalUploadId,
  isRitualImageType,
  parseFinalizeRitualUpload,
  parseInitiateRitualUpload,
  RITUAL_IMAGE_LIMITS,
  RITUAL_UPLOAD_MAX_BYTES,
  type RitualUploadCode,
  RitualUploadError,
  type RitualUploadReceipt,
  type RitualUploadResult,
} from "./ritualUploadProtocol";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RitualUploadError("ABORTED"));
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
function fail(code: RitualUploadCode): never {
  throw new RitualUploadError(code);
}
function instant(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}
function validImage(image: ValidatedRitualImage) {
  return (
    image &&
    isRitualImageType(image.contentType) &&
    [image.width, image.frameHeight, image.frames, image.decodedPixels].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) &&
    image.width <= RITUAL_IMAGE_LIMITS.maxDimension &&
    image.frameHeight <= RITUAL_IMAGE_LIMITS.maxDimension &&
    image.frames <= RITUAL_IMAGE_LIMITS.maxFrames &&
    image.decodedPixels === image.width * image.frameHeight * image.frames &&
    image.decodedPixels <= RITUAL_IMAGE_LIMITS.maxPixels
  );
}
function validateClaim(
  claim: RitualUploadClaim,
  operationId: string,
  actorId: string,
  nowMs: number,
) {
  if (
    !claim ||
    !parseInitiateRitualUpload(claim.request) ||
    claim.request.operationId !== operationId ||
    claim.request.expectedActorId !== actorId ||
    !isCanonicalUploadId(claim.fileId) ||
    !isCanonicalUploadId(claim.attachmentId) ||
    !isCanonicalUploadId(claim.claimId) ||
    !instant(claim.intentExpiresAtMs) ||
    !instant(claim.claimExpiresAtMs) ||
    ![claim.staging, claim.canonical].every(
      (location) =>
        location &&
        [location.provider, location.bucket, location.objectKey].every(
          (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            !value.includes("\0"),
        ),
    ) ||
    (claim.staging.provider === claim.canonical.provider &&
      claim.staging.bucket === claim.canonical.bucket &&
      claim.staging.objectKey === claim.canonical.objectKey)
  )
    fail("UNAVAILABLE");
  if (claim.intentExpiresAtMs <= nowMs || claim.claimExpiresAtMs <= nowMs)
    fail("EXPIRED");
}
function receiptMatches(
  receipt: RitualUploadReceipt,
  operationId: string,
  actorId: string,
  claim?: RitualUploadClaim,
) {
  return (
    receipt &&
    receipt.operationId === operationId &&
    receipt.actorId === actorId &&
    [receipt.ritualId, receipt.fileId, receipt.attachmentId].every(
      isCanonicalUploadId,
    ) &&
    Number.isSafeInteger(receipt.byteSize) &&
    receipt.byteSize > 0 &&
    receipt.byteSize <= RITUAL_UPLOAD_MAX_BYTES &&
    isRitualImageType(receipt.contentType) &&
    /^[a-f0-9]{64}$/.test(receipt.sha256) &&
    instant(receipt.completedAtMs) &&
    (!claim ||
      (receipt.ritualId === claim.request.ritualId &&
        receipt.fileId === claim.fileId &&
        receipt.attachmentId === claim.attachmentId &&
        receipt.sha256 === claim.request.sha256 &&
        receipt.byteSize === claim.request.byteSize &&
        receipt.contentType === claim.request.contentType))
  );
}
function errorCode(error: unknown): RitualUploadCode {
  if (error instanceof RitualUploadError) return error.code;
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "duplicate_file") return "DUPLICATE";
  if (code === "size_limit_exceeded") return "TOO_LARGE";
  if (code === "digest_mismatch") return "DIGEST_MISMATCH";
  return "UNAVAILABLE";
}
function outcome(code: RitualUploadCode): RitualUploadResult {
  return {
    ok: false,
    code,
    retryable: [
      "BUSY",
      "NOT_UPLOADED",
      "ABORTED",
      "TIMEOUT",
      "UNAVAILABLE",
    ].includes(code),
  };
}
/**
 * Performs bounded byte validation and delegates storage to Loom. Its repository
 * insert callback rechecks identity and commits file/link/receipt after provider I/O.
 * SQL locks and storage reconciliation are required adapter contracts, not supplied
 * by this transport-neutral service. No generic upload route should call saveFile directly.
 */
export function createRitualUploadFinalizer(options: {
  readVerifiedActorId: () => Promise<string | null>;
  publication: RitualUploadPublication;
  storage: RitualUploadStorage;
  imageValidator: RitualImageValidator;
  now?: () => number;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Invalid finalization timeout");
  const now = options.now ?? Date.now;
  return async (
    input: unknown,
    signal?: AbortSignal,
  ): Promise<RitualUploadResult> => {
    const request = parseFinalizeRitualUpload(input);
    if (!request) return outcome("INVALID_REQUEST");
    if (signal?.aborted) return outcome("ABORTED");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const active = controller.signal;
    let claim: RitualUploadClaim | undefined;
    let failed: RitualUploadCode | undefined;
    let stagedResponse: RitualStagingObject | undefined;
    function closeStaging() {
      const response = stagedResponse;
      stagedResponse = undefined;
      try {
        response?.close();
      } catch {
        /* Cleanup cannot expose provider errors or replace the command outcome. */
      }
    }
    async function actor() {
      const id = await abortable(options.readVerifiedActorId(), active);
      if (!isCanonicalUploadId(id)) fail("AUTH_REQUIRED");
      if (id !== request!.expectedActorId) fail("ACTOR_CHANGED");
      return id;
    }
    try {
      const actorId = await actor();
      const state = await abortable(
        options.publication.claimAuthorized(
          { operationId: request.operationId, actorId, nowMs: now() },
          active,
        ),
        active,
      );
      if (state.kind === "completed") {
        if (!receiptMatches(state.receipt, request.operationId, actorId))
          fail("UNAVAILABLE");
        return { ok: true, replayed: true, receipt: state.receipt };
      }
      claim = state.claim;
      validateClaim(claim, request.operationId, actorId, now());
      const ownedClaim = claim;
      const staged = await abortable(
        options.storage.readStaging(ownedClaim, active).then((object) => {
          // A provider may settle after cancellation. Close that late response too,
          // because the normal byte-reader finally block never receives it.
          stagedResponse = object ?? undefined;
          if (active.aborted) closeStaging();
          return object;
        }),
        active,
      );
      if (!staged) fail("NOT_UPLOADED");
      let bytes: Uint8Array;
      try {
        if (
          staged.byteSize !== undefined &&
          (!Number.isSafeInteger(staged.byteSize) ||
            staged.byteSize < 1 ||
            staged.byteSize > RITUAL_UPLOAD_MAX_BYTES)
        )
          fail("TOO_LARGE");
        bytes = await abortable(
          readLoomFileBodyBytes(staged.body, {
            maxBytes: RITUAL_UPLOAD_MAX_BYTES,
          }),
          active,
        );
      } finally {
        closeStaging();
      }
      if (bytes.byteLength !== ownedClaim.request.byteSize)
        fail("SIZE_MISMATCH");
      assertExpectedSha256(
        await abortable(sha256Hex(bytes), active),
        ownedClaim.request.sha256,
      );
      const detected = detectLoomFileMetadata(bytes);
      if (
        !isRitualImageType(detected.detectedContentType) ||
        detected.detectedContentType !== ownedClaim.request.contentType
      )
        fail("UNSUPPORTED_TYPE");
      const image = await abortable(
        options.imageValidator.validate(bytes, active),
        active,
      );
      if (!validImage(image)) fail("IMAGE_LIMIT");
      if (image.contentType !== detected.detectedContentType)
        fail("INVALID_IMAGE");
      const storage = options.storage.canonicalStorage(ownedClaim, active);
      if (
        storage.provider !== ownedClaim.canonical.provider ||
        storage.bucket !== ownedClaim.canonical.bucket
      )
        fail("UNAVAILABLE");
      let receipt: RitualUploadReceipt | undefined;
      const service = createLoomFileService({
        storage,
        duplicatePolicy: "reject",
        repository: {
          findBySha256: async (sha256) => {
            const existing = await abortable(
              options.publication.findBySha256(sha256, active),
              active,
            );
            // Managed uniqueness also covers deleted rows; never write an orphan for
            // a tombstoned digest while a restore/reuse policy is still undefined.
            if (existing?.deletedAt) throw new LoomFileDuplicateError();
            return existing;
          },
          insert: async (
            file: LoomFileCreateInput,
          ): Promise<LoomFileRecord> => {
            if (active.aborted) fail(timedOut ? "TIMEOUT" : "ABORTED");
            validateClaim(ownedClaim, request.operationId, actorId, now());
            if (
              file.objectKey !== ownedClaim.canonical.objectKey ||
              file.bucket !== ownedClaim.canonical.bucket ||
              file.storageProvider !== ownedClaim.canonical.provider ||
              file.sha256 !== ownedClaim.request.sha256 ||
              file.byteSize !== ownedClaim.request.byteSize ||
              file.visibility !== "private" ||
              file.ownerId !== actorId
            )
              fail("UNAVAILABLE");
            const currentActorId = await actor();
            const committed = await abortable(
              options.publication.commitAuthorized(
                {
                  claim: ownedClaim,
                  actorId: currentActorId,
                  file: {
                    ...file,
                    originalFilename: ownedClaim.request.filename,
                  },
                  image,
                },
                active,
              ),
              active,
            );
            if (
              !receiptMatches(
                committed.receipt,
                request.operationId,
                actorId,
                ownedClaim,
              ) ||
              committed.record.id !== ownedClaim.fileId
            )
              fail("UNAVAILABLE");
            receipt = committed.receipt;
            return committed.record;
          },
        },
      });
      await abortable(
        service.saveFile({
          body: bytes,
          maxBytes: RITUAL_UPLOAD_MAX_BYTES,
          expectedSha256: ownedClaim.request.sha256,
          contentType: image.contentType,
          originalFilename: ownedClaim.request.filename,
          objectKey: ownedClaim.canonical.objectKey,
          ownerType: "user",
          ownerId: actorId,
          visibility: "private",
          meta: {},
        }),
        active,
      );
      if (!receipt) fail("UNAVAILABLE");
      return { ok: true, replayed: false, receipt };
    } catch (error) {
      failed = timedOut
        ? "TIMEOUT"
        : active.aborted
          ? "ABORTED"
          : errorCode(error);
      return outcome(failed);
    } finally {
      closeStaging();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
      if (claim && failed) {
        const releaseSignal = AbortSignal.timeout(1000);
        try {
          await abortable(
            options.publication.releaseClaim(claim, failed, releaseSignal),
            releaseSignal,
          );
        } catch {
          /* The fenced lease remains the recovery boundary. */
        }
      }
    }
  };
}
