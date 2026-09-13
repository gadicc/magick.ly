import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLE_FIXTURE_POLICY,
  BUNDLE_FIXTURE_TIME,
  bundleSchema,
  type RitualBundleFixture,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import { userGroupGrants } from "../db/schema/memberships";
import { createUuidV7 } from "../lib/ids";
import { createR2RitualBundleStorage } from "./r2RitualBundleStorage";
import { readRitualBundleAsset } from "./readRitualBundleAsset";
import type { RitualBundleStorageReceiptV1 } from "./ritualBundlePublication";
import { createSqlRitualBundlePublisher } from "./sqlRitualBundlePublications";
import type {
  RitualBundleAssetReadRequest,
  SqlRitualBundleAsset,
} from "./sqlRitualBundleReads";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";

vi.mock("server-only", () => ({}));
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const otherId = "019947c5-abcd-7000-8000-000000000099";
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const bytes = new Uint8Array([0, 1, 2, 3, 128, 254, 255]);
  const request: RitualBundleAssetReadRequest = {
    expectedActorId: "019947c5-abcd-7000-8000-000000000001",
    ritualId: "019947c5-abcd-7000-8000-000000000002",
    bundleId: "019947c5-abcd-7000-8000-000000000003",
    assetKey: "019947c5-abcd-7000-8000-000000000004",
  };
  const asset: SqlRitualBundleAsset = {
    ...request,
    operationId: "019947c5-abcd-7000-8000-000000000005",
    manifestSha256: sha("synthetic manifest"),
    descriptor: {
      descriptorSha256: sha("synthetic descriptor"),
      contentSha256: sha("synthetic compiled output"),
      outputFormat: "json-rich-text",
      outputFormatVersion: "1",
    },
    publicationPolicyId: "synthetic.images:v1",
    sha256: sha(bytes),
    mime: "image/png",
    byteSize: bytes.byteLength,
    location: {
      provider: "r2",
      bucket: "synthetic-private-bundles",
      objectKey: "owned/é%2F?b=2&a=1#part ",
    },
    receiptSha256: sha("synthetic receipt"),
  };
  const reader = {
    getAsset: vi.fn(
      async (): Promise<SqlRitualBundleAsset | null> => structuredClone(asset),
    ),
  };
  const storage = {
    readAsset: vi.fn(
      async (
        _asset: SqlRitualBundleAsset,
        _signal: AbortSignal,
      ): Promise<Uint8Array | null> => bytes,
    ),
  };
  return { bytes, request, asset, reader, storage };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});
afterEach(() => {
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("authorize/read/reauthorize ritual bundle bytes", () => {
  it.each([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ] as const)(
    "transfers exact owned bytes and the %s declaration after both checks",
    async (mime) => {
      const t = fixture();
      t.asset.mime = mime;
      const original = t.bytes.slice();
      const result = await readRitualBundleAsset(
        t.reader,
        t.storage,
        t.request,
      );
      expect(result).toEqual({
        body: original,
        contentType: mime,
        byteSize: original.length,
        sha256: sha(original),
      });
      expect(result?.body).toBe(t.bytes);
      expect(t.reader.getAsset).toHaveBeenCalledTimes(2);
      expect(t.storage.readAsset).toHaveBeenCalledTimes(1);
      const [bound, signal] = t.storage.readAsset.mock.calls[0];
      expect(bound).toEqual(t.asset);
      expect(bound).not.toBe(t.asset);
      expect(signal.aborted).toBe(true);
      expect(t.bytes).toEqual(original);
      expect(Object.keys(result!).sort()).toEqual([
        "body",
        "byteSize",
        "contentType",
        "sha256",
      ]);
    },
  );

  it("snapshots caller input and each adapter DTO before crossing awaits", async () => {
    const t = fixture(),
      first = deferred<SqlRitualBundleAsset>();
    const originalRequest = structuredClone(t.request),
      originalAsset = structuredClone(t.asset);
    const submitted: RitualBundleAssetReadRequest[] = [];
    let calls = 0;
    const reader = {
      getAsset: vi.fn((request: RitualBundleAssetReadRequest) => {
        submitted.push(structuredClone(request));
        request.expectedActorId = otherId;
        return ++calls === 1
          ? first.promise
          : Promise.resolve(structuredClone(originalAsset));
      }),
    };
    t.storage.readAsset.mockImplementation(async (asset) => {
      expect(asset).toEqual(originalAsset);
      asset.location.objectKey = "changed adapter argument";
      asset.sha256 = sha("changed adapter argument");
      t.asset.descriptor.contentSha256 = sha("changed original selection");
      return t.bytes;
    });
    const result = readRitualBundleAsset(reader, t.storage, t.request);
    t.request.expectedActorId = otherId;
    t.request.bundleId = otherId;
    first.resolve(t.asset);
    expect((await result)?.body).toBe(t.bytes);
    expect(submitted).toEqual([originalRequest, originalRequest]);
  });

  it.each(["expectedActorId", "ritualId", "bundleId", "assetKey"] as const)(
    "refuses an initially mismatched %s without storage access",
    async (field) => {
      const t = fixture();
      t.asset[field] = otherId;
      expect(
        await readRitualBundleAsset(t.reader, t.storage, t.request),
      ).toBeNull();
      expect(t.storage.readAsset).not.toHaveBeenCalled();
      expect(t.reader.getAsset).toHaveBeenCalledTimes(1);
    },
  );

  const bindingChanges: [string, (asset: SqlRitualBundleAsset) => void][] = [
    [
      "actor",
      (a) => {
        a.expectedActorId = otherId;
      },
    ],
    [
      "operation provenance",
      (a) => {
        a.operationId = otherId;
      },
    ],
    [
      "ritual",
      (a) => {
        a.ritualId = otherId;
      },
    ],
    [
      "bundle",
      (a) => {
        a.bundleId = otherId;
      },
    ],
    [
      "asset key",
      (a) => {
        a.assetKey = otherId;
      },
    ],
    [
      "manifest hash",
      (a) => {
        a.manifestSha256 = sha("different manifest");
      },
    ],
    [
      "descriptor hash",
      (a) => {
        a.descriptor.descriptorSha256 = sha("different descriptor");
      },
    ],
    [
      "rendered content",
      (a) => {
        a.descriptor.contentSha256 = sha("different content");
      },
    ],
    [
      "output format",
      (a) => {
        (a.descriptor as { outputFormat: string }).outputFormat = "future";
      },
    ],
    [
      "output version",
      (a) => {
        (a.descriptor as { outputFormatVersion: string }).outputFormatVersion =
          "2";
      },
    ],
    [
      "publication policy",
      (a) => {
        a.publicationPolicyId = "synthetic.images:v2";
      },
    ],
    [
      "byte hash",
      (a) => {
        a.sha256 = sha("different bytes");
      },
    ],
    [
      "MIME",
      (a) => {
        a.mime = "image/jpeg";
      },
    ],
    [
      "byte size",
      (a) => {
        a.byteSize++;
      },
    ],
    [
      "storage provider",
      (a) => {
        a.location.provider = "replacement";
      },
    ],
    [
      "bucket",
      (a) => {
        a.location.bucket = "replacement";
      },
    ],
    [
      "opaque object key",
      (a) => {
        a.location.objectKey = a.location.objectKey.trim();
      },
    ],
    [
      "receipt hash",
      (a) => {
        a.receiptSha256 = sha("replacement receipt");
      },
    ],
  ];
  it.each(bindingChanges)(
    "wipes bytes if the final %s binding changes",
    async (_name, change) => {
      const t = fixture(),
        changed = structuredClone(t.asset);
      change(changed);
      t.reader.getAsset
        .mockResolvedValueOnce(structuredClone(t.asset))
        .mockResolvedValueOnce(changed);
      expect(
        await readRitualBundleAsset(t.reader, t.storage, t.request),
      ).toBeNull();
      expect(t.bytes).toEqual(new Uint8Array(t.bytes.length));
      expect(t.reader.getAsset).toHaveBeenCalledTimes(2);
    },
  );

  it("compares values rather than object insertion order", async () => {
    const t = fixture();
    const reordered = Object.fromEntries(
      Object.entries(t.asset).reverse(),
    ) as unknown as SqlRitualBundleAsset;
    reordered.location = Object.fromEntries(
      Object.entries(t.asset.location).reverse(),
    ) as SqlRitualBundleAsset["location"];
    t.reader.getAsset
      .mockResolvedValueOnce(structuredClone(t.asset))
      .mockResolvedValueOnce(reordered);
    expect(
      (await readRitualBundleAsset(t.reader, t.storage, t.request))?.body,
    ).toBe(t.bytes);
  });

  it.each(["missing", "extra"])(
    "refuses a %s final binding property",
    async (kind) => {
      const t = fixture(),
        changed = structuredClone(t.asset);
      if (kind === "missing")
        delete (changed as Partial<SqlRitualBundleAsset>).operationId;
      else Object.assign(changed, { sourceOnlyGrant: true });
      t.reader.getAsset
        .mockResolvedValueOnce(structuredClone(t.asset))
        .mockResolvedValueOnce(changed);
      expect(
        await readRitualBundleAsset(t.reader, t.storage, t.request),
      ).toBeNull();
      expect(t.bytes.every((value) => value === 0)).toBe(true);
    },
  );

  it.each([
    "initial denial",
    "initial failure",
    "storage missing",
    "storage failure",
    "final denial",
    "final failure",
  ])("returns null safely on %s", async (stage) => {
    const t = fixture();
    if (stage === "initial denial")
      t.reader.getAsset.mockResolvedValueOnce(null!);
    if (stage === "initial failure")
      t.reader.getAsset.mockRejectedValueOnce(
        new Error("synthetic database detail"),
      );
    if (stage === "storage missing")
      t.storage.readAsset.mockResolvedValueOnce(null!);
    if (stage === "storage failure")
      t.storage.readAsset.mockRejectedValueOnce(
        new Error("synthetic provider detail"),
      );
    if (stage === "final denial")
      t.reader.getAsset
        .mockResolvedValueOnce(structuredClone(t.asset))
        .mockResolvedValueOnce(null!);
    if (stage === "final failure")
      t.reader.getAsset
        .mockResolvedValueOnce(structuredClone(t.asset))
        .mockRejectedValueOnce(new Error("synthetic database detail"));
    expect(
      await readRitualBundleAsset(t.reader, t.storage, t.request),
    ).toBeNull();
    if (stage.startsWith("initial"))
      expect(t.storage.readAsset).not.toHaveBeenCalled();
    if (stage.startsWith("final"))
      expect(t.bytes.every((value) => value === 0)).toBe(true);
    if (stage.startsWith("storage"))
      expect(t.reader.getAsset).toHaveBeenCalledTimes(1);
  });

  it.each(["short", "long", "different same-size bytes"])(
    "wipes %s without a second authorization",
    async (kind) => {
      const t = fixture();
      const invalid =
        kind === "short"
          ? new Uint8Array([1])
          : kind === "long"
            ? new Uint8Array(t.bytes.length + 1).fill(1)
            : new Uint8Array(t.bytes.length).fill(1);
      t.storage.readAsset.mockResolvedValueOnce(invalid);
      expect(
        await readRitualBundleAsset(t.reader, t.storage, t.request),
      ).toBeNull();
      expect(invalid.every((value) => value === 0)).toBe(true);
      expect(t.reader.getAsset).toHaveBeenCalledTimes(1);
    },
  );

  it("hashes and wipes only the owned Uint8Array view", async () => {
    const t = fixture(),
      allocation = new Uint8Array([44, ...t.bytes, 55]);
    const view = allocation.subarray(1, allocation.length - 1);
    t.storage.readAsset.mockResolvedValueOnce(view);
    t.reader.getAsset
      .mockResolvedValueOnce(structuredClone(t.asset))
      .mockResolvedValueOnce(null!);
    expect(
      await readRitualBundleAsset(t.reader, t.storage, t.request),
    ).toBeNull();
    expect(Array.from(allocation)).toEqual([
      44,
      ...new Uint8Array(view.length),
      55,
    ]);
  });
});

describe("asset-read cancellation and deadlines", () => {
  it("does no work for a pre-aborted parent", async () => {
    const t = fixture(),
      controller = new AbortController();
    controller.abort();
    expect(
      await readRitualBundleAsset(t.reader, t.storage, t.request, {
        signal: controller.signal,
      }),
    ).toBeNull();
    expect(t.reader.getAsset).not.toHaveBeenCalled();
    expect(t.storage.readAsset).not.toHaveBeenCalled();
  });

  it("returns promptly on cancellation during the first authorization and ignores its late success", async () => {
    const t = fixture(),
      selected = deferred<SqlRitualBundleAsset>(),
      controller = new AbortController();
    t.reader.getAsset.mockReturnValueOnce(selected.promise);
    const reading = readRitualBundleAsset(t.reader, t.storage, t.request, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await reading).toBeNull();
    selected.resolve(t.asset);
    await selected.promise;
    expect(t.storage.readAsset).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])(
    "handles late storage %s after cancellation without leaking bytes or rejection",
    async (outcome) => {
      const t = fixture(),
        entered = deferred(),
        stored = deferred<Uint8Array>(),
        controller = new AbortController();
      t.storage.readAsset.mockImplementation(() => {
        entered.resolve();
        return stored.promise;
      });
      const reading = readRitualBundleAsset(t.reader, t.storage, t.request, {
        signal: controller.signal,
      });
      await entered.promise;
      controller.abort();
      expect(await reading).toBeNull();
      expect(t.storage.readAsset.mock.calls[0][1].aborted).toBe(true);
      if (outcome === "success") {
        stored.resolve(t.bytes);
        await stored.promise;
        expect(t.bytes.every((value) => value === 0)).toBe(true);
      } else {
        stored.reject(new Error("synthetic late provider detail"));
        await stored.promise.catch(() => {});
      }
      expect(t.reader.getAsset).toHaveBeenCalledTimes(1);
    },
  );

  it("wipes held bytes before a stalled final authorization resolves", async () => {
    const t = fixture(),
      entered = deferred(),
      final = deferred<SqlRitualBundleAsset>(),
      controller = new AbortController();
    t.reader.getAsset
      .mockResolvedValueOnce(structuredClone(t.asset))
      .mockImplementationOnce(() => {
        entered.resolve();
        return final.promise;
      });
    const reading = readRitualBundleAsset(t.reader, t.storage, t.request, {
      signal: controller.signal,
    });
    await entered.promise;
    controller.abort();
    expect(await reading).toBeNull();
    expect(t.bytes.every((value) => value === 0)).toBe(true);
    final.resolve(t.asset);
    await final.promise;
    expect(t.bytes.every((value) => value === 0)).toBe(true);
  });

  it.each(["first authorization", "storage", "final authorization"])(
    "times out a stalled %s and cleans up late completion",
    async (stage) => {
      const t = fixture(),
        entered = deferred(),
        selected = deferred<SqlRitualBundleAsset>(),
        stored = deferred<Uint8Array>();
      if (stage === "first authorization")
        t.reader.getAsset.mockImplementationOnce(() => {
          entered.resolve();
          return selected.promise;
        });
      if (stage === "storage")
        t.storage.readAsset.mockImplementationOnce(() => {
          entered.resolve();
          return stored.promise;
        });
      if (stage === "final authorization")
        t.reader.getAsset
          .mockResolvedValueOnce(structuredClone(t.asset))
          .mockImplementationOnce(() => {
            entered.resolve();
            return selected.promise;
          });
      const reading = readRitualBundleAsset(t.reader, t.storage, t.request, {
        timeoutMs: 25,
      });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(25);
      expect(await reading).toBeNull();
      if (stage === "storage") {
        stored.resolve(t.bytes);
        await stored.promise;
      } else {
        selected.resolve(t.asset);
        await selected.promise;
      }
      if (stage !== "first authorization")
        expect(t.bytes.every((value) => value === 0)).toBe(true);
      else expect(t.storage.readAsset).not.toHaveBeenCalled();
    },
  );

  it.each(["storage", "final authorization"])(
    "checks elapsed time after %s even when the timer callback has not fired",
    async (stage) => {
      const t = fixture(),
        entered = deferred(),
        selected = deferred<SqlRitualBundleAsset>(),
        stored = deferred<Uint8Array>();
      if (stage === "storage")
        t.storage.readAsset.mockImplementationOnce(() => {
          entered.resolve();
          return stored.promise;
        });
      else
        t.reader.getAsset
          .mockResolvedValueOnce(structuredClone(t.asset))
          .mockImplementationOnce(() => {
            entered.resolve();
            return selected.promise;
          });
      const reading = readRitualBundleAsset(t.reader, t.storage, t.request, {
        timeoutMs: 25,
      });
      await entered.promise;
      vi.spyOn(performance, "now").mockReturnValue(25);
      if (stage === "storage") stored.resolve(t.bytes);
      else selected.resolve(t.asset);
      expect(await reading).toBeNull();
      expect(t.bytes.every((value) => value === 0)).toBe(true);
    },
  );

  it("removes its parent listener and timer after success without relinquishing caller bytes", async () => {
    const t = fixture(),
      controller = new AbortController(),
      original = t.bytes.slice();
    const add = vi.spyOn(controller.signal, "addEventListener"),
      remove = vi.spyOn(controller.signal, "removeEventListener");
    expect(
      (
        await readRitualBundleAsset(t.reader, t.storage, t.request, {
          signal: controller.signal,
        })
      )?.body,
    ).toBe(t.bytes);
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true,
    });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.bytes).toEqual(original);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 30_001])(
    "rejects invalid timeout %s before authorization",
    async (timeoutMs) => {
      const t = fixture();
      await expect(
        readRitualBundleAsset(t.reader, t.storage, t.request, { timeoutMs }),
      ).rejects.toThrow(RangeError);
      expect(t.reader.getAsset).not.toHaveBeenCalled();
      expect(t.storage.readAsset).not.toHaveBeenCalled();
    },
  );

  it("accepts bounded timeout endpoints and catches an uncloneable request", async () => {
    for (const timeoutMs of [1, 30_000]) {
      const t = fixture();
      expect(
        await readRitualBundleAsset(t.reader, t.storage, t.request, {
          timeoutMs,
        }),
      ).not.toBeNull();
    }
    const t = fixture();
    expect(
      await readRitualBundleAsset(t.reader, t.storage, {
        ...t.request,
        extra: () => {},
      } as RitualBundleAssetReadRequest),
    ).toBeNull();
    expect(t.reader.getAsset).not.toHaveBeenCalled();
  });
});

it("delivers published PNG/SVG through actual SQL and R2 adapters, then wipes after revocation during GET", async () => {
  vi.useRealTimers();
  const harness = await createMemoryPgliteHarness({ schema: bundleSchema });
  const { db } = harness;
  let seeded: RitualBundleFixture | undefined;
  let storage: ReturnType<typeof createR2RitualBundleStorage> | undefined;
  const responseBodies: Readable[] = [];
  const objects = new Map<
    string,
    { bytes: Uint8Array; headers: Record<string, string> }
  >();
  const response = (
    statusCode: number,
    headers: Record<string, string>,
    chunks: Buffer[] = [],
  ) => {
    const body = Readable.from(chunks);
    responseBodies.push(body);
    return { response: { statusCode, headers, body } };
  };
  let beforeStoredGet: (() => Promise<void>) | undefined;
  // Only the SDK HTTP transport is synthetic. Image preparation, Loom storage,
  // Smithy serialization, SQL transactions and both authorizations are real.
  const handle = vi.fn(
    async (request: {
      method: string;
      hostname: string;
      path: string;
      headers: Record<string, string>;
      body?: unknown;
    }) => {
      const key = request.hostname + request.path;
      const object = objects.get(key);
      if (request.method === "GET") {
        if (!object)
          return response(404, { "content-type": "application/xml" }, [
            Buffer.from("<Error><Code>NoSuchKey</Code></Error>"),
          ]);
        const held = beforeStoredGet;
        beforeStoredGet = undefined;
        await held?.();
        return response(
          200,
          {
            ...Object.fromEntries(
              Object.entries(object.headers).filter(([name]) =>
                name.startsWith("x-amz-meta-"),
              ),
            ),
            "content-length": String(object.bytes.byteLength),
            "content-type": object.headers["content-type"],
          },
          [Buffer.from(object.bytes)],
        );
      }
      if (request.method === "PUT") {
        expect(object).toBeUndefined();
        expect(request.body).toBeInstanceOf(Uint8Array);
        objects.set(key, {
          bytes: Uint8Array.from(request.body as Uint8Array),
          headers: { ...request.headers },
        });
        return response(200, {});
      }
      throw new Error("Unexpected synthetic HTTP method");
    },
  );
  try {
    seeded = await seedRitualBundleFixture(db, { scope: "group" });
    const current = seeded;
    storage = createR2RitualBundleStorage(
      {
        kind: "r2",
        endpoint:
          "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
        bucket: "synthetic-bundle-delivery",
        credentials: {
          accessKeyId: "AKIDEXAMPLE",
          secretAccessKey: "synthetic-not-a-provider-credential",
        },
        bundlePrefix: "ritual-bundles/v1",
        reservedPrefixes: ["ritual-staging", "ritual-canonical"],
      },
      { requestHandler: { handle }, now: () => BUNDLE_FIXTURE_TIME },
    );
    const operation = {
      operationId: createUuidV7(),
      expectedActorId: current.actors.creator,
    };
    const publisher = createSqlRitualBundlePublisher(
      db,
      async () => current.actors.creator,
      {
        publicationPolicyId: BUNDLE_FIXTURE_POLICY,
        locations: storage.locations,
        now: () => BUNDLE_FIXTURE_TIME,
      },
    );
    expect((await publisher.initiate(operation, current.prepared)).kind).toBe(
      "reserved",
    );
    const started = await publisher.claim(operation);
    if (started.kind !== "claimed")
      throw new Error("Expected synthetic worker claim");
    const { claim } = started;
    expect(claim.assets.map((asset) => asset.mime)).toEqual([
      "image/png",
      "image/svg+xml",
    ]);
    const originalBytes = new Map(
      claim.assets.map((asset) => {
        const bytes = current.prepared.copyBytes(asset.key);
        if (!bytes) throw new Error("Expected owned prepared fixture bytes");
        return [asset.key, bytes] as const;
      }),
    );
    const receipts: RitualBundleStorageReceiptV1[] = [];
    for (const asset of claim.assets)
      receipts.push(
        await storage.ensureAsset({
          claim,
          assetKey: asset.key,
          bytes: originalBytes.get(asset.key),
        }),
      );
    expect(objects.size).toBe(2);
    const reader = createSqlRitualBundleReader(
      db,
      async () => current.actors.member,
      {
        acceptedPublicationPolicyIds: [BUNDLE_FIXTURE_POLICY],
      },
    );
    const input = (assetKey: string) => ({
      expectedActorId: current.actors.member,
      ritualId: current.parent.id,
      bundleId: claim.bundleId,
      assetKey,
    });
    const callsBeforePublication = handle.mock.calls.length;
    expect(
      await readRitualBundleAsset(reader, storage, input(claim.assets[0].key)),
    ).toBeNull();
    expect(handle.mock.calls.length).toBe(callsBeforePublication);
    const published = await publisher.publish(claim, receipts);
    expect(published.bundleId).toBe(claim.bundleId);
    const manifest = await reader.getManifest({
      expectedActorId: current.actors.member,
      ritualId: current.parent.id,
      bundleId: claim.bundleId,
    });
    expect(manifest?.manifestJson).toBe(current.prepared.manifestJson);
    for (const asset of claim.assets) {
      const selected = await reader.getAsset(input(asset.key));
      expect(selected).toMatchObject({
        operationId: operation.operationId,
        location: {
          provider: asset.storageProvider,
          bucket: asset.bucket,
          objectKey: asset.objectKey,
        },
      });
      const delivered = await readRitualBundleAsset(
        reader,
        storage,
        input(asset.key),
      );
      expect(delivered).toEqual({
        body: originalBytes.get(asset.key),
        contentType: asset.mime,
        byteSize: asset.byteSize,
        sha256: asset.sha256,
      });
      expect(delivered?.body).not.toBe(originalBytes.get(asset.key));
    }
    // Revoke only after the first SQL read has allowed this exact object GET.
    beforeStoredGet = async () => {
      await db
        .delete(userGroupGrants)
        .where(eq(userGroupGrants.userId, current.actors.member));
    };
    const captured: Uint8Array[] = [];
    const actualStorage = storage;
    const observingStorage = {
      readAsset: async (asset: SqlRitualBundleAsset, signal: AbortSignal) => {
        const bytes = await actualStorage.readAsset(asset, signal);
        if (bytes) captured.push(bytes);
        return bytes;
      },
    };
    const callsBeforeRevocation = handle.mock.calls.length;
    expect(
      await readRitualBundleAsset(
        reader,
        observingStorage,
        input(claim.assets[0].key),
      ),
    ).toBeNull();
    expect(handle.mock.calls.length).toBe(callsBeforeRevocation + 1);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(new Uint8Array(claim.assets[0].byteSize));
    expect(await reader.getAsset(input(claim.assets[0].key))).toBeNull();
    expect(
      await readRitualBundleAsset(reader, storage, input(claim.assets[0].key)),
    ).toBeNull();
    expect(handle.mock.calls.length).toBe(callsBeforeRevocation + 1);
    expect(
      handle.mock.calls.every(
        ([request]) =>
          request.hostname ===
            "00000000000000000000000000000000.r2.cloudflarestorage.com" &&
          request.path.startsWith(
            `/synthetic-bundle-delivery/ritual-bundles/v1/${claim.bundleId}/`,
          ),
      ),
    ).toBe(true);
    // Delivery cleanup must not mutate independent persisted object copies.
    for (const object of objects.values())
      expect(object.bytes.some((byte) => byte !== 0)).toBe(true);
  } finally {
    storage?.destroy();
    for (const body of responseBodies) body.destroy();
    seeded?.dispose();
    await harness.client.close();
  }
});
