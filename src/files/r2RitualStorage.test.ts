import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type LoomFileStoragePutInput,
  readLoomFileBodyBytes,
  sha256Hex,
} from "@gadicc/loom/files";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  createMinioRitualStorage,
  createR2RitualStorage,
  type MinioRitualStorageConfig,
  type R2RitualStorageConfig,
} from "./r2RitualStorage";
import type { RitualUploadClaim } from "./ritualUploadContracts";

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/s3-request-presigner", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@aws-sdk/s3-request-presigner")>();
  return { ...original, getSignedUrl: vi.fn(original.getSignedUrl) };
});
interface Request {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}
interface ObjectValue {
  bytes: Uint8Array;
  headers: Record<string, string>;
}
const active = () => new AbortController().signal;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function config(): R2RitualStorageConfig {
  return {
    kind: "r2",
    endpoint:
      "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
    bucket: "synthetic-ritual-private",
    credentials: {
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "synthetic-secret-not-a-real-credential",
    },
    stagingPrefix: "ritual-staging",
    canonicalPrefix: "ritual-canonical",
  };
}
const closed: (() => void)[] = [];
afterEach(() => {
  for (const close of closed.splice(0)) close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture(
  extra: {
    ioTimeoutMs?: number;
    config?: R2RitualStorageConfig | MinioRitualStorageConfig;
  } = {},
) {
  const objects = new Map<string, ObjectValue>(),
    requests: Request[] = [];
  const settings = extra.config ?? config();
  const response = (
    statusCode: number,
    headers: Record<string, string>,
    body: Readable,
  ) => ({ response: { statusCode, headers, body } });
  const missing = () =>
    response(
      404,
      { "content-type": "application/xml" },
      Readable.from([
        "<Error><Code>NoSuchKey</Code><Message>synthetic missing</Message></Error>",
      ]),
    );
  const handle = vi.fn(
    async (
      request: Request,
      _options?: { abortSignal?: { aborted: boolean } },
    ) => {
      requests.push(request);
      const key = decodeURIComponent(
        request.path.slice(settings.bucket.length + 2),
      );
      if (request.method === "PUT") {
        if (objects.has(key))
          return response(
            412,
            { "content-type": "application/xml" },
            Readable.from(["<Error><Code>PreconditionFailed</Code></Error>"]),
          );
        if (!(request.body instanceof Uint8Array))
          throw new Error("Unexpected synthetic body");
        objects.set(key, {
          bytes: new Uint8Array(request.body),
          headers: { ...request.headers },
        });
        return response(200, {}, Readable.from([]));
      }
      if (request.method === "GET") {
        const value = objects.get(key);
        if (!value) return missing();
        const metadata = Object.fromEntries(
          Object.entries(value.headers).filter(([key]) =>
            key.startsWith("x-amz-meta-"),
          ),
        );
        return response(
          200,
          {
            ...metadata,
            "content-length": String(value.bytes.length),
            "content-type": value.headers["content-type"],
          },
          Readable.from([value.bytes]),
        );
      }
      throw new Error("Unexpected provider command");
    },
  );
  const options = {
    requestHandler: { handle },
    ...(extra.ioTimeoutMs ? { ioTimeoutMs: extra.ioTimeoutMs } : {}),
  };
  const api =
    settings.kind === "r2"
      ? createR2RitualStorage(settings, options)
      : createMinioRitualStorage(settings, options);
  closed.push(() => api.destroy());
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const request = {
    version: 1 as const,
    operationId: createUuidV7(),
    expectedActorId: createUuidV7(),
    ritualId: createUuidV7(),
    filename: "守護.png",
    byteSize: bytes.length,
    contentType: "image/png" as const,
    sha256: await sha256Hex(bytes),
  };
  const identity = {
    request,
    fileId: createUuidV7(),
    attachmentId: createUuidV7(),
  };
  const claim: RitualUploadClaim & { capabilityExpiresAtMs: number } = {
    ...identity,
    ...api.locations(identity),
    intentExpiresAtMs: Date.now() + 86400000,
    capabilityExpiresAtMs: Date.now() + 600000,
    claimId: createUuidV7(),
    claimExpiresAtMs: Date.now() + 120000,
  };
  const put: LoomFileStoragePutInput = {
    body: bytes,
    byteSize: bytes.length,
    contentType: "image/png",
    detectedContentType: "image/png",
    objectKey: claim.canonical.objectKey,
    sha256: request.sha256,
    metadata: { sha256: request.sha256 },
  };
  return {
    api,
    settings,
    bytes,
    claim,
    put,
    objects,
    requests,
    handle,
    response,
    missing,
  };
}
function stagingHeaders(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    "content-type": f.claim.request.contentType,
    "x-amz-meta-sha256": f.claim.request.sha256,
    "x-amz-meta-magickli-operation-id": f.claim.request.operationId,
    "x-amz-meta-magickli-file-id": f.claim.fileId,
  };
}
function verifySignature(
  url: URL,
  headers: Record<string, string>,
  size: number,
  secret: string,
) {
  const encode = (s: string) =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const names = url.searchParams.get("X-Amz-SignedHeaders")!.split(";");
  const actual: Record<string, string> = {
    ...headers,
    host: url.host,
    "content-length": String(size),
  };
  const canonicalHeaders = names
    .map((name) => `${name}:${actual[name].trim()}\n`)
    .join("");
  const query = [...url.searchParams]
    .filter(([key]) => key !== "X-Amz-Signature")
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .sort()
    .join("&");
  const canonical = [
    "PUT",
    url.pathname,
    query,
    canonicalHeaders,
    names.join(";"),
    url.searchParams.get("X-Amz-Content-Sha256"),
  ].join("\n");
  const [access, date, region, service, terminal] = url.searchParams
    .get("X-Amz-Credential")!
    .split("/");
  expect(access).toBe("AKIDEXAMPLE");
  expect(region).toBe("auto");
  expect(service).toBe("s3");
  const hmac = (key: string | Buffer, data: string) =>
    createHmac("sha256", key).update(data).digest();
  const key = hmac(
    hmac(hmac(hmac(`AWS4${secret}`, date), region), service),
    terminal,
  );
  const expected = createHmac("sha256", key)
    .update(
      [
        "AWS4-HMAC-SHA256",
        url.searchParams.get("X-Amz-Date"),
        [date, region, service, terminal].join("/"),
        createHash("sha256").update(canonical).digest("hex"),
      ].join("\n"),
    )
    .digest("hex");
  expect(url.searchParams.get("X-Amz-Signature")).toBe(expected);
}

describe("closed R2 direct capability", () => {
  it("signs exact staging path, SHA, MIME, length, absence and header provenance with actual SDK", async () => {
    const f = await fixture(),
      upload = await f.api.directUpload(f.claim, active());
    expect(upload.kind).toBe("presigned-put");
    if (upload.kind !== "presigned-put") throw new Error("wrong kind");
    const url = new URL(upload.url);
    expect(url.origin).toBe(f.settings.endpoint);
    expect(url.pathname).toBe(
      `/${f.settings.bucket}/${f.claim.staging.objectKey}`,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")!.split(";")).toEqual([
      "content-length",
      "content-type",
      "host",
      "if-none-match",
      "x-amz-checksum-sha256",
      "x-amz-meta-magickli-file-id",
      "x-amz-meta-magickli-operation-id",
      "x-amz-meta-sha256",
    ]);
    for (const key of Object.keys(upload.headers))
      expect(url.searchParams.has(key)).toBe(false);
    expect(upload.headers["content-length"]).toBeUndefined();
    expect(upload.headers["content-type"]).toBe("image/png");
    expect(upload.headers["if-none-match"]).toBe("*");
    expect(upload.headers["x-amz-checksum-sha256"]).toBe(
      Buffer.from(f.claim.request.sha256, "hex").toString("base64"),
    );
    expect(upload.headers["x-amz-meta-magickli-operation-id"]).toBe(
      f.claim.request.operationId,
    );
    expect(upload.headers["x-amz-meta-magickli-file-id"]).toBe(f.claim.fileId);
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(upload.url).not.toContain("acl");
    expect(upload.url).not.toContain("expected-bucket-owner");
    verifySignature(
      url,
      upload.headers,
      f.bytes.length,
      f.settings.credentials.secretAccessKey,
    );
    expect(f.handle).not.toHaveBeenCalled();
  });
  it("clips actual signed expiration to SQL capability, intent, credentials and ten minutes", async () => {
    const f = await fixture();
    for (const field of [
      "capabilityExpiresAtMs",
      "intentExpiresAtMs",
    ] as const) {
      f.claim[field] = Date.now() + 21000;
      const result = await f.api.directUpload(f.claim, active());
      expect(result.expiresAtMs).toBeLessThanOrEqual(f.claim[field]);
      expect(result.expiresAtMs).toBeGreaterThan(Date.now() + 18000);
      f.claim[field] = Date.now() + 86400000;
    }
    const result = await f.api.directUpload(f.claim, active());
    expect(result.expiresAtMs).toBeLessThanOrEqual(Date.now() + 600000);
    expect(Number(new URL(result.url).searchParams.get("X-Amz-Expires"))).toBe(
      600,
    );
    const settings = config();
    settings.credentials.expiration = new Date(Date.now() + 41000);
    settings.credentials.sessionToken = "synthetic-session";
    const g = await fixture({ config: settings });
    const bounded = await g.api.directUpload(g.claim, active());
    expect(bounded.expiresAtMs).toBeLessThanOrEqual(
      settings.credentials.expiration.getTime(),
    );
    expect(new URL(bounded.url).searchParams.get("X-Amz-Security-Token")).toBe(
      "synthetic-session",
    );
  });
  it("copies configuration and descriptor before asynchronous signing and ignores ambient AWS endpoints", async () => {
    vi.stubEnv("AWS_ENDPOINT_URL", "https://untrusted.example");
    vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://untrusted.example");
    vi.stubEnv("AWS_REGION", "us-east-1");
    const f = await fixture();
    const expected = structuredClone(f.claim);
    const pending = f.api.directUpload(f.claim, active());
    f.claim.staging.objectKey = "other";
    f.claim.request.sha256 = "f".repeat(64);
    f.settings.endpoint = "https://other.example";
    f.settings.credentials.secretAccessKey = "changed";
    const result = await pending;
    if (result.kind !== "presigned-put") throw new Error("wrong kind");
    expect(new URL(result.url).pathname).toContain(expected.staging.objectKey);
    expect(result.headers["x-amz-meta-sha256"]).toBe(expected.request.sha256);
    verifySignature(
      new URL(result.url),
      result.headers,
      expected.request.byteSize,
      "synthetic-secret-not-a-real-credential",
    );
  });
  it.each([
    "provider",
    "bucket",
    "stagingKey",
    "canonicalKey",
    "fileId",
  ] as const)(
    "rejects substituted %s before issuing a capability",
    async (field) => {
      const f = await fixture();
      if (field === "provider") f.claim.staging.provider = "custom";
      if (field === "bucket") f.claim.canonical.bucket = "other";
      if (field === "stagingKey")
        f.claim.staging.objectKey = f.claim.canonical.objectKey;
      if (field === "canonicalKey")
        f.claim.canonical.objectKey = f.claim.staging.objectKey;
      if (field === "fileId") f.claim.fileId = createUuidV7();
      await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject(
        { code: "UNAVAILABLE" },
      );
      expect(f.handle).not.toHaveBeenCalled();
    },
  );
  it.each([
    { kind: "aws-s3" },
    { endpoint: "https://example.com" },
    { endpoint: config().endpoint + "/bucket" },
    { endpoint: config().endpoint + "/" },
    { bucket: "bad.bucket" },
    { stagingPrefix: "same", canonicalPrefix: "same" },
    { stagingPrefix: "files", canonicalPrefix: "files/canonical" },
    { stagingPrefix: "files/staging", canonicalPrefix: "files" },
    { stagingPrefix: "../staging" },
    { canonicalPrefix: "/canonical" },
    { stagingPrefix: "a".repeat(513) },
    { canonicalPrefix: "a".repeat(513) },
    { credentials: undefined },
    { credentials: { accessKeyId: "", secretAccessKey: "" } },
    {
      credentials: { accessKeyId: "a", secretAccessKey: "b", sessionToken: "" },
    },
    {
      credentials: {
        accessKeyId: "a",
        secretAccessKey: "b",
        expiration: new Date(NaN),
      },
    },
  ])("rejects invalid configuration %#", (value) =>
    expect(() =>
      createR2RitualStorage({ ...config(), ...value } as R2RitualStorageConfig),
    ).toThrow("Invalid R2 ritual storage configuration"),
  );
  it("rejects expired, malformed and pre-aborted capabilities", async () => {
    const f = await fixture();
    for (const value of [NaN, -1, Number.MAX_SAFE_INTEGER]) {
      f.claim.capabilityExpiresAtMs = value;
      await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject(
        { code: "UNAVAILABLE" },
      );
    }
    f.claim.capabilityExpiresAtMs = Date.now() + 500;
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "EXPIRED",
    });
    f.claim.capabilityExpiresAtMs = Date.now() + 60000;
    f.claim.intentExpiresAtMs = Date.now();
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "EXPIRED",
    });
    f.claim.intentExpiresAtMs = NaN;
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    f.claim.intentExpiresAtMs = Date.now() + 60000;
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.api.directUpload(f.claim, controller.signal),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
  it("rejects malformed request and invalid canonical IDs at the explicit boundary", async () => {
    const f = await fixture();
    f.claim.request.byteSize = 0;
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(() => f.api.locations(f.claim)).toThrow("INVALID_REQUEST");
    f.claim.request.byteSize = f.bytes.length;
    f.claim.attachmentId = "not-uuid";
    expect(() => f.api.locations(f.claim)).toThrow("INVALID_REQUEST");
  });
});

describe("closed MinIO direct capability", () => {
  it("retains the signed S3 contract with distinct MinIO locations", async () => {
    const f = await fixture({
      config: {
        ...config(),
        kind: "minio",
        endpoint: "http://127.0.0.1:9125",
      },
    });
    expect(f.claim.staging.provider).toBe("minio");
    expect(f.claim.canonical.provider).toBe("minio");
    const upload = await f.api.directUpload(f.claim, active());
    if (upload.kind !== "presigned-put") throw new Error("wrong kind");
    expect(new URL(upload.url).origin).toBe("http://127.0.0.1:9125");
    expect(upload.headers["if-none-match"]).toBe("*");
    expect(upload.headers["x-amz-checksum-sha256"]).toBeTruthy();
    expect(f.handle).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:9125",
    "http://127.0.0.1.evil.test:9125",
    "http://2130706433:9125",
    "http://127.0.0.1:9125/path",
    "https://127.0.0.1:9125",
  ])("rejects noncanonical MinIO endpoint %s", (endpoint) => {
    expect(() =>
      createMinioRitualStorage({
        ...config(),
        kind: "minio",
        endpoint,
      }),
    ).toThrow("Invalid MinIO ritual storage configuration");
  });
});

describe("conditional canonical storage and owned orphan recovery", () => {
  it("uses Loom conditional PUT with explicit checksum and immutable operation provenance", async () => {
    const f = await fixture();
    const store = f.api.storage.canonicalStorage(f.claim, active());
    await expect(store.putObject(f.put)).resolves.toEqual({
      bucket: f.claim.canonical.bucket,
      objectKey: f.claim.canonical.objectKey,
      storageProvider: "r2",
    });
  });
  it("recovers an identical same-operation object by reading and hashing actual bytes", async () => {
    const f = await fixture();
    const store = f.api.storage.canonicalStorage(f.claim, active());
    await store.putObject(f.put);
    await store.putObject(f.put);
    expect(f.requests.map((r) => r.method)).toEqual(["PUT", "PUT", "GET"]);
    expect(f.objects.size).toBe(1);
    const headers = f.requests[0].headers;
    expect(headers["if-none-match"]).toBe("*");
    expect(headers["x-amz-expected-bucket-owner"]).toBeUndefined();
    expect(headers["x-amz-checksum-sha256"]).toBe(
      Buffer.from(f.put.sha256, "hex").toString("base64"),
    );
    expect(headers["x-amz-meta-magickli-operation-id"]).toBe(
      f.claim.request.operationId,
    );
    expect(headers["x-amz-meta-magickli-file-id"]).toBe(f.claim.fileId);
    expect(f.requests.some((r) => r.headers["x-amz-copy-source"])).toBe(false);
  });
  it.each(["bytes", "owner", "file", "mime", "sha", "size"] as const)(
    "does not mistake mismatching orphan %s for success",
    async (mismatch) => {
      const f = await fixture();
      const store = f.api.storage.canonicalStorage(f.claim, active());
      await store.putObject(f.put);
      const object = f.objects.get(f.claim.canonical.objectKey)!;
      if (mismatch === "bytes") object.bytes[object.bytes.length - 1] ^= 1;
      if (mismatch === "size") object.bytes = object.bytes.subarray(1);
      if (mismatch === "owner")
        object.headers["x-amz-meta-magickli-operation-id"] = createUuidV7();
      if (mismatch === "file")
        object.headers["x-amz-meta-magickli-file-id"] = createUuidV7();
      if (mismatch === "mime") object.headers["content-type"] = "image/jpeg";
      if (mismatch === "sha")
        object.headers["x-amz-meta-sha256"] = "f".repeat(64);
      await expect(store.putObject(f.put)).rejects.toMatchObject({
        code: "DUPLICATE",
      });
      expect(f.requests.map((r) => r.method)).toEqual(["PUT", "PUT", "GET"]);
    },
  );
  it("does not treat a conditional conflict followed by a missing object as success", async () => {
    const f = await fixture();
    f.handle.mockImplementation(async (request) =>
      request.method === "PUT"
        ? f.response(
            409,
            { "content-type": "application/xml" },
            Readable.from([
              "<Error><Code>ConditionalRequestConflict</Code></Error>",
            ]),
          )
        : f.missing(),
    );
    await expect(
      f.api.storage.canonicalStorage(f.claim, active()).putObject(f.put),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("rejects substituted canonical writes and expired worker claims before sending", async () => {
    const f = await fixture();
    const store = f.api.storage.canonicalStorage(f.claim, active());
    await expect(
      store.putObject({ ...f.put, objectKey: f.claim.staging.objectKey }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    vi.spyOn(Date, "now").mockReturnValue(f.claim.claimExpiresAtMs);
    await expect(store.putObject(f.put)).rejects.toMatchObject({
      code: "EXPIRED",
    });
    expect(f.handle).not.toHaveBeenCalled();
  });
});

describe("bounded staging streams and provider failure cleanup", () => {
  it("returns a cancellable SDK stream and preserves exact body bytes", async () => {
    const f = await fixture();
    f.objects.set(f.claim.staging.objectKey, {
      bytes: f.bytes,
      headers: stagingHeaders(f),
    });
    const object = await f.api.storage.readStaging(f.claim, active());
    expect(object?.byteSize).toBe(f.bytes.length);
    expect(await readLoomFileBodyBytes(object!.body)).toEqual(f.bytes);
    object!.close();
    expect(
      f.requests[0].headers["x-amz-expected-bucket-owner"],
    ).toBeUndefined();
  });
  it("returns null only for missing staging, not denied provider access", async () => {
    const f = await fixture();
    expect(await f.api.storage.readStaging(f.claim, active())).toBeNull();
    f.handle.mockResolvedValue(
      f.response(
        403,
        { "content-type": "application/xml" },
        Readable.from([
          "<Error><Code>AccessDenied</Code><Message>synthetic private detail</Message></Error>",
        ]),
      ),
    );
    await expect(
      f.api.storage.readStaging(f.claim, active()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  });
  it("aborts and closes a stream while Loom owns its reader", async () => {
    const f = await fixture();
    const body = new Readable({ read() {} });
    f.handle.mockResolvedValue(
      f.response(200, { ...stagingHeaders(f), "content-length": "12" }, body),
    );
    const controller = new AbortController();
    const object = await f.api.storage.readStaging(f.claim, controller.signal);
    const pending = readLoomFileBodyBytes(object!.body);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    controller.abort();
    await rejected;
    expect(body.destroyed).toBe(true);
    object!.close();
  });
  it("bounds stalled body reads with a real transport deadline", async () => {
    const f = await fixture({ ioTimeoutMs: 30 });
    const body = new Readable({ read() {} });
    f.handle.mockResolvedValue(
      f.response(200, { ...stagingHeaders(f), "content-length": "12" }, body),
    );
    const object = await f.api.storage.readStaging(f.claim, active());
    await expect(readLoomFileBodyBytes(object!.body)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(body.destroyed).toBe(true);
    object!.close();
  });
  it("closes a provider response which arrives after timeout", async () => {
    const f = await fixture({ ioTimeoutMs: 30 });
    const late = deferred<ReturnType<typeof f.response>>();
    f.handle.mockImplementation(() => late.promise);
    await expect(
      f.api.storage.readStaging(f.claim, active()),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    const body = new Readable({ read() {} });
    late.resolve(
      f.response(200, { ...stagingHeaders(f), "content-length": "12" }, body),
    );
    await vi.waitFor(() => expect(body.destroyed).toBe(true), {
      timeout: 1000,
    });
  });
  it("retains an unknown late write for bounded same-operation reconciliation, with no deletion or overwrite", async () => {
    const f = await fixture({ ioTimeoutMs: 30 });
    const actual = f.handle.getMockImplementation()!;
    const late = deferred<Awaited<ReturnType<typeof actual>>>();
    const stored = deferred<void>();
    f.handle.mockImplementationOnce(async (request, options) => {
      const result = await actual(request, options);
      stored.resolve();
      await late.promise;
      return result;
    });
    const store = f.api.storage.canonicalStorage(f.claim, active());
    const pending = store.putObject(f.put);
    await stored.promise;
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    late.resolve(f.response(200, {}, Readable.from([])));
    await vi.waitFor(() => expect(f.objects.size).toBe(1));
    await expect(store.putObject(f.put)).resolves.toMatchObject({
      objectKey: f.claim.canonical.objectKey,
    });
    expect(f.requests.map((r) => r.method)).toEqual(["PUT", "PUT", "GET"]);
  });
});

describe("storage boundary failure and cancellation contracts", () => {
  it("accepts explicit default transport construction but rejects invalid IO limits", () => {
    const api = createR2RitualStorage(config());
    api.destroy();
    for (const ioTimeoutMs of [0, -1, 30001, NaN])
      expect(() => createR2RitualStorage(config(), { ioTimeoutMs })).toThrow(
        "Invalid storage timeout",
      );
  });
  it("rejects malformed worker tokens and pre-aborted read/write before sending", async () => {
    const f = await fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(
      f.api.storage.readStaging(f.claim, controller.signal),
    ).rejects.toMatchObject({ code: "ABORTED" });
    await expect(
      f.api.storage
        .canonicalStorage(f.claim, controller.signal)
        .putObject(f.put),
    ).rejects.toMatchObject({ code: "ABORTED" });
    f.claim.claimId = "not-uuid";
    await expect(
      f.api.storage.readStaging(f.claim, active()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    f.claim.claimId = createUuidV7();
    f.claim.claimExpiresAtMs = NaN;
    expect(() => f.api.storage.canonicalStorage(f.claim, active())).toThrow(
      "UNAVAILABLE",
    );
    expect(f.handle).not.toHaveBeenCalled();
  });
  it.each(["operation", "file", "sha", "mime", "length"] as const)(
    "closes staging with mismatching %s before its bytes reach finalization",
    async (field) => {
      const f = await fixture(),
        body = new Readable({ read() {} });
      const headers: Record<string, string> = {
        ...stagingHeaders(f),
        "content-length": String(f.bytes.length),
      };
      if (field === "operation")
        headers["x-amz-meta-magickli-operation-id"] = createUuidV7();
      if (field === "file")
        headers["x-amz-meta-magickli-file-id"] = createUuidV7();
      if (field === "sha") delete headers["x-amz-meta-sha256"];
      if (field === "mime")
        headers["content-type"] = "application/octet-stream";
      if (field === "length") headers["content-length"] = "1";
      f.handle.mockResolvedValue(f.response(200, headers, body));
      await expect(
        f.api.storage.readStaging(f.claim, active()),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(body.destroyed).toBe(true);
    },
  );
  it("does not reinterpret arbitrary HTTP404 provider errors as missing files", async () => {
    const f = await fixture();
    f.handle.mockResolvedValue(
      f.response(
        404,
        { "content-type": "application/xml" },
        Readable.from(["<Error><Code>AccessDenied</Code></Error>"]),
      ),
    );
    await expect(
      f.api.storage.readStaging(f.claim, active()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("maps provider PUT exceptions to safe unavailable failures", async () => {
    const f = await fixture();
    f.handle.mockRejectedValue(new Error("synthetic secret-provider-detail"));
    await expect(
      f.api.storage.canonicalStorage(f.claim, active()).putObject(f.put),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  });
  it("copies the canonical descriptor, metadata and bytes before asynchronous provider work", async () => {
    const f = await fixture(),
      saved = structuredClone(f.claim),
      bytes = f.bytes.slice();
    f.put.body = Buffer.from(f.bytes);
    const store = f.api.storage.canonicalStorage(f.claim, active());
    const result = store.putObject(f.put);
    f.claim.canonical.objectKey = "other";
    f.claim.request.sha256 = "f".repeat(64);
    f.claim.fileId = createUuidV7();
    f.put.body[0] ^= 1;
    f.put.metadata!.sha256 = "e".repeat(64);
    await expect(result).resolves.toMatchObject({
      objectKey: saved.canonical.objectKey,
    });
    const stored = f.objects.get(saved.canonical.objectKey)!;
    expect(stored.bytes).toEqual(bytes);
    expect(stored.headers["x-amz-meta-sha256"]).toBe(saved.request.sha256);
    expect(stored.headers["x-amz-meta-magickli-file-id"]).toBe(saved.fileId);
  });
  it("closes active reads when the adapter is destroyed and rejects subsequent work", async () => {
    const f = await fixture(),
      body = new Readable({ read() {} });
    f.handle.mockResolvedValue(
      f.response(
        200,
        { ...stagingHeaders(f), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    const object = await f.api.storage.readStaging(f.claim, active());
    const rejected = expect(
      readLoomFileBodyBytes(object!.body),
    ).rejects.toMatchObject({ code: "ABORTED" });
    f.api.destroy();
    await rejected;
    expect(body.destroyed).toBe(true);
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "ABORTED",
    });
    await expect(
      f.api.storage.readStaging(f.claim, active()),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
  it("closes a body received after caller abort before provider headers", async () => {
    const f = await fixture(),
      late = deferred<ReturnType<typeof f.response>>(),
      controller = new AbortController();
    f.handle.mockImplementation(() => late.promise);
    const pending = f.api.storage.readStaging(f.claim, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await vi.waitFor(() => expect(f.handle).toHaveBeenCalled());
    controller.abort();
    await rejected;
    const body = new Readable({ read() {} });
    late.resolve(
      f.response(
        200,
        { ...stagingHeaders(f), "content-length": String(f.bytes.length) },
        body,
      ),
    );
    await vi.waitFor(() => expect(body.destroyed).toBe(true));
  });
  it("retries a write after caller abort without deleting an acknowledged-later object", async () => {
    const f = await fixture(),
      controller = new AbortController();
    const actual = f.handle.getMockImplementation()!,
      late = deferred<Awaited<ReturnType<typeof actual>>>(),
      stored = deferred<void>();
    f.handle.mockImplementationOnce(async (request, options) => {
      const result = await actual(request, options);
      stored.resolve();
      await late.promise;
      return result;
    });
    const pending = f.api.storage
      .canonicalStorage(f.claim, controller.signal)
      .putObject(f.put);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await stored.promise;
    controller.abort();
    await rejected;
    late.resolve(f.response(200, {}, Readable.from([])));
    await expect(
      f.api.storage.canonicalStorage(f.claim, active()).putObject(f.put),
    ).resolves.toMatchObject({ objectKey: f.claim.canonical.objectKey });
    expect(f.requests.map((r) => r.method)).toEqual(["PUT", "PUT", "GET"]);
  });
  it("bounds a stalled orphan reconciliation and closes its body", async () => {
    const f = await fixture({ ioTimeoutMs: 30 }),
      body = new Readable({ read() {} });
    f.handle.mockImplementation(async (request) =>
      request.method === "PUT"
        ? f.response(
            412,
            { "content-type": "application/xml" },
            Readable.from(["<Error><Code>PreconditionFailed</Code></Error>"]),
          )
        : f.response(
            200,
            { ...stagingHeaders(f), "content-length": String(f.bytes.length) },
            body,
          ),
    );
    await expect(
      f.api.storage.canonicalStorage(f.claim, active()).putObject(f.put),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(body.destroyed).toBe(true);
  });
});

describe("safe signing failure projection", () => {
  it("does not expose raw signer failures", async () => {
    const f = await fixture();
    vi.mocked(getSignedUrl).mockRejectedValueOnce(
      new Error("synthetic private signer details"),
    );
    await expect(f.api.directUpload(f.claim, active())).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "UNAVAILABLE",
    });
  });
  it("does not return a capability whose SQL expiry elapsed while signing", async () => {
    const f = await fixture(),
      late = deferred<string>();
    vi.mocked(getSignedUrl).mockImplementationOnce(() => late.promise);
    const pending = f.api.directUpload(f.claim, active());
    vi.spyOn(Date, "now").mockReturnValue(f.claim.capabilityExpiresAtMs + 1);
    late.resolve("https://synthetic-unused.example");
    await expect(pending).rejects.toMatchObject({ code: "EXPIRED" });
  });
  it("times out or aborts stalled signing without returning a late credential", async () => {
    for (const mode of ["timeout", "abort"] as const) {
      const f = await fixture({ ioTimeoutMs: 30 }),
        late = deferred<string>(),
        controller = new AbortController();
      vi.mocked(getSignedUrl).mockImplementationOnce(() => late.promise);
      const pending = f.api.directUpload(f.claim, controller.signal);
      const rejected = expect(pending).rejects.toMatchObject({
        code: mode === "timeout" ? "TIMEOUT" : "ABORTED",
      });
      if (mode === "abort") controller.abort();
      await rejected;
      late.resolve("https://synthetic-unused.example");
      expect(f.handle).not.toHaveBeenCalled();
    }
  });
});

describe("bounded orphan body failure", () => {
  it.each(["oversized", "provider-error", "short"] as const)(
    "closes %s orphan responses without leaking raw failures",
    async (mode) => {
      const f = await fixture();
      const body = new Readable({
        read() {
          if (mode === "provider-error")
            this.destroy(new Error("synthetic private transport error"));
          else {
            this.push(
              new Uint8Array(mode === "oversized" ? 100 : f.bytes.length - 1),
            );
            this.push(null);
          }
        },
      });
      f.handle.mockImplementation(async (request) =>
        request.method === "PUT"
          ? f.response(
              412,
              { "content-type": "application/xml" },
              Readable.from(["<Error><Code>PreconditionFailed</Code></Error>"]),
            )
          : f.response(
              200,
              {
                ...stagingHeaders(f),
                "content-length": String(f.bytes.length),
              },
              body,
            ),
      );
      await expect(
        f.api.storage.canonicalStorage(f.claim, active()).putObject(f.put),
      ).rejects.toMatchObject({
        code: mode === "short" ? "DUPLICATE" : "UNAVAILABLE",
        message: mode === "short" ? "DUPLICATE" : "UNAVAILABLE",
      });
      expect(body.destroyed).toBe(true);
    },
  );
});
