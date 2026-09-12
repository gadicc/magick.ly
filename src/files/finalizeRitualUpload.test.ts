import {
  type LoomFileRecord,
  type LoomFileStoragePutInput,
  sha256Hex,
} from "@gadicc/loom/files";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { createRitualUploadFinalizer } from "./finalizeRitualUpload";
import type {
  RitualStagingObject,
  RitualUploadClaim,
  RitualUploadPublication,
} from "./ritualUploadContracts";
import {
  RITUAL_UPLOAD_MAX_BYTES,
  RitualUploadError,
  type RitualUploadReceipt,
} from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

vi.mock("server-only", () => ({}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function fixture() {
  const bytes = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const actorId = createUuidV7();
  const request = {
    version: 1 as const,
    operationId: createUuidV7(),
    expectedActorId: actorId,
  };
  const nowMs = Date.now();
  const claim: RitualUploadClaim = {
    request: {
      ...request,
      ritualId: createUuidV7(),
      filename: "\ufeff 守護\r\nimage.png ",
      byteSize: bytes.length,
      contentType: "image/png",
      sha256: await sha256Hex(bytes),
    },
    fileId: createUuidV7(),
    attachmentId: createUuidV7(),
    claimId: createUuidV7(),
    staging: {
      provider: "memory",
      bucket: "private-test",
      objectKey: "staging/owned-operation",
    },
    canonical: {
      provider: "memory",
      bucket: "private-test",
      objectKey: "canonical/owned-operation",
    },
    intentExpiresAtMs: nowMs + 600_000,
    claimExpiresAtMs: nowMs + 120_000,
  };
  const receipt: RitualUploadReceipt = {
    operationId: request.operationId,
    actorId,
    ritualId: claim.request.ritualId,
    fileId: claim.fileId,
    attachmentId: claim.attachmentId,
    sha256: claim.request.sha256,
    byteSize: bytes.length,
    contentType: "image/png",
    completedAtMs: nowMs,
  };
  const events: string[] = [];
  const objects = new Map<string, Uint8Array>();
  const records: LoomFileRecord[] = [];
  let completed: RitualUploadReceipt | undefined;
  let authorized = true;
  const close = vi.fn();
  const readVerifiedActorId = vi.fn(async () => actorId as string | null);
  const claimAuthorized = vi.fn<RitualUploadPublication["claimAuthorized"]>(
    async () => {
      events.push("authorize-claim");
      if (!authorized) throw new RitualUploadError("FORBIDDEN");
      return completed
        ? { kind: "completed", receipt: completed }
        : { kind: "claimed", claim };
    },
  );
  const findBySha256 = vi.fn<RitualUploadPublication["findBySha256"]>(
    async () => records[0] ?? null,
  );
  const commitAuthorized = vi.fn<RitualUploadPublication["commitAuthorized"]>(
    async ({ file }) => {
      events.push("authorize-commit");
      if (!authorized) throw new RitualUploadError("FORBIDDEN");
      const record: LoomFileRecord = {
        ...file,
        id: claim.fileId,
        bucket: file.bucket ?? null,
        contentType: file.contentType ?? null,
        detectedContentType: file.detectedContentType ?? null,
        audioMeta: null,
        imageMeta: file.imageMeta ?? null,
        meta: file.meta ?? {},
        originalFilename: file.originalFilename ?? null,
        ownerType: file.ownerType ?? null,
        ownerId: file.ownerId ?? null,
        visibility: file.visibility ?? "private",
      };
      records.push(record);
      completed = receipt;
      return { record, receipt };
    },
  );
  const releaseClaim = vi.fn<RitualUploadPublication["releaseClaim"]>(
    async () => {},
  );
  const readStaging = vi.fn(
    async (): Promise<RitualStagingObject | null> => ({
      body: bytes,
      byteSize: bytes.length,
      close,
    }),
  );
  const putObject = vi.fn(async (input: LoomFileStoragePutInput) => {
    events.push("store");
    objects.set(input.objectKey, new Uint8Array(input.body));
    return { ...claim.canonical };
  });
  const canonicalStorage = vi.fn(() => ({
    provider: claim.canonical.provider,
    bucket: claim.canonical.bucket,
    putObject,
  }));
  const options = {
    readVerifiedActorId,
    publication: {
      claimAuthorized,
      findBySha256,
      commitAuthorized,
      releaseClaim,
    },
    storage: { readStaging, canonicalStorage },
    imageValidator: createSharpRitualImageValidator(),
    now: () => nowMs,
  };
  return {
    bytes,
    request,
    actorId,
    claim,
    receipt,
    events,
    objects,
    records,
    close,
    readVerifiedActorId,
    claimAuthorized,
    findBySha256,
    commitAuthorized,
    releaseClaim,
    readStaging,
    putObject,
    canonicalStorage,
    options,
    finalize: createRitualUploadFinalizer(options),
    demote: () => {
      authorized = false;
    },
    regrant: () => {
      authorized = true;
    },
  };
}
const failure = (code: string, retryable = false) => ({
  ok: false,
  code,
  retryable,
});
afterEach(() => vi.useRealTimers());

describe("ritual upload finalization using the installed Loom service", () => {
  it("validates exact bytes, stores privately, then commits exact filename and attachment receipt", async () => {
    const f = await fixture();
    expect(await f.finalize(f.request)).toEqual({
      ok: true,
      replayed: false,
      receipt: f.receipt,
    });
    expect(f.events).toEqual(["authorize-claim", "store", "authorize-commit"]);
    expect(f.objects.get(f.claim.canonical.objectKey)).toEqual(
      new Uint8Array(f.bytes),
    );
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      originalFilename: f.claim.request.filename,
      ownerId: f.actorId,
      ownerType: "user",
      visibility: "private",
      meta: {},
      sha256: f.claim.request.sha256,
    });
    expect(f.commitAuthorized.mock.calls[0][0].image).toEqual({
      contentType: "image/png",
      width: 3,
      frameHeight: 2,
      frames: 1,
      decodedPixels: 6,
    });
    expect(f.readVerifiedActorId).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.releaseClaim).not.toHaveBeenCalled();
  });
  it("returns the same receipt after an uncertain acknowledgement without re-reading or storing bytes", async () => {
    const f = await fixture();
    await f.finalize(f.request);
    expect(await f.finalize(f.request)).toEqual({
      ok: true,
      replayed: true,
      receipt: f.receipt,
    });
    expect(f.readStaging).toHaveBeenCalledOnce();
    expect(f.putObject).toHaveBeenCalledOnce();
    expect(f.records).toHaveLength(1);
    f.demote();
    expect(await f.finalize(f.request)).toEqual(failure("FORBIDDEN"));
    expect(f.putObject).toHaveBeenCalledOnce();
  });
  it("rejects injected storage and actor fields before reading server identity", async () => {
    const f = await fixture();
    expect(await f.finalize({ ...f.request, objectKey: "other-file" })).toEqual(
      failure("INVALID_REQUEST"),
    );
    expect(f.readVerifiedActorId).not.toHaveBeenCalled();
  });
  it.each([null, "legacy-session-id", "changed"])(
    "rejects absent, noncanonical or changed verified identity: %s",
    async (identity) => {
      const f = await fixture();
      f.readVerifiedActorId.mockResolvedValue(
        identity === "changed" ? createUuidV7() : identity,
      );
      expect(await f.finalize(f.request)).toEqual(
        failure(identity === "changed" ? "ACTOR_CHANGED" : "AUTH_REQUIRED"),
      );
      expect(f.claimAuthorized).not.toHaveBeenCalled();
      expect(f.putObject).not.toHaveBeenCalled();
    },
  );
  it("denies an editor demoted during provider IO without publishing partial metadata", async () => {
    const f = await fixture();
    const put = f.putObject.getMockImplementation()!;
    f.putObject.mockImplementation(async (input) => {
      const value = await put(input);
      f.demote();
      return value;
    });
    expect(await f.finalize(f.request)).toEqual(failure("FORBIDDEN"));
    expect(f.objects.size).toBe(1);
    expect(f.records).toHaveLength(0);
    expect(f.releaseClaim).toHaveBeenCalledWith(
      f.claim,
      "FORBIDDEN",
      expect.any(AbortSignal),
    );
  });
  it("rechecks verified actor after bytes are stored before entering the commit callback", async () => {
    const f = await fixture();
    f.readVerifiedActorId
      .mockResolvedValueOnce(f.actorId)
      .mockResolvedValueOnce(createUuidV7());
    expect(await f.finalize(f.request)).toEqual(failure("ACTOR_CHANGED"));
    expect(f.putObject).toHaveBeenCalledOnce();
    expect(f.commitAuthorized).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(0);
  });
  it.each(["intent", "lease"])(
    "rejects expired %s before reading bytes",
    async (field) => {
      const f = await fixture();
      f.claim[field === "intent" ? "intentExpiresAtMs" : "claimExpiresAtMs"] =
        f.options.now();
      expect(await f.finalize(f.request)).toEqual(failure("EXPIRED"));
      expect(f.readStaging).not.toHaveBeenCalled();
    },
  );
  it("rejects a lease that expires during storage instead of publishing", async () => {
    const f = await fixture();
    const put = f.putObject.getMockImplementation()!;
    f.putObject.mockImplementation(async (input) => {
      const value = await put(input);
      f.claim.claimExpiresAtMs = f.options.now();
      return value;
    });
    expect(await f.finalize(f.request)).toEqual(failure("EXPIRED"));
    expect(f.commitAuthorized).not.toHaveBeenCalled();
  });
  it("returns retryable not-uploaded and releases the claim without publishing", async () => {
    const f = await fixture();
    f.readStaging.mockResolvedValue(null);
    expect(await f.finalize(f.request)).toEqual(failure("NOT_UPLOADED", true));
    expect(f.putObject).not.toHaveBeenCalled();
  });
  it.each(["reported", "streamed"])(
    "enforces the compressed-byte limit against %s oversize input",
    async (method) => {
      const f = await fixture();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(RITUAL_UPLOAD_MAX_BYTES));
          controller.enqueue(Uint8Array.of(1));
          controller.close();
        },
      });
      f.readStaging.mockResolvedValue({
        body,
        ...(method === "reported"
          ? { byteSize: RITUAL_UPLOAD_MAX_BYTES + 1 }
          : {}),
        close: f.close,
      });
      expect(await f.finalize(f.request)).toEqual(failure("TOO_LARGE"));
      expect(f.close).toHaveBeenCalledOnce();
      expect(f.putObject).not.toHaveBeenCalled();
    },
  );
  it.each(["size", "digest", "mime"] as const)(
    "rejects mismatching %s claims before canonical storage",
    async (mismatch) => {
      const f = await fixture();
      if (mismatch === "size") f.claim.request.byteSize++;
      if (mismatch === "digest") f.claim.request.sha256 = "a".repeat(64);
      if (mismatch === "mime") f.claim.request.contentType = "image/jpeg";
      expect(await f.finalize(f.request)).toEqual(
        failure(
          {
            size: "SIZE_MISMATCH",
            digest: "DIGEST_MISMATCH",
            mime: "UNSUPPORTED_TYPE",
          }[mismatch],
        ),
      );
      expect(f.putObject).not.toHaveBeenCalled();
      expect(f.records).toHaveLength(0);
    },
  );
  it.each([false, true])(
    "rejects another operation's digest, including deleted=%s, without exposing its record",
    async (deleted) => {
      const f = await fixture();
      await f.finalize(f.request);
      const existing = {
        ...f.records[0],
        id: createUuidV7(),
        ownerId: createUuidV7(),
        deletedAt: deleted ? new Date() : null,
      };
      const g = await fixture();
      g.findBySha256.mockResolvedValue(existing);
      const result = await g.finalize(g.request);
      expect(result).toEqual(failure("DUPLICATE"));
      expect(JSON.stringify(result)).not.toContain(existing.id);
      expect(g.putObject).not.toHaveBeenCalled();
    },
  );
  it("does not trust a provider's returned object location", async () => {
    const f = await fixture();
    f.putObject.mockResolvedValue({
      ...f.claim.canonical,
      objectKey: "some-other-operation",
    });
    expect(await f.finalize(f.request)).toEqual(failure("UNAVAILABLE", true));
    expect(f.commitAuthorized).not.toHaveBeenCalled();
  });
  it("maps provider and transaction errors to safe retryable results", async () => {
    for (const phase of ["read", "put", "commit"] as const) {
      const f = await fixture();
      const fail = async () => {
        throw new Error("private endpoint or SQL secret");
      };
      if (phase === "read") f.readStaging.mockImplementation(fail);
      if (phase === "put") f.putObject.mockImplementation(fail);
      if (phase === "commit") f.commitAuthorized.mockImplementation(fail);
      expect(await f.finalize(f.request)).toEqual(failure("UNAVAILABLE", true));
      expect(f.records).toHaveLength(0);
    }
  });
  it("stores the verified response snapshot even if the staging object is subsequently replaced", async () => {
    const f = await fixture();
    const replacement = Buffer.from("different later staging bytes");
    const actual = createSharpRitualImageValidator();
    const finalize = createRitualUploadFinalizer({
      ...f.options,
      imageValidator: {
        validate: async (bytes, signal) => {
          f.readStaging.mockResolvedValue({
            body: replacement,
            byteSize: replacement.length,
            close: f.close,
          });
          return actual.validate(bytes, signal);
        },
      },
    });
    expect(await finalize(f.request)).toMatchObject({ ok: true });
    expect(f.readStaging).toHaveBeenCalledOnce();
    expect(f.objects.get(f.claim.canonical.objectKey)).toEqual(
      new Uint8Array(f.bytes),
    );
  });
  it("fails closed for an invalid server claim or mismatched storage adapter", async () => {
    const f = await fixture();
    f.claim.canonical = { ...f.claim.staging };
    expect(await f.finalize(f.request)).toEqual(failure("UNAVAILABLE", true));
    expect(f.readStaging).not.toHaveBeenCalled();
    const g = await fixture();
    g.canonicalStorage.mockReturnValue({
      provider: "wrong-provider",
      bucket: g.claim.canonical.bucket,
      putObject: g.putObject,
    });
    expect(await g.finalize(g.request)).toEqual(failure("UNAVAILABLE", true));
    expect(g.putObject).not.toHaveBeenCalled();
  });
  it("rejects inconsistent decoder MIME and mismatched commit receipts", async () => {
    const f = await fixture();
    const finalize = createRitualUploadFinalizer({
      ...f.options,
      imageValidator: {
        validate: async () => ({
          contentType: "image/jpeg",
          width: 3,
          frameHeight: 2,
          frames: 1,
          decodedPixels: 6,
        }),
      },
    });
    expect(await finalize(f.request)).toEqual(failure("INVALID_IMAGE"));
    expect(f.putObject).not.toHaveBeenCalled();
    const g = await fixture();
    const commit = g.commitAuthorized.getMockImplementation()!;
    g.commitAuthorized.mockImplementation(async (input, signal) => {
      const value = await commit(input, signal);
      return {
        ...value,
        receipt: { ...value.receipt, attachmentId: createUuidV7() },
      };
    });
    expect(await g.finalize(g.request)).toEqual(failure("UNAVAILABLE", true));
  });
  it("rejects invalid decoder evidence instead of passing it to persistence", async () => {
    const f = await fixture();
    const finalize = createRitualUploadFinalizer({
      ...f.options,
      imageValidator: {
        validate: async () => ({
          contentType: "image/png",
          width: 1,
          frameHeight: 1,
          frames: 257,
          decodedPixels: 257,
        }),
      },
    });
    expect(await finalize(f.request)).toEqual(failure("IMAGE_LIMIT"));
    expect(f.putObject).not.toHaveBeenCalled();
  });
  it("does not re-expose a receipt bound to another actor", async () => {
    const f = await fixture();
    f.claimAuthorized.mockResolvedValue({
      kind: "completed",
      receipt: { ...f.receipt, actorId: createUuidV7() },
    });
    expect(await f.finalize(f.request)).toEqual(failure("UNAVAILABLE", true));
    expect(f.putObject).not.toHaveBeenCalled();
  });
});

describe("bounded cancellation and cleanup", () => {
  it("does no work when already aborted", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.finalize(f.request, controller.signal)).toEqual(
      failure("ABORTED", true),
    );
    expect(f.readVerifiedActorId).not.toHaveBeenCalled();
  });
  it("closes a hanging staging stream when the caller aborts", async () => {
    const f = await fixture();
    const opened = deferred<void>();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const close = vi.fn(() => source.error(new Error("closed")));
    f.readStaging.mockImplementation(async () => {
      opened.resolve();
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
          },
        }),
        close,
      };
    });
    const controller = new AbortController();
    const pending = f.finalize(f.request, controller.signal);
    await opened.promise;
    // Let the service acquire the stream before aborting.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(await pending).toEqual(failure("ABORTED", true));
    expect(close).toHaveBeenCalledOnce();
    expect(f.putObject).not.toHaveBeenCalled();
  });
  it("closes a late provider response after its request already timed out", async () => {
    const f = await fixture();
    const read = deferred<RitualStagingObject | null>();
    const started = deferred<void>();
    f.readStaging.mockImplementation(() => {
      started.resolve();
      return read.promise;
    });
    vi.useFakeTimers();
    const pending = createRitualUploadFinalizer({
      ...f.options,
      timeoutMs: 50,
    })(f.request);
    await started.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual(failure("TIMEOUT", true));
    read.resolve({ body: f.bytes, close: f.close });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.putObject).not.toHaveBeenCalled();
  });
  it("times out an unresponsive decoder, then ignores its late rejection without storing", async () => {
    const f = await fixture();
    const decode = deferred<never>();
    const started = deferred<void>();
    const finalize = createRitualUploadFinalizer({
      ...f.options,
      timeoutMs: 50,
      imageValidator: {
        validate: () => {
          started.resolve();
          return decode.promise;
        },
      },
    });
    vi.useFakeTimers();
    const pending = finalize(f.request);
    await started.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual(failure("TIMEOUT", true));
    decode.reject(new Error("late decoder failure"));
    await Promise.resolve();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.putObject).not.toHaveBeenCalled();
  });
  it("cannot publish after cancellation during a late provider write", async () => {
    const f = await fixture();
    const started = deferred<void>();
    const put = deferred<{
      provider: string;
      bucket: string;
      objectKey: string;
    }>();
    f.putObject.mockImplementation(() => {
      started.resolve();
      return put.promise;
    });
    const controller = new AbortController();
    const pending = f.finalize(f.request, controller.signal);
    await started.promise;
    controller.abort();
    expect(await pending).toEqual(failure("ABORTED", true));
    put.resolve(f.claim.canonical);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.commitAuthorized).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(0);
  });
  it("keeps provider close errors out of the command outcome", async () => {
    const f = await fixture();
    f.close.mockImplementation(() => {
      throw new Error("private cleanup detail");
    });
    expect(await f.finalize(f.request)).toMatchObject({ ok: true });
    expect(f.close).toHaveBeenCalledOnce();
  });
  it("retains a safe failure if releasing the claim also fails", async () => {
    const f = await fixture();
    f.readStaging.mockResolvedValue(null);
    f.releaseClaim.mockRejectedValue(new Error("cleanup secret"));
    expect(await f.finalize(f.request)).toEqual(failure("NOT_UPLOADED", true));
  });
  it.each([0, 60001, Number.NaN])(
    "rejects an unbounded or invalid deadline %s",
    async (timeoutMs) => {
      const f = await fixture();
      expect(() =>
        createRitualUploadFinalizer({ ...f.options, timeoutMs }),
      ).toThrow("Invalid finalization timeout");
    },
  );
});
