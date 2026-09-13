import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createExternalRitualImageCatalog,
  type ExternalRitualImageCatalog,
} from "./externalRitualImageCatalog";
import { RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

const mocks = vi.hoisted(() => ({
  policy: [] as Record<string, unknown>[],
  resolve4: vi.fn(),
  cancel: vi.fn(),
  constructors: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./externalRitualImagePolicy", () => ({
  EXTERNAL_RITUAL_IMAGE_POLICY: mocks.policy,
}));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    constructor(options: unknown) {
      mocks.constructors(options);
    }
    resolve4 = mocks.resolve4;
    cancel = mocks.cancel;
  },
}));
vi.mock("./validateRitualImage", async (original) => {
  const value = await original<typeof import("./validateRitualImage")>();
  return {
    ...value,
    createSharpRitualImageValidator: vi.fn(
      value.createSharpRitualImageValidator,
    ),
  };
});
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const ref = "https://i.pinimg.com/synthetic.png";
const wiki =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test.jpg/800px-Test.jpg";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
let png: Uint8Array;
const catalogs: ExternalRitualImageCatalog[] = [];
beforeAll(async () => {
  png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
});
function policy(reference = ref, bytes = png) {
  return {
    referenceSha256: hash(reference),
    hostname: new URL(reference).hostname,
    byteSize: bytes.length,
    sha256: hash(bytes),
    contentType: "image/png",
    representation: "original",
  };
}
class Reply extends Readable {
  headers: Record<string, string>;
  statusCode = 200;
  complete = false;
  chunks: unknown[] | null;
  constructor(bytes: Uint8Array = png) {
    super();
    this.chunks = [Buffer.from(bytes)];
    this.headers = {
      "content-length": String(bytes.length),
      "content-type": "application/octet-stream",
    };
  }
  _read() {
    if (this.chunks === null) return;
    const chunks = this.chunks;
    this.chunks = null;
    for (const chunk of chunks) this.push(chunk);
    this.complete = true;
    this.push(null);
  }
}
class Request extends EventEmitter {
  destroy = vi.fn(() => this);
}
let get: ReturnType<typeof vi.spyOn>;
let reply: Reply, request: Request;
let callback: (response: IncomingMessage) => void;
let options: https.RequestOptions;
beforeEach(() => {
  mocks.resolve4.mockReset().mockResolvedValue(["8.8.8.8", "1.1.1.1"]);
  mocks.cancel.mockReset();
  mocks.constructors.mockReset();
  mocks.policy.splice(0, mocks.policy.length, policy(), {
    ...policy(wiki),
    representation: "same-file-standard-thumbnail",
  });
  reply = new Reply();
  request = new Request();
  get = vi.spyOn(https, "get").mockImplementation(((
    url: URL,
    opts: https.RequestOptions,
    done: typeof callback,
  ) => {
    options = opts;
    callback = done;
    queueMicrotask(() => {
      opts.lookup!(
        url.hostname,
        { family: 4 },
        (error: Error | null, address: string, family: number) => {
          if (error) {
            request.emit("error", error);
            return;
          }
          expect(address).toBe("8.8.8.8");
          expect(family).toBe(4);
          done(reply as unknown as IncomingMessage);
        },
      );
    });
    return request as unknown as ClientRequest;
  }) as typeof https.get);
});
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.dispose();
  reply.destroy();
  vi.restoreAllMocks();
});
async function capture(
  references = [ref],
  extra: Partial<Parameters<typeof createExternalRitualImageCatalog>[0]> = {},
) {
  const catalog = await createExternalRitualImageCatalog({
    references,
    ...extra,
  });
  catalogs.push(catalog);
  return catalog;
}
function failure(catalog: ExternalRitualImageCatalog, reason: string) {
  expect(catalog.metadata.entries[0]).toMatchObject({
    kind: "unresolved",
    reason,
  });
  expect(catalog.copyBytes(hash(ref))).toBeNull();
}

describe("fixed external image acquisition", () => {
  it("pins checked IPv4, verifies bytes with native decoding, and excludes all ambient request authority", async () => {
    const catalog = await capture();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].href).toBe(ref);
    expect(mocks.resolve4).toHaveBeenCalledWith("i.pinimg.com");
    expect(mocks.constructors).toHaveBeenCalledWith({
      timeout: 20000,
      tries: 1,
    });
    expect(options).toMatchObject({
      agent: false,
      family: 4,
      autoSelectFamily: false,
      servername: "i.pinimg.com",
      rejectUnauthorized: true,
      maxHeaderSize: 16384,
      headers: {
        Accept: "image/png,image/jpeg,image/gif,image/webp",
        "Accept-Encoding": "identity",
        "User-Agent": "MagicklyOfflineMigrationBot/1.0 (+https://magick.ly)",
      },
    });
    expect(Object.keys(options.headers!)).toEqual([
      "Accept",
      "Accept-Encoding",
      "User-Agent",
    ]);
    expect(catalog.metadata.entries[0]).toMatchObject({
      kind: "available",
      referenceSha256: hash(ref),
      acquisitionReferenceSha256: hash(ref),
      representation: "original",
      sha256: hash(png),
      bytes: png.length,
      mime: "image/png",
      width: 3,
      frameHeight: 2,
      frames: 1,
      decodedPixels: 6,
    });
    expect(JSON.stringify(catalog.metadata)).not.toContain(ref);
    expect(request.destroy).toHaveBeenCalled();
    expect(reply.destroyed).toBe(true);
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it("records a same-file thumbnail replacement without changing the original reference", async () => {
    const catalog = await capture([wiki]);
    const target = wiki.replace("800px-Test.jpg", "960px-Test.jpg");
    expect(get.mock.calls[0][0].href).toBe(target);
    expect(catalog.metadata.entries[0]).toMatchObject({
      referenceSha256: hash(wiki),
      acquisitionReferenceSha256: hash(target),
      representation: "same-file-standard-thumbnail",
    });
    expect(catalog.copyBytes(hash(wiki))).toEqual(new Uint8Array(png));
    expect(catalog.copyBytes(hash(target))).toBeNull();
  });
  it("retains owned immutable snapshots across copies and disposal", async () => {
    const catalog = await capture(),
      one = catalog.copyBytes(hash(ref))!;
    one.fill(0);
    expect(catalog.copyBytes(hash(ref))).toEqual(new Uint8Array(png));
    const retained = catalog.copyBytes(hash(ref));
    catalog.dispose();
    catalog.dispose();
    expect(catalog.copyBytes(hash(ref))).toBeNull();
    expect(retained).toEqual(new Uint8Array(png));
    expect(Object.isFrozen(catalog.metadata.entries)).toBe(true);
    expect(Object.isFrozen(catalog.metadata.entries[0])).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("snapshots all references and limits before yielding", async () => {
    const gate = deferred<string[]>();
    mocks.resolve4.mockReturnValueOnce(gate.promise);
    const references = [ref],
      limits = { capturedBytes: png.length };
    const pending = capture(references, { limits });
    references[0] = "https://127.0.0.1/";
    limits.capturedBytes = 1;
    gate.resolve(["8.8.8.8"]);
    expect((await pending).metadata.entries[0].kind).toBe("available");
  });
  it.each([
    "https://i.pinimg.com/other.png",
    "https://example.com/image.png",
    "http://127.0.0.1/",
    "file:///etc/passwd",
    ref + "?changed=1",
    "https://user:secret@i.pinimg.com/synthetic.png",
  ])(
    "never resolves DNS or fetches an unapproved exact reference %s",
    async (input) => {
      const catalog = await capture([input]);
      expect(catalog.metadata.entries[0]).toMatchObject({
        reason: "unapproved-reference",
      });
      expect(mocks.resolve4).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it("requires the whole input batch to be valid before I/O", async () => {
    const sparse = [ref];
    sparse.length = 2;
    for (const input of [
      [ref, ref],
      sparse,
      Array(1),
      [ref, null],
      [""],
      [ref + "#part"],
      ["\ud800"],
      null,
    ]) {
      await expect(capture(input as string[])).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    expect(mocks.resolve4).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it("bounds count and UTF8 reference size before hashing or network", async () => {
    await expect(
      capture([ref, wiki], { limits: { references: 1 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      capture([ref], { limits: { referenceBytes: 1 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      capture(["αα"], { limits: { referenceBytes: 3 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(get).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.1, NaN, Infinity, 65])(
    "rejects invalid limits %s before network",
    async (value) => {
      await expect(
        capture([], { limits: { references: value } }),
      ).rejects.toMatchObject({ code: "INVALID_LIMITS" });
      expect(get).not.toHaveBeenCalled();
    },
  );
  it("rejects unknown limit names", async () => {
    await expect(
      capture([], { limits: { unknown: 1 } as never }),
    ).rejects.toMatchObject({ code: "INVALID_LIMITS" });
  });
  it.each([
    "http://i.pinimg.com/synthetic.png",
    ref + "?x=1",
    "https://user:secret@i.pinimg.com/synthetic.png",
    "https://i.pinimg.com:444/synthetic.png",
    "https://i.pinimg.com:443/synthetic.png",
    "https://i.pinimg.com/a/../synthetic.png",
  ])(
    "refuses malformed policy authority even if a future reviewed hash were added: %s",
    async (reference) => {
      mocks.policy.push(policy(reference));
      failure(await capture([reference]), "unapproved-reference");
      expect(mocks.resolve4).not.toHaveBeenCalled();
    },
  );
  it("does not infer arbitrary thumbnail transformations", async () => {
    for (const reference of [
      wiki.replace("800px", "500px"),
      wiki.replace("800px-Test.jpg", "800px-Other.jpg"),
      wiki.replace("/thumb/", "/notthumb/"),
      wiki.replace("/a/ab/", "/ab/"),
      wiki.replace("upload.wikimedia.org", "other.example"),
    ]) {
      mocks.policy.push({
        ...policy(reference),
        representation: "same-file-standard-thumbnail",
      });
      failure(await capture([reference]), "unapproved-reference");
    }
    expect(get).not.toHaveBeenCalled();
  });
  it.each([
    "0.1.2.3",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.3",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::ffff:127.0.0.1",
    "::1",
    "invalid",
    "127.1",
  ])("refuses unsafe or malformed DNS address %s", async (ip) => {
    mocks.resolve4.mockResolvedValue([ip]);
    failure(await capture(), "unsafe-address");
    expect(get).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it("rejects empty or mixed public/private DNS results", async () => {
    for (const addresses of [[], ["8.8.8.8", "127.0.0.1"]]) {
      mocks.resolve4.mockResolvedValue(addresses);
      failure(await capture(), "unsafe-address");
    }
    expect(get).not.toHaveBeenCalled();
  });
  it("cancels bounded stalled DNS and ignores its late answer", async () => {
    const gate = deferred<string[]>();
    mocks.resolve4.mockReturnValue(gate.promise);
    failure(
      await capture([ref], { limits: { ioTimeoutMs: 10 } }),
      "source-unavailable",
    );
    expect(mocks.cancel).toHaveBeenCalled();
    gate.resolve(["8.8.8.8"]);
    await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
  });
  it("keeps DNS failures diagnostic-free", async () => {
    mocks.resolve4.mockRejectedValue(new Error(ref + " secret DNS details"));
    const result = await capture();
    failure(result, "source-unavailable");
    expect(JSON.stringify(result.metadata)).not.toContain("secret DNS");
  });
  it("charges the declared capture before DNS or allocation", async () => {
    await expect(
      capture([ref], { limits: { capturedBytes: png.length - 1 } }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(mocks.resolve4).not.toHaveBeenCalled();
  });
  it.each([301, 302, 307, 403, 404, 500])(
    "closes HTTP %s without reading its body or following Location",
    async (status) => {
      reply.statusCode = status;
      reply.headers.location = "https://127.0.0.1/private";
      reply.chunks = null;
      failure(await capture(), "source-unavailable");
      expect(reply.destroyed).toBe(true);
      expect(get).toHaveBeenCalledTimes(1);
      expect(mocks.resolve4).toHaveBeenCalledTimes(1);
      expect(() => reply.emit("error", new Error("late"))).not.toThrow();
    },
  );
  it.each(["0", "1", "-1", "NaN", "12x", String(2 ** 54)])(
    "refuses Content-Length %s before body consumption",
    async (length) => {
      reply.headers["content-length"] = length;
      failure(await capture(), "source-mismatch");
      expect(reply.destroyed).toBe(true);
    },
  );
  it("supports absent Content-Length only with actual exact length and hash", async () => {
    delete reply.headers["content-length"];
    expect((await capture()).metadata.entries[0].kind).toBe("available");
  });
  it("rejects content encoding rather than allocating decompressed bytes", async () => {
    reply.headers["content-encoding"] = "gzip";
    failure(await capture(), "source-mismatch");
    expect(reply.destroyed).toBe(true);
  });
  it.each(["short", "long", "changed"])(
    "refuses %s actual content",
    async (kind) => {
      reply.chunks = [
        kind === "short"
          ? png.subarray(0, 2)
          : new Uint8Array(png.length + (kind === "long" ? 1 : 0)),
      ];
      failure(await capture(), "source-mismatch");
      expect(reply.destroyed).toBe(true);
    },
  );
  it("settles an abruptly closed body without waiting for the deadline", async () => {
    reply.chunks = null;
    reply._read = () => {
      reply.destroy();
    };
    failure(await capture(), "source-unavailable");
  });
  it("destroys stalled response bodies on the request deadline", async () => {
    reply.chunks = null;
    failure(
      await capture([ref], { limits: { ioTimeoutMs: 10 } }),
      "source-unavailable",
    );
    expect(reply.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
  });
  it("destroys late response callbacks after a stuck request has timed out", async () => {
    get.mockImplementation(
      (_url: URL, _options: unknown, done: typeof callback) => {
        callback = done;
        return request;
      },
    );
    failure(
      await capture([ref], { limits: { ioTimeoutMs: 10 } }),
      "source-unavailable",
    );
    callback(reply as unknown as IncomingMessage);
    expect(reply.destroyed).toBe(true);
    expect(() => reply.emit("error", new Error("late"))).not.toThrow();
  });
  it("rejects lookup under a different hostname", async () => {
    get.mockImplementation((_url: URL, opts: https.RequestOptions) => {
      options = opts;
      queueMicrotask(() =>
        opts.lookup!("other.example", { family: 4 }, (error: Error) =>
          request.emit("error", error),
        ),
      );
      return request;
    });
    failure(await capture(), "source-unavailable");
  });
  it("refuses TLS/request errors and does not retry", async () => {
    get.mockImplementation(() => {
      queueMicrotask(() =>
        request.emit("error", new Error("CERT_HAS_EXPIRED")),
      );
      return request;
    });
    failure(await capture(), "source-unavailable");
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("supports cancellation before and during DNS without publishing evidence", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      capture([ref], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(mocks.resolve4).not.toHaveBeenCalled();
    const active = new AbortController(),
      started = deferred<void>();
    mocks.resolve4.mockImplementation(() => {
      started.resolve();
      return new Promise(() => {});
    });
    const pending = capture([ref], { signal: active.signal });
    await started.promise;
    active.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it("fences a delayed lookup and response after cancellation", async () => {
    const controller = new AbortController(),
      started = deferred<void>();
    get.mockImplementation(
      (_url: URL, opts: https.RequestOptions, done: typeof callback) => {
        options = opts;
        callback = done;
        started.resolve();
        return request;
      },
    );
    const pending = capture([ref], { signal: controller.signal });
    await started.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    const lookup = vi.fn();
    options.lookup!(new URL(ref).hostname, { family: 4 }, lookup);
    expect(lookup.mock.calls[0][0]).toBeInstanceOf(Error);
    callback(reply as unknown as IncomingMessage);
    expect(reply.destroyed).toBe(true);
  });
  it("enforces a whole-catalog deadline while DNS is pending", async () => {
    mocks.resolve4.mockReturnValue(new Promise(() => {}));
    await expect(
      capture([ref], { limits: { timeoutMs: 10 } }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(mocks.cancel).toHaveBeenCalled();
  });
  it("checks the selected native MIME and validates matched-digest invalid images", async () => {
    mocks.policy[0].contentType = "image/jpeg";
    failure(await capture(), "source-mismatch");
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.policy[0] = policy(ref, bytes);
    reply = new Reply(bytes);
    failure(await capture(), "invalid-image");
  });
  it.each(["IMAGE_LIMIT", "TIMEOUT", "INVALID_IMAGE"] as const)(
    "keeps safe validation failure %s",
    async (code) => {
      vi.mocked(createSharpRitualImageValidator).mockReturnValueOnce({
        validate: async () => {
          throw new RitualUploadError(code);
        },
      });
      failure(
        await capture(),
        code === "IMAGE_LIMIT"
          ? "image-limit"
          : code === "TIMEOUT"
            ? "validation-timeout"
            : "invalid-image",
      );
    },
  );
  it("does not publish late native validation after cancellation", async () => {
    const real = createSharpRitualImageValidator(),
      image = await real.validate(png, new AbortController().signal);
    const gate = deferred<typeof image>(),
      started = deferred<void>(),
      active = new AbortController();
    vi.mocked(createSharpRitualImageValidator).mockReturnValueOnce({
      validate: async () => {
        started.resolve();
        return gate.promise;
      },
    });
    const pending = capture([ref], { signal: active.signal });
    await started.promise;
    active.abort();
    gate.resolve(image);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});
