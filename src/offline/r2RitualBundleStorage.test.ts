import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "@/lib/ids";
import type { RitualBundleAssetMime } from "@/offline/ritualBundleManifest";
import {
  parseRitualBundleStorageReceipt,
  type RitualBundlePublicationClaim,
} from "@/offline/ritualBundlePublication";
import type { SqlRitualBundleAsset } from "@/offline/sqlRitualBundleReads";
import { createR2RitualBundleStorage } from "./r2RitualBundleStorage";

vi.mock("server-only", () => ({}));

type Config = Parameters<typeof createR2RitualBundleStorage>[0];
interface Request {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}
interface StoredObject {
  bytes: Uint8Array;
  headers: Record<string, string>;
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const samples = new Map<RitualBundleAssetMime, Uint8Array>();
beforeAll(async () => {
  for (const format of ["png", "jpeg", "gif", "webp"] as const)
    samples.set(
      `image/${format}`,
      await sharp({
        create: { width: 3, height: 2, channels: 4, background: "red" },
      })
        .toFormat(format)
        .toBuffer(),
    );
  samples.set(
    "image/svg+xml",
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L3 2"/></svg>',
    ),
  );
});
const config = (): Config => ({
  kind: "r2",
  endpoint: "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
  bucket: "synthetic-ritual-private",
  credentials: {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "synthetic-secret-not-a-real-credential",
  },
  bundlePrefix: "ritual-bundles/v1",
  reservedPrefixes: ["ritual-staging", "ritual-canonical"],
});
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function fixture(
  options: {
    settings?: Config;
    mime?: RitualBundleAssetMime;
    ioTimeoutMs?: number;
  } = {},
) {
  const settings = options.settings ?? config();
  const mime = options.mime ?? "image/png";
  const bytes = new Uint8Array(samples.get(mime)!);
  let time = Date.now();
  const requests: Request[] = [];
  const objects = new Map<string, StoredObject>();
  const bodies: Readable[] = [];
  const response = (
    statusCode: number,
    headers: Record<string, string> = {},
    body = Readable.from([]),
  ) => {
    bodies.push(body);
    return { response: { statusCode, headers, body } };
  };
  const errorResponse = (status = 404, code = "NoSuchKey") =>
    response(
      status,
      { "content-type": "application/xml" },
      Readable.from([
        Buffer.from(
          `<Error><Code>${code}</Code><Message>synthetic private provider detail</Message></Error>`,
        ),
      ]),
    );
  const handle = vi.fn(
    async (
      request: Request,
      _options?: { abortSignal?: { aborted: boolean } },
    ) => {
      requests.push(request);
      const key = request.hostname + request.path;
      if (request.method === "GET") {
        const object = objects.get(key);
        if (!object) return errorResponse();
        return response(
          200,
          {
            ...Object.fromEntries(
              Object.entries(object.headers).filter(([key]) =>
                key.startsWith("x-amz-meta-"),
              ),
            ),
            "content-length": String(object.bytes.byteLength),
            "content-type": object.headers["content-type"],
          },
          Readable.from([Buffer.from(object.bytes)]),
        );
      }
      if (request.method === "PUT") {
        if (objects.has(key)) return errorResponse(412, "PreconditionFailed");
        if (!(request.body instanceof Uint8Array))
          throw new Error("Expected bounded owned SDK bytes");
        objects.set(key, {
          bytes: new Uint8Array(request.body),
          headers: { ...request.headers },
        });
        return response(200);
      }
      throw new Error("Unexpected provider operation");
    },
  );
  const api = createR2RitualBundleStorage(settings, {
    requestHandler: { handle },
    now: () => time,
    ...(options.ioTimeoutMs === undefined
      ? {}
      : { ioTimeoutMs: options.ioTimeoutMs }),
  });
  disposers.push(() => api.destroy());
  const operationId = createUuidV7(),
    bundleId = createUuidV7(),
    ritualId = createUuidV7(),
    assetKey = createUuidV7();
  const asset = {
    key: assetKey,
    reference: "/pics/synthetic?b=2&a=%2F",
    sha256: hash(bytes),
    mime,
    bytes: bytes.byteLength,
    purpose: "read" as const,
  };
  const claim: RitualBundlePublicationClaim = {
    operationId,
    actorId: createUuidV7(),
    bundleId,
    ritualId,
    manifestSha256: hash("synthetic manifest"),
    claimId: createUuidV7(),
    claimStartedAtMs: time - 1000,
    claimExpiresAtMs: time + 119000,
    intentExpiresAtMs: time + 86400000,
    assets: [
      {
        operationId,
        bundleId,
        ritualId,
        key: assetKey,
        assetIndex: 0,
        reference: asset.reference,
        sha256: asset.sha256,
        mime,
        byteSize: bytes.byteLength,
        ...api.locations({ operationId, bundleId, ritualId, asset }),
      },
    ],
  };
  const key = () =>
    new URL(settings.endpoint).hostname +
    `/${claim.assets[0].bucket}/${claim.assets[0].objectKey}`;
  const metadata = () => ({
    "content-type": mime,
    "x-amz-meta-magickli-profile": "magickli-ritual-bundle-object-v1",
    "x-amz-meta-magickli-operation-id": claim.operationId,
    "x-amz-meta-magickli-bundle-id": claim.bundleId,
    "x-amz-meta-magickli-ritual-id": claim.ritualId,
    "x-amz-meta-magickli-asset-id": assetKey,
    "x-amz-meta-magickli-manifest-sha256": claim.manifestSha256,
    "x-amz-meta-sha256": claim.assets[0].sha256,
  });
  const existing = () =>
    objects.set(key(), { bytes: bytes.slice(), headers: metadata() });
  const ensure = (
    inputBytes: Uint8Array | undefined = bytes,
    signal?: AbortSignal,
  ) =>
    api.ensureAsset(
      {
        claim,
        assetKey,
        ...(inputBytes === undefined ? {} : { bytes: inputBytes }),
      },
      signal,
    );
  return {
    api,
    settings,
    mime,
    bytes,
    claim,
    asset,
    assetKey,
    objects,
    requests,
    bodies,
    response,
    errorResponse,
    handle,
    key,
    metadata,
    existing,
    ensure,
    get time() {
      return time;
    },
    set time(value: number) {
      time = value;
    },
  };
}
function assertReceipt(
  f: ReturnType<typeof fixture>,
  receipt: Awaited<ReturnType<typeof f.ensure>>,
) {
  const receiptJson = JSON.stringify(receipt);
  expect(
    parseRitualBundleStorageReceipt(receiptJson, hash(receiptJson), {
      ...f.claim.assets[0],
      claimId: f.claim.claimId,
      claimStartedAtMs: f.claim.claimStartedAtMs,
      claimExpiresAtMs: f.claim.claimExpiresAtMs,
    }),
  ).toEqual(receipt);
  expect(receipt.verifiedAtMs).toBe(f.time);
}
function readDescriptor(f: ReturnType<typeof fixture>): SqlRitualBundleAsset {
  const row = f.claim.assets[0];
  return {
    operationId: f.claim.operationId,
    expectedActorId: f.claim.actorId,
    ritualId: f.claim.ritualId,
    bundleId: f.claim.bundleId,
    assetKey: row.key,
    manifestSha256: f.claim.manifestSha256,
    descriptor: {
      descriptorSha256: hash("synthetic descriptor"),
      contentSha256: hash("synthetic content"),
      outputFormat: "json-rich-text",
      outputFormatVersion: "1",
    },
    publicationPolicyId: "synthetic-policy-v1",
    sha256: row.sha256,
    mime: row.mime,
    byteSize: row.byteSize,
    location: {
      provider: row.storageProvider,
      bucket: row.bucket,
      objectKey: row.objectKey,
    },
    receiptSha256: hash("synthetic receipt"),
  };
}

describe("explicit closed configuration", () => {
  it.each([
    [
      "scheme",
      {
        endpoint:
          "http://00000000000000000000000000000000.r2.cloudflarestorage.com",
      },
    ],
    ["bucket path", { endpoint: config().endpoint + "/synthetic-private" }],
    ["endpoint query", { endpoint: config().endpoint + "?x=1" }],
    [
      "endpoint credentials",
      {
        endpoint:
          "https://name:secret@00000000000000000000000000000000.r2.cloudflarestorage.com",
      },
    ],
    ["custom origin", { endpoint: "https://images.example.test" }],
    ["bucket case", { bucket: "Mixed-Case" }],
    ["empty prefix", { bundlePrefix: "" }],
    ["traversal", { bundlePrefix: "bundles/../other" }],
    ["leading slash", { bundlePrefix: "/bundles" }],
    ["duplicate slash", { bundlePrefix: "bundles//v1" }],
    ["namespace overlap", { reservedPrefixes: ["ritual-bundles/v1"] }],
    ["namespace ancestor", { reservedPrefixes: ["ritual-bundles"] }],
    [
      "namespace descendant",
      { reservedPrefixes: ["ritual-bundles/v1/private"] },
    ],
    ["invalid reserved namespace", { reservedPrefixes: ["other/../bundles"] }],
    ["missing explicit reserved list", { reservedPrefixes: undefined }],
    [
      "overlong reserved list",
      {
        reservedPrefixes: Array.from(
          { length: 33 },
          (_, index) => `other-${index}`,
        ),
      },
    ],
    ["missing credentials", { credentials: undefined }],
    [
      "invalid credential expiry",
      { credentials: { ...config().credentials, expiration: new Date(NaN) } },
    ],
  ] as const)("rejects %s before SDK access", (_name, changes) => {
    expect(() =>
      createR2RitualBundleStorage({ ...config(), ...changes } as Config),
    ).toThrow("INVALID_CONFIGURATION");
  });
  it("allows exact sibling namespaces and an explicit dedicated-bucket configuration", () => {
    for (const reservedPrefixes of [[], ["ritual-bundles/v10"]]) {
      const api = createR2RitualBundleStorage({
        ...config(),
        reservedPrefixes,
      });
      api.destroy();
    }
  });
  it.each([0, -1, 30001, NaN, 1.5])(
    "rejects invalid timeout %s",
    (ioTimeoutMs) => {
      expect(() =>
        createR2RitualBundleStorage(config(), { ioTimeoutMs }),
      ).toThrow("INVALID_CONFIGURATION");
    },
  );
  it("uses explicit credentials and endpoint despite ambient AWS settings", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AMBIENTEXAMPLE");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "ambient-synthetic-secret");
    vi.stubEnv("AWS_ENDPOINT_URL", "http://127.0.0.1:9");
    vi.stubEnv("AWS_REGION", "us-east-1");
    const f = fixture();
    await f.ensure();
    expect(
      f.requests.every(
        (request) => request.hostname === new URL(f.settings.endpoint).hostname,
      ),
    ).toBe(true);
    expect(
      f.requests.every((request) =>
        request.headers.authorization.includes("Credential=AKIDEXAMPLE/"),
      ),
    ).toBe(true);
    expect(
      f.requests.every((request) =>
        request.headers.authorization.includes("/auto/s3/aws4_request"),
      ),
    ).toBe(true);
  });
  it("snapshots explicit temporary credentials and signs their session token", async () => {
    const settings = config();
    settings.credentials.sessionToken = "synthetic-session-token";
    settings.credentials.expiration = new Date(Date.now() + 600000);
    const f = fixture({ settings });
    settings.credentials.sessionToken = "changed";
    settings.credentials.expiration.setTime(0);
    await f.ensure();
    expect(
      f.requests.every(
        (request) =>
          request.headers["x-amz-security-token"] === "synthetic-session-token",
      ),
    ).toBe(true);
  });
  it("rejects sparse configuration lists and empty temporary credentials", () => {
    for (const changes of [
      { reservedPrefixes: new Array(1) },
      { credentials: { ...config().credentials, sessionToken: "" } },
    ])
      expect(() =>
        createR2RitualBundleStorage({ ...config(), ...changes }),
      ).toThrow("INVALID_CONFIGURATION");
  });
  it("rejects malformed location facts synchronously without creating a client request", () => {
    const f = fixture();
    for (const asset of [
      { ...f.asset, key: f.claim.bundleId },
      { ...f.asset, sha256: "bad" },
      { ...f.asset, bytes: 0 },
      { ...f.asset, mime: "image/avif" },
    ])
      expect(() =>
        f.api.locations({ ...f.claim, asset: asset as typeof f.asset }),
      ).toThrow("INVALID_REQUEST");
    expect(f.handle).not.toHaveBeenCalled();
  });
});

describe("exact private bundle storage", () => {
  it.each([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ] as const)(
    "conditionally stores and rereads exact %s bytes",
    async (mime) => {
      const f = fixture({ mime });
      const receipt = await f.ensure();
      assertReceipt(f, receipt);
      expect(f.requests.map((request) => request.method)).toEqual([
        "GET",
        "PUT",
        "GET",
      ]);
      expect(f.objects.get(f.key())?.bytes).toEqual(f.bytes);
      const put = f.requests[1];
      expect(put.hostname).toBe(new URL(f.settings.endpoint).hostname);
      expect(put.path).toBe(
        `/${f.settings.bucket}/${f.claim.assets[0].objectKey}`,
      );
      expect(put.headers["if-none-match"]).toBe("*");
      expect(put.headers["content-length"]).toBe(String(f.bytes.byteLength));
      expect(put.headers["content-type"]).toBe(mime);
      expect(put.headers["x-amz-checksum-sha256"]).toBe(
        Buffer.from(f.asset.sha256, "hex").toString("base64"),
      );
      for (const forbidden of [
        "x-amz-copy-source",
        "x-amz-acl",
        "x-amz-expected-bucket-owner",
        "content-encoding",
      ])
        expect(put.headers[forbidden]).toBeUndefined();
      expect(f.bodies.every((body) => body.destroyed)).toBe(true);
    },
  );
  it("verifies existing owned bytes with one GET and no caller bytes", async () => {
    const f = fixture();
    f.existing();
    const receipt = await f.api.ensureAsset({
      claim: f.claim,
      assetKey: f.assetKey,
    });
    assertReceipt(f, receipt);
    expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
  });
  it("reconciles an identical retry by GET without issuing another write", async () => {
    const f = fixture();
    await f.ensure();
    f.time++;
    assertReceipt(f, await f.ensure());
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
      "GET",
    ]);
  });
  it("binds locations to the configured account, bucket and exact app namespace", () => {
    const f = fixture();
    expect(f.claim.assets[0]).toMatchObject({
      storageProvider: `r2:${hash(f.settings.endpoint)}`,
      bucket: f.settings.bucket,
      objectKey: `${f.settings.bundlePrefix}/${f.claim.bundleId}/${f.assetKey}`,
    });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it("requires bytes only after an exact absence response, without changing ownership", async () => {
    const f = fixture();
    await expect(
      f.api.ensureAsset({ claim: f.claim, assetKey: f.assetKey }),
    ).rejects.toMatchObject({
      code: "MISSING_BYTES",
      message: "MISSING_BYTES",
    });
    expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(f.objects.size).toBe(0);
  });
  it("keeps object metadata immutable across replacement worker claims", async () => {
    const f = fixture();
    const first = await f.ensure();
    const object = structuredClone(f.objects.get(f.key())!);
    f.time += 100;
    f.claim.claimId = createUuidV7();
    f.claim.claimStartedAtMs = f.time;
    f.claim.claimExpiresAtMs = f.time + 120000;
    const second = await f.api.ensureAsset({
      claim: f.claim,
      assetKey: f.assetKey,
    });
    expect(second.claimId).not.toBe(first.claimId);
    assertReceipt(f, second);
    expect(f.objects.get(f.key())).toEqual(object);
    expect(
      Object.keys(object.headers).some((key) => key.includes("claim")),
    ).toBe(false);
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
      "GET",
    ]);
  });
  it("recovers an identical object which wins the conditional PUT race", async () => {
    const f = fixture();
    const actual = f.handle.getMockImplementation()!;
    f.handle.mockImplementation(async (request, options) => {
      if (request.method === "PUT") f.existing();
      return actual(request, options);
    });
    assertReceipt(f, await f.ensure());
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    expect(f.objects.size).toBe(1);
  });
  it("preserves an uncertain successful PUT and recovers by exact GET on retry", async () => {
    const f = fixture();
    const actual = f.handle.getMockImplementation()!;
    f.handle.mockImplementation(async (request, options) => {
      const result = await actual(request, options);
      if (request.method === "PUT") throw new Error("synthetic lost response");
      return result;
    });
    await expect(f.ensure()).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "UNAVAILABLE",
    });
    expect(f.objects.size).toBe(1);
    assertReceipt(
      f,
      await f.api.ensureAsset({ claim: f.claim, assetKey: f.assetKey }),
    );
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
  });
});

describe("ownership and immutable metadata", () => {
  it.each(["storageProvider", "bucket", "objectKey"] as const)(
    "rejects substituted reservation %s before any I/O",
    async (field) => {
      const f = fixture();
      f.claim.assets[0][field] = "different-owner";
      await expect(f.ensure()).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it.each(["endpoint", "bucket", "bundlePrefix"] as const)(
    "rejects persisted locations from another configured %s",
    async (field) => {
      const original = fixture();
      const other = config();
      other[field] =
        field === "endpoint"
          ? "https://11111111111111111111111111111111.r2.cloudflarestorage.com"
          : field === "bucket"
            ? "other-private-bucket"
            : "other-bundles/v1";
      const f = fixture({ settings: other });
      await expect(
        f.api.ensureAsset({
          claim: original.claim,
          assetKey: original.assetKey,
          bytes: original.bytes,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it.each([
    "magickli-profile",
    "magickli-operation-id",
    "magickli-bundle-id",
    "magickli-ritual-id",
    "magickli-asset-id",
    "magickli-manifest-sha256",
    "sha256",
  ])("rejects wrong existing object %s without overwrite", async (field) => {
    const f = fixture();
    f.existing();
    f.objects.get(f.key())!.headers[`x-amz-meta-${field}`] = "wrong";
    await expect(f.ensure()).rejects.toMatchObject({ code: "OBJECT_MISMATCH" });
    expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
    expect(f.objects.size).toBe(1);
  });
  it.each(["bytes", "length", "mime", "missing metadata"])(
    "rejects mismatching existing %s and leaves it untouched",
    async (kind) => {
      const f = fixture();
      f.existing();
      const object = f.objects.get(f.key())!;
      if (kind === "bytes") object.bytes[0] ^= 1;
      if (kind === "length") object.bytes = object.bytes.subarray(1);
      if (kind === "mime")
        object.headers["content-type"] = "application/octet-stream";
      if (kind === "missing metadata")
        delete object.headers["x-amz-meta-sha256"];
      const before = structuredClone(object);
      await expect(f.ensure()).rejects.toMatchObject({
        code: "OBJECT_MISMATCH",
      });
      expect(f.objects.get(f.key())).toEqual(before);
      expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
    },
  );
  it("does not accept the byte hash alone when a conflicting operation owns the destination", async () => {
    const f = fixture();
    const actual = f.handle.getMockImplementation()!;
    f.handle.mockImplementation(async (request, options) => {
      if (request.method === "PUT") {
        f.existing();
        f.objects.get(f.key())!.headers["x-amz-meta-magickli-operation-id"] =
          createUuidV7();
      }
      return actual(request, options);
    });
    await expect(f.ensure()).rejects.toMatchObject({ code: "OBJECT_MISMATCH" });
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
  });
  it.each([
    [409, "ConditionalRequestConflict"],
    [412, "PreconditionFailed"],
  ] as const)(
    "does not infer success from HTTP%i without the exact object",
    async (status, code) => {
      const f = fixture();
      const actual = f.handle.getMockImplementation()!;
      f.handle.mockImplementation((request, options) =>
        request.method === "PUT"
          ? Promise.resolve(f.errorResponse(status, code))
          : actual(request, options),
      );
      await expect(f.ensure()).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(f.objects.size).toBe(0);
    },
  );
});

describe("bounded exact byte reads", () => {
  it("rejects a successful provider response without an SDK-readable body", async () => {
    const f = fixture();
    f.handle.mockResolvedValue({
      response: {
        statusCode: 200,
        headers: { ...f.metadata(), "content-length": String(f.bytes.length) },
        body: undefined as unknown as Readable,
      },
    });
    await expect(f.ensure()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.handle).toHaveBeenCalledTimes(1);
  });
  it.each([
    "missing length",
    "long header",
    "short header",
    "encoding",
    "truncated body",
    "overflow body",
  ])("rejects %s without a write and closes the body", async (kind) => {
    const f = fixture();
    const headers: Record<string, string> = {
      ...f.metadata(),
      "content-length": String(f.bytes.length),
    };
    if (kind === "missing length") delete headers["content-length"];
    if (kind === "long header")
      headers["content-length"] = String(f.bytes.length + 1);
    if (kind === "short header")
      headers["content-length"] = String(f.bytes.length - 1);
    if (kind === "encoding") headers["content-encoding"] = "gzip";
    const body = Readable.from([
      kind === "truncated body"
        ? f.bytes.subarray(1)
        : kind === "overflow body"
          ? Buffer.concat([f.bytes, Buffer.from([1])])
          : f.bytes,
    ]);
    f.handle.mockResolvedValue(f.response(200, headers, body));
    await expect(f.ensure()).rejects.toMatchObject({ code: "OBJECT_MISMATCH" });
    expect(f.handle).toHaveBeenCalledTimes(1);
    expect(body.destroyed).toBe(true);
  });
  it.each([
    [403, "AccessDenied"],
    [404, "AccessDenied"],
    [500, "InternalError"],
    [301, "PermanentRedirect"],
  ] as const)(
    "does not reinterpret %i/%s as absence or follow a redirect",
    async (status, code) => {
      const f = fixture();
      f.handle.mockResolvedValue(f.errorResponse(status, code));
      await expect(f.ensure()).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: "UNAVAILABLE",
      });
      expect(f.handle).toHaveBeenCalledTimes(1);
      expect(f.objects.size).toBe(0);
    },
  );
  it("bounds SDK error-body collection before XML parsing and destroys the stream", async () => {
    const f = fixture();
    let produced = 0;
    const body = new Readable({
      read() {
        produced++;
        this.push(Buffer.alloc(8192, 65));
      },
    });
    f.handle.mockResolvedValue(
      f.response(403, { "content-type": "application/xml" }, body),
    );
    const error = await f.ensure().catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: "UNAVAILABLE",
    });
    expect(Reflect.ownKeys(error as object)).not.toContain("$response");
    expect(body.destroyed).toBe(true);
    expect(produced).toBeLessThan(20);
  });
  it("rejects arbitrary streaming chunks and safe-projects transport errors", async () => {
    const f = fixture();
    const body = Readable.from([{}]);
    f.handle.mockResolvedValue(
      f.response(
        200,
        { ...f.metadata(), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    await expect(f.ensure()).rejects.toMatchObject({
      code: "OBJECT_MISMATCH",
      message: "OBJECT_MISMATCH",
    });
    expect(body.destroyed).toBe(true);
    f.handle.mockRejectedValue(new Error("synthetic private transport detail"));
    await expect(f.ensure()).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "UNAVAILABLE",
    });
  });
});

describe("input snapshots and lifetime fencing", () => {
  it.each([
    "missing",
    "duplicate",
    "wrong operation",
    "wrong index",
    "fragment reference",
  ])("rejects %s selected reservation before I/O", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.claim.assets = [];
    if (kind === "duplicate")
      f.claim.assets = [f.claim.assets[0], { ...f.claim.assets[0] }];
    if (kind === "wrong operation")
      f.claim.assets[0].operationId = createUuidV7();
    if (kind === "wrong index") f.claim.assets[0].assetIndex = 1;
    if (kind === "fragment reference")
      f.claim.assets[0].reference += "#fragment";
    await expect(f.ensure()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it("safe-projects a malformed non-cloneable worker input", async () => {
    const f = fixture();
    await expect(
      f.api.ensureAsset({
        claim: { ...f.claim, injected() {} } as typeof f.claim,
        assetKey: f.assetKey,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it.each([NaN, -1, 0.5])(
    "rejects invalid current clock %s before provider I/O",
    async (time) => {
      const f = fixture();
      f.time = time;
      await expect(f.ensure()).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it("clips stalled provider work to a shorter claim deadline", async () => {
    const f = fixture({ ioTimeoutMs: 500 });
    f.claim.claimExpiresAtMs = f.time + 20;
    const body = new Readable({ read() {} });
    f.handle.mockResolvedValue(
      f.response(
        200,
        { ...f.metadata(), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    await expect(f.ensure()).rejects.toMatchObject({ code: "EXPIRED" });
    expect(body.destroyed).toBe(true);
  });
  it.each([
    "operationId",
    "actorId",
    "bundleId",
    "ritualId",
    "claimId",
  ] as const)("rejects noncanonical claim %s without I/O", async (field) => {
    const f = fixture();
    f.claim[field] = "invalid";
    await expect(f.ensure()).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it.each(["future", "expired", "intent-expired", "credentials-expired"])(
    "rejects %s temporal authority before I/O",
    async (kind) => {
      const settings = config();
      if (kind === "credentials-expired")
        settings.credentials.expiration = new Date(Date.now() - 1);
      const f = fixture({ settings });
      if (kind === "future") f.time = f.claim.claimStartedAtMs - 1;
      if (kind === "expired") f.time = f.claim.claimExpiresAtMs;
      if (kind === "intent-expired") f.time = f.claim.intentExpiresAtMs;
      await expect(f.ensure()).rejects.toMatchObject({ code: "EXPIRED" });
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it("snapshots caller buffers, claim and configuration before waiting for the first GET", async () => {
    const f = fixture();
    const expected = f.bytes.slice(),
      saved = structuredClone(f.claim);
    const held = deferred<ReturnType<typeof f.response>>();
    f.handle.mockImplementationOnce(() => held.promise);
    const pending = f.ensure();
    f.bytes.fill(0);
    f.claim.assets[0].objectKey = "changed";
    f.claim.claimId = createUuidV7();
    f.settings.endpoint =
      "https://11111111111111111111111111111111.r2.cloudflarestorage.com";
    f.settings.credentials.secretAccessKey = "changed";
    held.resolve(f.errorResponse());
    const receipt = await pending;
    expect(receipt.claimId).toBe(saved.claimId);
    expect(receipt.objectKey).toBe(saved.assets[0].objectKey);
    expect([...f.objects.values()][0].bytes).toEqual(expected);
    expect(
      f.requests.every((request) =>
        request.hostname.startsWith("00000000000000000000000000000000."),
      ),
    ).toBe(true);
  });
  it.each(["size", "sha"])(
    "refuses caller bytes with mismatching %s",
    async (kind) => {
      const f = fixture();
      const bytes = kind === "size" ? f.bytes.subarray(1) : f.bytes.slice();
      if (kind === "sha") bytes[0] ^= 1;
      await expect(
        f.api.ensureAsset({ claim: f.claim, assetKey: f.assetKey, bytes }),
      ).rejects.toMatchObject({ code: "OBJECT_MISMATCH" });
      expect(f.objects.size).toBe(0);
      expect(f.requests.some((request) => request.method === "PUT")).toBe(
        false,
      );
    },
  );
  it("rejects pre-aborted and destroyed work without provider calls", async () => {
    const f = fixture();
    await expect(f.ensure(f.bytes, AbortSignal.abort())).rejects.toMatchObject({
      code: "ABORTED",
    });
    f.api.destroy();
    await expect(f.ensure()).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it.each(["timeout", "abort", "destroy"])(
    "closes a stalled successful GET on %s",
    async (kind) => {
      const f = fixture({ ioTimeoutMs: kind === "timeout" ? 50 : 500 });
      const body = new Readable({ read() {} });
      f.handle.mockResolvedValue(
        f.response(
          200,
          { ...f.metadata(), "content-length": String(f.bytes.length) },
          body,
        ),
      );
      const controller = new AbortController();
      const pending = f.ensure(f.bytes, controller.signal);
      const failure = expect(pending).rejects.toMatchObject({
        code: kind === "timeout" ? "TIMEOUT" : "ABORTED",
      });
      await vi.waitFor(() => expect(f.handle).toHaveBeenCalled(), {
        interval: 1,
      });
      if (kind === "abort") controller.abort();
      if (kind === "destroy") f.api.destroy();
      await failure;
      expect(body.destroyed).toBe(true);
      expect(f.objects.size).toBe(0);
    },
  );
  it.each(["timeout", "abort"])(
    "closes a GET response arriving after %s",
    async (kind) => {
      const f = fixture({ ioTimeoutMs: kind === "timeout" ? 50 : 500 });
      const held = deferred<ReturnType<typeof f.response>>();
      f.handle.mockImplementation(() => held.promise);
      const controller = new AbortController();
      const pending = f.ensure(f.bytes, controller.signal);
      const failure = expect(pending).rejects.toMatchObject({
        code: kind === "timeout" ? "TIMEOUT" : "ABORTED",
      });
      await vi.waitFor(() => expect(f.handle).toHaveBeenCalled(), {
        interval: 1,
      });
      if (kind === "abort") controller.abort();
      await failure;
      const body = new Readable({ read() {} });
      held.resolve(
        f.response(
          200,
          { ...f.metadata(), "content-length": String(f.bytes.length) },
          body,
        ),
      );
      await vi.waitFor(() => expect(body.destroyed).toBe(true));
      expect(f.objects.size).toBe(0);
    },
  );
  it("does not return a receipt when its claim expires during a successful GET", async () => {
    const f = fixture();
    f.existing();
    const actual = f.handle.getMockImplementation()!;
    f.handle.mockImplementation(async (request, options) => {
      const result = await actual(request, options);
      f.time = f.claim.claimExpiresAtMs;
      return result;
    });
    await expect(f.ensure()).rejects.toMatchObject({ code: "EXPIRED" });
    expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
  });
  it("does not publish a receipt when cancellation arrives with the end of the object body", async () => {
    const f = fixture();
    const controller = new AbortController();
    const body = Readable.from([f.bytes]);
    body.once("end", () => controller.abort());
    f.handle.mockResolvedValue(
      f.response(
        200,
        { ...f.metadata(), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    await expect(f.ensure(f.bytes, controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(body.destroyed).toBe(true);
    expect(f.handle).toHaveBeenCalledTimes(1);
    expect(f.objects.size).toBe(0);
  });
  it("retains an unsettled PUT buffer until transport completion and then reconciles the owned object", async () => {
    const f = fixture({ ioTimeoutMs: 50 });
    const actual = f.handle.getMockImplementation()!;
    const held = deferred<void>(),
      started = deferred<void>();
    let inFlight: Uint8Array | undefined;
    f.handle.mockImplementation(async (request, options) => {
      if (request.method !== "PUT") return actual(request, options);
      inFlight = request.body as Uint8Array;
      started.resolve();
      await held.promise;
      return actual(request, options);
    });
    const pending = f.ensure();
    const failure = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await started.promise;
    await failure;
    expect(inFlight).toEqual(f.bytes);
    held.resolve();
    await vi.waitFor(() => expect(f.objects.size).toBe(1));
    await settle();
    expect(inFlight?.every((byte) => byte === 0)).toBe(true);
    assertReceipt(
      f,
      await f.api.ensureAsset({ claim: f.claim, assetKey: f.assetKey }),
    );
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
  });
  it("bounds active and unsettled provider calls, then frees capacity on actual settlement", async () => {
    const f = fixture({ ioTimeoutMs: 50 });
    const held = Array.from({ length: 4 }, () =>
      deferred<ReturnType<typeof f.response>>(),
    );
    let count = 0;
    f.handle.mockImplementation(() => held[count++].promise);
    const attempts = Array.from({ length: 4 }, () => f.ensure());
    const failures = attempts.map((attempt) =>
      expect(attempt).rejects.toMatchObject({ code: "TIMEOUT" }),
    );
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalledTimes(4), {
      interval: 1,
    });
    await expect(f.ensure()).rejects.toMatchObject({ code: "BUSY" });
    await expect(f.api.readAsset(readDescriptor(f))).rejects.toMatchObject({
      code: "BUSY",
    });
    await Promise.all(failures);
    await expect(f.ensure()).rejects.toMatchObject({ code: "BUSY" });
    for (const entry of held) entry.resolve(f.errorResponse());
    await settle();
    await settle();
    f.handle.mockResolvedValue(f.errorResponse(403, "AccessDenied"));
    await vi.waitFor(async () =>
      expect(
        f.api.ensureAsset({ claim: f.claim, assetKey: f.assetKey }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" }),
    );
  });
});

describe("bounded storage reads from authorized SQL descriptors", () => {
  it("rejects malformed read bindings and non-cloneable descriptors before I/O", async () => {
    const f = fixture();
    const descriptor = readDescriptor(f);
    for (const input of [
      null,
      { ...descriptor, expectedActorId: "bad" },
      { ...descriptor, receiptSha256: "bad" },
      { ...descriptor, sha256: "bad" },
      { ...descriptor, mime: "image/avif" },
      { ...descriptor, byteSize: 0 },
    ])
      await expect(
        f.api.readAsset(input as SqlRitualBundleAsset),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      f.api.readAsset({ ...descriptor, injected() {} } as SqlRitualBundleAsset),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it("rejects pre-aborted and destroyed read calls before I/O", async () => {
    const f = fixture();
    await expect(
      f.api.readAsset(readDescriptor(f), AbortSignal.abort()),
    ).rejects.toMatchObject({ code: "ABORTED" });
    f.api.destroy();
    await expect(f.api.readAsset(readDescriptor(f))).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(f.handle).not.toHaveBeenCalled();
  });
  it.each([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ] as const)(
    "returns independent exact %s bytes without a worker claim or write",
    async (mime) => {
      const f = fixture({ mime });
      f.existing();
      const descriptor = readDescriptor(f);
      const first = await f.api.readAsset(descriptor);
      expect(first).toEqual(f.bytes);
      first!.fill(0);
      const second = await f.api.readAsset(descriptor);
      expect(second).toEqual(f.bytes);
      expect(f.objects.get(f.key())!.bytes).toEqual(f.bytes);
      expect(f.requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
      ]);
    },
  );
  it("returns null only for a genuinely missing owned object", async () => {
    const f = fixture();
    expect(await f.api.readAsset(readDescriptor(f))).toBeNull();
    f.handle.mockResolvedValue(f.errorResponse(404, "AccessDenied"));
    await expect(f.api.readAsset(readDescriptor(f))).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(f.objects.size).toBe(0);
  });
  it.each(["provider", "bucket", "objectKey"] as const)(
    "rejects a substituted read %s before I/O",
    async (field) => {
      const f = fixture();
      const descriptor = readDescriptor(f);
      descriptor.location[field] = "different-owner";
      await expect(f.api.readAsset(descriptor)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it("rejects correct bytes whose immutable operation metadata disagrees with SQL", async () => {
    const f = fixture();
    f.existing();
    const descriptor = readDescriptor(f);
    descriptor.operationId = createUuidV7();
    await expect(f.api.readAsset(descriptor)).rejects.toMatchObject({
      code: "OBJECT_MISMATCH",
    });
    expect(f.requests.map((request) => request.method)).toEqual(["GET"]);
  });
  it("snapshots a read descriptor before asynchronous provider access", async () => {
    const f = fixture();
    const descriptor = readDescriptor(f);
    const held = deferred<ReturnType<typeof f.response>>();
    f.handle.mockImplementation(() => held.promise);
    const pending = f.api.readAsset(descriptor);
    descriptor.location.objectKey = "changed";
    descriptor.sha256 = "f".repeat(64);
    descriptor.operationId = createUuidV7();
    held.resolve(
      f.response(
        200,
        { ...f.metadata(), "content-length": String(f.bytes.length) },
        Readable.from([f.bytes]),
      ),
    );
    expect(await pending).toEqual(f.bytes);
  });
  it("honors lifetime cancellation of readAsset and closes the streamed body", async () => {
    const f = fixture();
    const body = new Readable({ read() {} });
    f.handle.mockResolvedValue(
      f.response(
        200,
        { ...f.metadata(), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    const pending = f.api.readAsset(readDescriptor(f));
    const failure = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalled(), {
      interval: 1,
    });
    f.api.destroy();
    await failure;
    expect(body.destroyed).toBe(true);
  });
});
