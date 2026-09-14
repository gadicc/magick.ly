import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { EJSON, ObjectId } from "bson";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { planLegacyFileImport } from "../migration/planLegacyFileImport";
import {
  LEGACY_FILE_RELOCATION_BUCKET,
  LEGACY_FILE_RELOCATION_PREFIX,
  LEGACY_FILE_RELOCATION_PROFILE,
} from "./legacyFileLocation";
import {
  createLegacyRitualImageCatalog,
  type LegacyRitualImageSource,
  type LegacyRitualImageStorage,
} from "./legacyRitualImageCatalog";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import { RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";
import { createRitualSvgValidator } from "./validateRitualSvg";

vi.mock("server-only", () => ({}));
vi.mock("./validateRitualImage", async (original) => {
  const module = await original<typeof import("./validateRitualImage")>();
  return {
    ...module,
    createSharpRitualImageValidator: vi.fn(
      module.createSharpRitualImageValidator,
    ),
  };
});
vi.mock("./validateRitualSvg", async (original) => {
  const module = await original<typeof import("./validateRitualSvg")>();
  return {
    ...module,
    createRitualSvgValidator: vi.fn(module.createRitualSvgValidator),
  };
});
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const storage = (): LegacyRitualImageStorage => ({
  kind: "r2",
  endpoint: "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
  bucket: "synthetic-legacy-public",
  credentials: { accessKeyId: "EXAMPLE", secretAccessKey: "synthetic-only" },
});
const relocatedStorage = (): LegacyRitualImageStorage => ({
  ...storage(),
  bucket: LEGACY_FILE_RELOCATION_BUCKET,
  credentials: {
    accessKeyId: "NEWEXAMPLE",
    secretAccessKey: "new-synthetic-only",
  },
});
let png: Uint8Array;
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="12" height="9" fill="red"/></svg>',
);
beforeAll(async () => {
  png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
});
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});
function source(
  bytes = png,
  mime = "image/png",
  prefix = "synthetic-legacy-public/",
  original: Record<string, unknown> = {},
): LegacyRitualImageSource {
  const plan = planLegacyFileImport(
    [
      {
        _id: new ObjectId(),
        filename: "legacy-private-name.png",
        sha256: hash(bytes),
        size: bytes.length,
        type: "image",
        mimeType: mime,
        image: { width: 999, height: 999 },
        createdAt: new Date("2014-01-02"),
        ...original,
      },
    ],
    {
      lookup: () => createUuidV7(),
      storageProvider: "r2",
      sourceBucket: storage().bucket,
      sourceObjectKeyPrefix: prefix,
      importedAt: new Date("2026-09-12"),
    },
  );
  return {
    file: plan.files[0],
    snapshot: plan.snapshots[0],
  } as LegacyRitualImageSource;
}
function relocated(input = source()): LegacyRitualImageSource {
  input.relocation = {
    fileId: input.file.id,
    sourceStorageProvider: input.snapshot.sourceStorageProvider,
    sourceBucket: input.snapshot.sourceBucket,
    sourceObjectKey: input.snapshot.sourceObjectKey,
    sourceMetadataSha256: input.snapshot.sourceSha256,
    contentSha256: input.file.sha256,
    byteSize: input.file.byteSize,
    destinationStorageProvider: "r2",
    destinationBucket: LEGACY_FILE_RELOCATION_BUCKET,
    destinationObjectKey: `${LEGACY_FILE_RELOCATION_PREFIX}${input.file.sha256}`,
    verificationProfile: LEGACY_FILE_RELOCATION_PROFILE,
    verifiedAt: new Date("2026-09-13T00:00:00.000Z"),
  };
  return input;
}
type Request = {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
};
const response = (
  body: unknown,
  headers: Record<string, string> = {},
  statusCode = 200,
) => ({ response: { statusCode, headers, body } });
function transport(
  bytes = png,
  overrides: Record<string, string> = {},
  status = 200,
) {
  const bodies: Readable[] = [];
  const handle = vi.fn(async (_request: Request) => {
    const body = Readable.from([Buffer.from(bytes)]);
    bodies.push(body);
    return response(
      body,
      {
        "content-length": String(bytes.length),
        "content-type": "application/octet-stream",
        ...overrides,
      },
      status,
    );
  });
  return { handle, bodies };
}
async function capture(
  sources: LegacyRitualImageSource[],
  io = transport(),
  options: Partial<Parameters<typeof createLegacyRitualImageCatalog>[0]> = {},
) {
  const catalog = await createLegacyRitualImageCatalog({
    storage: storage(),
    sources,
    requestHandler: io,
    ...options,
  });
  disposers.push(catalog.dispose);
  return catalog;
}
async function rejectedSource(
  value: LegacyRitualImageSource[],
  options: Partial<Parameters<typeof createLegacyRitualImageCatalog>[0]> = {},
) {
  const io = transport();
  await expect(capture(value, io, options)).rejects.toMatchObject({
    code: "INVALID_SOURCE",
    message: "INVALID_SOURCE",
  });
  expect(io.handle).not.toHaveBeenCalled();
}

describe("closed legacy public image capture", () => {
  it("captures a verified relocation while retaining the original import rows", async () => {
    const input = relocated();
    const original = structuredClone({
      file: input.file,
      snapshot: input.snapshot,
    });
    const io = transport();
    const catalog = await capture([input], io, {
      storage: [storage(), relocatedStorage()],
    });

    expect(io.handle.mock.calls[0]?.[0]).toMatchObject({
      path: `/${LEGACY_FILE_RELOCATION_BUCKET}/${LEGACY_FILE_RELOCATION_PREFIX}${input.file.sha256}`,
    });
    expect(catalog.metadata.entries[0]).toMatchObject({
      kind: "available",
      sha256: input.file.sha256,
    });
    expect(input.file).toEqual(original.file);
    expect(input.snapshot).toEqual(original.snapshot);
  });

  it.each([
    "sourceMetadataSha256",
    "contentSha256",
    "byteSize",
    "destinationBucket",
    "destinationObjectKey",
    "verificationProfile",
    "verifiedAt",
  ] as const)("rejects relocation %s drift before any GET", async (key) => {
    const input = relocated();
    Object.assign(input.relocation!, {
      [key]:
        key === "byteSize"
          ? 1
          : key === "verifiedAt"
            ? new Date(0)
            : "different",
    });
    await rejectedSource([input], {
      storage: [storage(), relocatedStorage()],
    });
  });

  it("reads only the exact recorded bucket-prefixed key, preserves served MIME, and validates actual dimensions", async () => {
    const input = source(),
      io = transport();
    const catalog = await capture([input], io);
    expect(io.handle).toHaveBeenCalledTimes(1);
    expect(io.handle.mock.calls[0][0]).toMatchObject({
      method: "GET",
      hostname: new URL(storage().endpoint).hostname,
      path: `/${storage().bucket}/${input.file.objectKey}`,
    });
    expect(catalog.metadata.entries).toEqual([
      expect.objectContaining({
        kind: "available",
        fileId: input.file.id,
        sha256: hash(png),
        bytes: png.length,
        mime: "image/png",
        validationKind: "raster",
        width: 3,
        frameHeight: 2,
        frames: 1,
        decodedPixels: 6,
      }),
    ]);
    expect(catalog.metadata.validationSha256).toBe(
      await getRitualImageValidationSha256(),
    );
    const serialized = JSON.stringify(catalog.metadata);
    for (const privateValue of [
      input.snapshot.sourceEjson,
      input.snapshot.legacyIdValue,
      storage().endpoint,
      storage().bucket,
      "legacy-private-name",
      "application/octet-stream",
      "synthetic-only",
    ])
      expect(serialized).not.toContain(privateValue);
    expect(io.bodies.every((body) => body.destroyed)).toBe(true);
  });
  it("keeps exact Unicode/slash/percent object-key spelling and explicit bare keys", async () => {
    for (const prefix of ["", "legacy//α/%2F/../"]) {
      const input = source(png, "image/png", prefix),
        io = transport();
      await capture([input], io);
      expect(
        decodeURIComponent(
          io.handle.mock.calls[0][0].path.slice(storage().bucket.length + 2),
        ),
      ).toBe(input.file.objectKey);
    }
  });
  it("retains exact closed SVG bytes and separate dependency facts", async () => {
    const input = source(svg, "image/svg+xml");
    const catalog = await capture([input], transport(svg));
    expect(catalog.metadata.entries[0]).toMatchObject({
      kind: "available",
      mime: "image/svg+xml",
      validationKind: "svg",
      elements: 2,
      embeddedRasters: [],
    });
    expect(catalog.copyBytes(input.file.sha256)).toEqual(svg);
    expect(Object.isFrozen(catalog.metadata.entries[0])).toBe(true);
    expect(Object.isFrozen(catalog.metadata.entries)).toBe(true);
  });
  it("owns bytes across caller mutation, copy mutation, disposal and missing lookup", async () => {
    const input = source(),
      io = transport(),
      catalog = await capture([input], io);
    const one = catalog.copyBytes(hash(png))!;
    one.fill(0);
    expect(catalog.copyBytes(hash(png))).toEqual(new Uint8Array(png));
    expect(catalog.copyBytes("missing")).toBeNull();
    const retained = catalog.copyBytes(hash(png));
    catalog.dispose();
    catalog.dispose();
    expect(catalog.copyBytes(hash(png))).toBeNull();
    expect(retained).toEqual(new Uint8Array(png));
    expect(catalog.metadata.entries[0].kind).toBe("available");
    expect(io.handle).toHaveBeenCalledTimes(1);
  });
  it("snapshots every source and explicit credential before the first await", async () => {
    const config = storage(),
      first = source(),
      second = source(svg, "image/svg+xml"),
      inputs = [first, second];
    const expected = inputs.map((input) => ({ ...input.file }));
    const gate = deferred<void>();
    const handle = vi.fn(async (request: Request) => {
      await gate.promise;
      const file = expected.find((file) =>
        request.path.endsWith(file.objectKey),
      )!;
      const bytes = file.sha256 === hash(png) ? png : svg;
      return response(Readable.from([Buffer.from(bytes)]), {
        "content-length": String(bytes.length),
      });
    });
    const pending = capture(
      inputs,
      { handle, bodies: [] },
      { storage: config },
    );
    first.file.objectKey = "changed";
    second.file.byteSize = 1;
    second.snapshot.sourceEjson = "{}";
    config.bucket = "changed";
    config.credentials.secretAccessKey = "changed";
    inputs.length = 0;
    gate.resolve();
    const catalog = await pending;
    expect(
      catalog.metadata.entries.every((entry) => entry.kind === "available"),
    ).toBe(true);
    expect(
      handle.mock.calls.every(([request]) =>
        request.path.startsWith(`/${storage().bucket}/`),
      ),
    ).toBe(true);
  });
  it.each([
    "id",
    "sha256",
    "byteSize",
    "contentType",
    "kind",
    "storageProvider",
    "bucket",
    "objectKey",
    "visibility",
    "ownerType",
    "ownerId",
    "deletedAt",
  ] as const)(
    "rejects current file %s disagreement before any GET",
    async (key) => {
      const input = source();
      Object.assign(input.file, {
        [key]: key === "byteSize" ? 1 : "different",
      });
      await rejectedSource([input]);
    },
  );
  it.each([
    "sourceSystem",
    "legacyIdType",
    "legacyIdValue",
    "fileId",
    "sourceEjson",
    "sourceSha256",
    "serializationVersion",
    "legacyPublicPath",
    "sourceStorageProvider",
    "sourceBucket",
    "sourceObjectKey",
    "sourceObjectKeyPrefix",
    "legacySyncUpdatedAtMilliseconds",
    "importedAt",
  ] as const)(
    "rejects archived %s disagreement before any GET",
    async (key) => {
      const input = source();
      Object.assign(input.snapshot, {
        [key]: key === "importedAt" ? new Date(NaN) : "different",
      });
      await rejectedSource([input]);
    },
  );
  it("allows later descriptive metadata changes without treating import time as current updatedAt", async () => {
    const input = source();
    Object.assign(input.file, {
      updatedAt: new Date(),
      originalFilename: "new description",
      meta: { label: "later" },
    });
    expect((await capture([input])).metadata.entries[0].kind).toBe("available");
  });
  it("rejects noncanonical/duplicate-key EJSON even when its supplied hash agrees", async () => {
    for (const change of [
      (value: string) => ` ${value}`,
      (value: string) => value.replace('{"_id":', '{"size":1,"_id":'),
    ]) {
      const input = source();
      input.snapshot.sourceEjson = change(input.snapshot.sourceEjson);
      input.snapshot.sourceSha256 = hash(input.snapshot.sourceEjson);
      await rejectedSource([input]);
    }
  });
  it("refuses source extras and typed ObjectId/string mismatches", async () => {
    const input = source();
    const original = EJSON.parse(input.snapshot.sourceEjson, { relaxed: true });
    original.owner = "unreviewed";
    input.snapshot.sourceEjson = EJSON.stringify(original, { relaxed: false });
    input.snapshot.sourceSha256 = hash(input.snapshot.sourceEjson);
    await rejectedSource([input]);
    const typed = source();
    typed.snapshot.legacyIdType = "string";
    await rejectedSource([typed]);
  });
  it("checks the whole batch before I/O, including separate-call duplicate identities and digests", async () => {
    const first = source(),
      second = source(svg, "image/svg+xml");
    second.file.objectKey = "changed";
    await rejectedSource([first, second]);
    await rejectedSource([first, structuredClone(first)]);
    await rejectedSource([first, source()]);
    const sameId = source(svg, "image/svg+xml");
    sameId.file.id = first.file.id;
    sameId.snapshot.fileId = first.file.id;
    await rejectedSource([first, sameId]);
    const sameSource = source(svg, "image/svg+xml", storage().bucket + "/", {
      _id: new ObjectId(first.snapshot.legacyIdValue),
    });
    await rejectedSource([first, sameSource]);
  });
  it("rejects sparse or malformed source batches before any GET", async () => {
    const trailingHole = [source()];
    trailingHole.length = 2;
    for (const input of [
      trailingHole,
      Array(1),
      [null],
      [{ file: null, snapshot: null }],
      null,
    ])
      await rejectedSource(input as LegacyRitualImageSource[]);
  });
  it("bounds the source count and per-source/total UTF8 evidence before parsing or fetching", async () => {
    await rejectedSource([source(), source(svg, "image/svg+xml")], {
      limits: { files: 1 },
    });
    const input = source();
    const length = Buffer.byteLength(input.snapshot.sourceEjson);
    await rejectedSource([input], { limits: { sourceBytes: length - 1 } });
    await rejectedSource([input], { limits: { totalSourceBytes: length - 1 } });
    const unicode = source(png, "image/png", "", { filename: "α".repeat(500) });
    await rejectedSource([unicode], {
      limits: { sourceBytes: unicode.snapshot.sourceEjson.length + 1 },
    });
    const invalid = source();
    invalid.snapshot.sourceEjson = "{";
    invalid.snapshot.sourceSha256 = hash("{");
    await rejectedSource([invalid]);
  });
  it.each([0, -1, 1.1, NaN, Infinity, 129])(
    "rejects invalid configured maximum %s",
    async (value) => {
      const io = transport();
      await expect(
        capture([], io, { limits: { files: value } }),
      ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
      expect(io.handle).not.toHaveBeenCalled();
    },
  );
  it.each([
    "http://127.0.0.1",
    "https://x.example",
    storage().endpoint + "/bucket",
    storage().endpoint + "/",
    storage().endpoint + "?query=1",
  ])("rejects unapproved endpoint %s without I/O", async (endpoint) => {
    const io = transport();
    await expect(
      capture([], io, { storage: { ...storage(), endpoint } }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(io.handle).not.toHaveBeenCalled();
  });
  it("rejects ambient/provider credentials, invalid buckets, unknown limits and invalid expirations", async () => {
    for (const invalid of [
      { kind: "s3" },
      { bucket: "UPPER" },
      { credentials: undefined },
      { credentials: {} },
      { credentials: { ...storage().credentials, sessionToken: "" } },
      { credentials: { ...storage().credentials, expiration: new Date(NaN) } },
    ]) {
      await expect(
        capture([], transport(), {
          storage: { ...storage(), ...invalid } as LegacyRitualImageStorage,
        }),
      ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    }
    await expect(
      capture([], transport(), { limits: { unknown: 1 } as never }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(
      (
        await capture([], transport(), {
          storage: {
            ...storage(),
            credentials: {
              ...storage().credentials,
              sessionToken: "synthetic-token",
              expiration: new Date("2030-01-01"),
            },
          },
        })
      ).metadata.entries,
    ).toEqual([]);
  });
  it.each([
    {
      title: "unsupported MIME",
      original: { mimeType: "image/tiff" },
      reason: "unsupported-type",
    },
    {
      title: "missing MIME",
      original: { mimeType: "" },
      reason: "unsupported-type",
    },
    { title: "empty image", original: { size: 0 }, reason: "too-large" },
    {
      title: "oversized raster",
      original: { size: 20 * 1024 * 1024 + 1 },
      reason: "too-large",
    },
    {
      title: "oversized SVG",
      original: { mimeType: "image/svg+xml", size: 4 * 1024 * 1024 + 1 },
      reason: "too-large",
    },
  ])(
    "leaves $title incomplete without any GET",
    async ({ original, reason }) => {
      const io = transport(),
        catalog = await capture([source(png, "image/png", "", original)], io);
      expect(catalog.metadata.entries[0]).toMatchObject({
        kind: "unresolved",
        reason,
      });
      expect(io.handle).not.toHaveBeenCalled();
    },
  );
  it("never captures a non-image historical file", async () => {
    const input = source();
    const original = EJSON.parse(input.snapshot.sourceEjson, { relaxed: true });
    original.type = "other";
    delete original.image;
    const plan = planLegacyFileImport([original], {
      lookup: () => input.file.id,
      storageProvider: "r2",
      sourceBucket: storage().bucket,
      sourceObjectKeyPrefix: "",
      importedAt: input.snapshot.importedAt,
    });
    const io = transport();
    const catalog = await capture(
      [
        {
          file: plan.files[0],
          snapshot: plan.snapshots[0],
        } as LegacyRitualImageSource,
      ],
      io,
    );
    expect(catalog.metadata.entries[0]).toMatchObject({
      reason: "unsupported-type",
    });
    expect(io.handle).not.toHaveBeenCalled();
  });
  it("charges each attempted capture before GET, including failed images", async () => {
    const one = source(),
      two = source(svg, "image/svg+xml"),
      io = transport(new Uint8Array(png.length));
    await expect(
      capture([one, two], io, {
        limits: { capturedBytes: Math.max(png.length, svg.length) },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(io.handle).toHaveBeenCalledTimes(1);
  });
  it.each<{ headers: Record<string, string>; data: () => Uint8Array }>([
    { headers: { "content-length": "1" }, data: () => png },
    { headers: { "content-encoding": "gzip" }, data: () => png },
    { headers: {}, data: () => png.subarray(0, png.length - 1) },
    { headers: {}, data: () => new Uint8Array(png.length + 1) },
    { headers: {}, data: () => new Uint8Array(png.length) },
  ])(
    "refuses byte/header mismatch and closes the stream %#",
    async ({ headers, data }) => {
      const io = transport(data(), {
        "content-length": String(png.length),
        ...headers,
      });
      const catalog = await capture([source()], io);
      expect(catalog.metadata.entries[0]).toMatchObject({
        kind: "unresolved",
        reason: "source-mismatch",
      });
      expect(io.bodies.every((body) => body.destroyed)).toBe(true);
    },
  );
  it("compares declared MIME with actual decoded raster MIME", async () => {
    expect(
      (await capture([source(png, "image/jpeg")])).metadata.entries[0],
    ).toMatchObject({ reason: "source-mismatch" });
  });
  it("fully validates matched-digest invalid raster and hostile/unsupported SVG content", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      (await capture([source(bytes)], transport(bytes))).metadata.entries[0],
    ).toMatchObject({ reason: "unsupported-type" });
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.example/p.png"/></svg>',
      "<svg",
    ]) {
      const bytes = new TextEncoder().encode(text);
      expect(
        (await capture([source(bytes, "image/svg+xml")], transport(bytes)))
          .metadata.entries[0].kind,
      ).toBe("unresolved");
    }
  });
  it.each([301, 403, 404])(
    "bounds SDK error XML and never follows or retries HTTP %s",
    async (status) => {
      const io = transport(
        Buffer.from(
          "<Error><Code>AccessDenied</Code><Message>private provider diagnostic</Message></Error>",
        ),
        {
          location: "https://other.example/secret",
          "content-type": "application/xml",
        },
        status,
      );
      const catalog = await capture([source()], io);
      expect(catalog.metadata.entries[0]).toMatchObject({
        reason: "source-unavailable",
      });
      expect(JSON.stringify(catalog.metadata)).not.toContain(
        "private provider",
      );
      expect(io.handle).toHaveBeenCalledTimes(1);
      expect(io.bodies.every((body) => body.destroyed)).toBe(true);
    },
  );
  it("rejects an oversized SDK error body and destroys it before full consumption", async () => {
    let consumed = 0;
    const body = new Readable({
      read() {
        consumed += 2048;
        this.push(Buffer.alloc(2048, 32));
      },
    });
    const handle = vi.fn(async () =>
      response(body, { "content-type": "application/xml" }, 403),
    );
    const catalog = await capture([source()], { handle, bodies: [] });
    expect(catalog.metadata.entries[0]).toMatchObject({
      reason: "source-unavailable",
    });
    expect(body.destroyed).toBe(true);
    expect(consumed).toBeLessThan(128 * 1024);
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it.each([200, 403])(
    "ends stalled HTTP %s body reads even when the transport ignores abort",
    async (status) => {
      const body = new Readable({ read() {} });
      const handle = vi.fn(async () =>
        response(
          body,
          {
            "content-length": String(png.length),
            "content-type": "application/xml",
          },
          status,
        ),
      );
      const catalog = await capture(
        [source()],
        { handle, bodies: [] },
        { limits: { ioTimeoutMs: 50 } },
      );
      expect(catalog.metadata.entries[0]).toMatchObject({
        reason: "source-unavailable",
      });
      expect(body.destroyed).toBe(true);
    },
  );
  it("settles a stuck transport and closes a success body arriving after deadline", async () => {
    const gate = deferred<ReturnType<typeof response>>(),
      handle = vi.fn(() => gate.promise);
    const catalog = await capture(
      [source()],
      { handle, bodies: [] },
      { limits: { ioTimeoutMs: 50 } },
    );
    expect(catalog.metadata.entries[0]).toMatchObject({
      reason: "source-unavailable",
    });
    const body = new Readable({ read() {} });
    gate.resolve(response(body, { "content-length": String(png.length) }));
    await vi.waitFor(() => expect(body.destroyed).toBe(true));
  });
  it("closes an SDK error body arriving after the transport deadline", async () => {
    const gate = deferred<ReturnType<typeof response>>(),
      handle = vi.fn(() => gate.promise);
    await capture(
      [source()],
      { handle, bodies: [] },
      { limits: { ioTimeoutMs: 50 } },
    );
    const body = new Readable({ read() {} });
    gate.resolve(response(body, { "content-type": "application/xml" }, 403));
    await vi.waitFor(() => expect(body.destroyed).toBe(true));
  });
  it("cancels before GET and aborts an active body without publishing a catalog", async () => {
    const controller = new AbortController();
    controller.abort();
    const io = transport();
    await expect(
      capture([source()], io, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(io.handle).not.toHaveBeenCalled();
    const active = new AbortController(),
      body = new Readable({ read() {} }),
      started = deferred<void>();
    const handle = vi.fn(async () => {
      started.resolve();
      return response(body, { "content-length": String(png.length) });
    });
    const pending = capture(
      [source()],
      { handle, bodies: [] },
      { signal: active.signal },
    );
    await started.promise;
    active.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await vi.waitFor(() => expect(body.destroyed).toBe(true));
  });
  it("enforces a whole-catalog deadline separately from each GET", async () => {
    const handle = vi.fn(() => new Promise<never>(() => {}));
    await expect(
      capture(
        [source()],
        { handle, bodies: [] },
        { limits: { timeoutMs: 50 } },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it.each(["IMAGE_LIMIT", "TIMEOUT", "INVALID_REQUEST"] as const)(
    "retains safe raster validation failure %s",
    async (code) => {
      vi.mocked(createSharpRitualImageValidator).mockReturnValueOnce({
        validate: async () => {
          throw new RitualUploadError(code);
        },
      });
      expect((await capture([source()])).metadata.entries[0]).toMatchObject({
        reason:
          code === "IMAGE_LIMIT"
            ? "image-limit"
            : code === "TIMEOUT"
              ? "validation-timeout"
              : "invalid-image",
      });
    },
  );
  it("checks owned SVG output identity and clears late successful SVG allocations on cancellation", async () => {
    const real = createRitualSvgValidator();
    const result = await real.validate(svg, new AbortController().signal);
    if (result.status !== "validated") throw new Error("fixture rejected");
    vi.mocked(createRitualSvgValidator).mockReturnValueOnce({
      validate: async () => ({ ...result, sha256: "0".repeat(64) }),
    });
    expect(
      (await capture([source(svg, "image/svg+xml")], transport(svg))).metadata
        .entries[0],
    ).toMatchObject({ reason: "source-mismatch" });
    const gate = deferred<typeof result>(),
      started = deferred<void>(),
      controller = new AbortController();
    const copy = { ...result, bytes: new Uint8Array(svg) };
    vi.mocked(createRitualSvgValidator).mockReturnValueOnce({
      validate: async () => {
        started.resolve();
        return gate.promise;
      },
    });
    const pending = capture([source(svg, "image/svg+xml")], transport(svg), {
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    gate.resolve(copy);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(copy.bytes.every((byte) => byte === 0)).toBe(true);
  });
});
