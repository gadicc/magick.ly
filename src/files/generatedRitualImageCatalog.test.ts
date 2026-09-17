import { createHash } from "node:crypto";
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
import { parseComponentImageRequest } from "../render/componentImageRequest";
import {
  createGeneratedRitualImageCatalog,
  GENERATED_RITUAL_IMAGE_LIMITS,
  type GeneratedRitualImageCatalog,
} from "./generatedRitualImageCatalog";
import { getRitualImageValidationSha256 } from "./ritualImageValidationIdentity";
import { RitualUploadError } from "./ritualUploadProtocol";
import * as rasterModule from "./validateRitualImage";
import * as svgModule from "./validateRitualSvg";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../render/componentImage", () => ({
  renderComponentImage: mocks.render,
}));
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><path d="M0 0L1 1"/></svg>';
const ref = "/api/treeOfLife?field=name.roman";
const origins = ["https://magick.ly"];
const catalogs: GeneratedRitualImageCatalog[] = [];
const supplied: Uint8Array[] = [];
let png: Buffer, jpeg: Buffer;
beforeAll(async () => {
  const make = () =>
    sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } });
  png = await make().png().toBuffer();
  jpeg = await make().jpeg().toBuffer();
});
function render(_slug: string, params: URLSearchParams) {
  const request = parseComponentImageRequest("tree-of-life", params);
  const bytes = request.format === "svg" ? Buffer.from(svg) : Buffer.from(png);
  supplied.push(bytes);
  return {
    request,
    bytes,
    byteSize: bytes.length,
    sha256: hash(bytes),
    contentType: request.format === "svg" ? "image/svg+xml" : "image/png",
    sourceSha256: hash("synthetic JSX source"),
    identity: {
      profile: "magickli-tree-image-outlines-v2",
      resvg: "2.6.2",
      wasmSha256: "a".repeat(64),
      fonts: [{ file: "NotoSans-Regular.ttf", sha256: "b".repeat(64) }],
      defaultFontSize: 16,
    },
  };
}
beforeEach(() => {
  mocks.render.mockReset().mockImplementation(render);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const catalog of catalogs.splice(0)) catalog.dispose();
  supplied.length = 0;
});
async function capture(
  references = [ref],
  options: Partial<
    Parameters<typeof createGeneratedRitualImageCatalog>[0]
  > = {},
) {
  const catalog = await createGeneratedRitualImageCatalog({
    references,
    knownAppOrigins: origins,
    ...options,
  });
  catalogs.push(catalog);
  return catalog;
}

describe("generated ritual image captures", () => {
  it("captures validated in-process SVG with complete rendering provenance", async () => {
    const catalog = await capture();
    expect(catalog.metadata.entries).toEqual([
      expect.objectContaining({
        kind: "available",
        referenceSha256: hash(ref),
        sourceSha256: hash("synthetic JSX source"),
        sha256: hash(svg),
        bytes: Buffer.byteLength(svg),
        validationKind: "svg",
        mime: "image/svg+xml",
        request: parseComponentImageRequest(
          "tree-of-life",
          new URL(ref, origins[0]).searchParams,
        ),
        renderer: expect.objectContaining({
          profile: "magickli-tree-image-outlines-v2",
          fonts: [{ file: "NotoSans-Regular.ttf", sha256: "b".repeat(64) }],
        }),
      }),
    ]);
    expect(catalog.metadata.validationSha256).toBe(
      await getRitualImageValidationSha256(),
    );
    const { sha256, ...identity } = catalog.metadata;
    expect(sha256).toBe(hash(JSON.stringify(identity)));
    expect(JSON.stringify(catalog.metadata)).not.toContain(ref);
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("fully decodes PNG and returns native facts", async () => {
    const catalog = await capture(["/api/treeOfLife?fmt=png"]);
    expect(catalog.metadata.entries[0]).toMatchObject({
      kind: "available",
      validationKind: "raster",
      mime: "image/png",
      width: 3,
      frameHeight: 2,
      frames: 1,
      decodedPixels: 6,
      sha256: hash(png),
    });
  });

  it("retains exact alias/origin/query spelling and deterministic entry order", async () => {
    const references = [
      ref,
      "/api/render/tree-of-life?field=name.roman",
      "https://magick.ly/api/treeOfLife?field=name%2Eroman",
    ];
    const first = await capture(references),
      second = await capture([...references].reverse());
    expect(first.metadata).toEqual(second.metadata);
    expect(first.metadata.entries.map((e) => e.referenceSha256)).toEqual(
      references.map(hash).sort(),
    );
    for (const reference of references)
      expect(first.copyBytes(hash(reference))).toEqual(
        new Uint8Array(Buffer.from(svg)),
      );
  });

  it("keeps owned copies and immutable metadata, then wipes retained bytes on disposal", async () => {
    const catalog = await capture(["/api/treeOfLife?fmt=png"]),
      key = hash("/api/treeOfLife?fmt=png");
    const first = catalog.copyBytes(key)!;
    first.fill(0);
    const second = catalog.copyBytes(key)!;
    expect(second).toEqual(new Uint8Array(png));
    expect(catalog.copyBytes("unknown")).toBeNull();
    expect(Object.isFrozen(catalog.metadata.entries[0])).toBe(true);
    const entry = catalog.metadata.entries[0];
    if (entry.kind !== "available") throw new Error("Expected capture");
    expect(Object.isFrozen(entry.renderer.fonts[0])).toBe(true);
    expect(Object.isFrozen(entry.request.props)).toBe(true);
    catalog.dispose();
    catalog.dispose();
    expect(catalog.copyBytes(key)).toBeNull();
    expect(second).toEqual(new Uint8Array(png));
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("snapshots all references/origins before asynchronous rendering", async () => {
    const references = [ref, "/api/treeOfLife?field=index"],
      knownAppOrigins = [...origins];
    let release!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.render.mockImplementationOnce(
      async (...args: Parameters<typeof render>) => {
        await pause;
        return render(...args);
      },
    );
    const pending = capture(references, { knownAppOrigins });
    references[1] = "https://untrusted.example/api/treeOfLife";
    knownAppOrigins[0] = "https://untrusted.example";
    release();
    const catalog = await pending;
    expect(
      catalog.metadata.entries.every((entry) => entry.kind === "available"),
    ).toBe(true);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://untrusted.example/api/treeOfLife",
    "http://magick.ly/api/treeOfLife",
    "https://magick.ly:444/api/treeOfLife",
    "https://name:secret@magick.ly/api/treeOfLife",
    "//magick.ly/api/treeOfLife",
    "/x/../api/treeOfLife",
    "/api/%74reeOfLife",
    "/api/render/__proto__",
    "/api/file2?sha256=" + "a".repeat(64),
    "/pics/image.png",
    "data:image/png;base64,AA==",
    "file:///api/treeOfLife",
    "javascript:alert(1)",
    "/api\\treeOfLife",
    " /api/treeOfLife",
  ])("does not fetch or render unsupported reference %s", async (reference) => {
    expect((await capture([reference])).metadata.entries[0]).toEqual({
      kind: "unresolved",
      referenceSha256: hash(reference),
      reason: "unsupported-reference",
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    "labels=custom",
    "field=unknown",
    "fmt=jpg",
    "width=9999",
    "field=index&field=name.he",
  ])("rejects unsupported query %s before render", async (query) => {
    expect(
      (await capture(["/api/treeOfLife?" + query])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "unsupported-query" });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [ref, null],
    [ref, ...new Array(1)],
    new Array(1),
    [ref, ref],
    [""],
    [ref + "#view"],
    ["\ud800"],
    ["a".repeat(16385)],
    ["é".repeat(8193)],
    new Array(33).fill(ref),
  ])("rejects invalid batches before render %#", async (references) => {
    await expect(capture(references as string[])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [null],
    new Array(1),
    new Array(17).fill(origins[0]),
    ["https://magick.ly/"],
    ["http://magick.ly"],
    ["x".repeat(2049)],
  ])("rejects invalid origin configuration %#", async (knownAppOrigins) => {
    await expect(
      capture([], { knownAppOrigins: knownAppOrigins as string[] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    { references: 0 },
    { referenceBytes: Infinity },
    { imageBytes: 4_194_305 },
    { timeoutMs: -1 },
    { capturedBytes: 0 },
    { unexpected: 1 },
  ])("only tightens known limits %#", async (limits) => {
    await expect(
      capture([ref], { limits: limits as never }),
    ).rejects.toMatchObject({ code: "INVALID_LIMITS" });
  });

  it("honors a tightened reference count/byte budget", async () => {
    await expect(
      capture([ref, "/api/treeOfLife"], { limits: { references: 1 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      capture([ref], { limits: { referenceBytes: 2 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("records oversized output as unresolved and wipes it", async () => {
    expect(
      (await capture([ref], { limits: { imageBytes: 1 } })).metadata.entries[0],
    ).toMatchObject({ reason: "image-limit" });
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("charges failed captures and stops before another render at exhaustion", async () => {
    mocks.render.mockImplementation((...args: Parameters<typeof render>) => ({
      ...render(...args),
      byteSize: 0,
    }));
    await expect(
      capture([ref, "/api/treeOfLife?field=index"], {
        limits: { capturedBytes: Buffer.byteLength(svg) },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("wipes output that crosses the captured-byte limit", async () => {
    await expect(
      capture([ref], { limits: { capturedBytes: 1 } }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it.each(["size", "digest", "request", "mime"])(
    "refuses renderer receipt mismatch: %s",
    async (field) => {
      mocks.render.mockImplementation((...args: Parameters<typeof render>) => {
        const value = render(...args);
        if (field === "size") value.byteSize++;
        if (field === "digest") value.sha256 = "a".repeat(64);
        if (field === "request") value.request.props.flip = true;
        if (field === "mime") value.contentType = "image/png";
        return value;
      });
      expect((await capture()).metadata.entries[0]).toMatchObject({
        kind: "unresolved",
        reason: "render-mismatch",
      });
      expect(supplied[0].every((byte) => byte === 0)).toBe(true);
    },
  );

  it("maps malformed SVG and renderer failure without leaking diagnostics", async () => {
    mocks.render.mockImplementationOnce(
      (...args: Parameters<typeof render>) => {
        const value = render(...args);
        value.bytes = Buffer.from(
          "<svg><script>private diagnostic</script></svg>",
        );
        value.byteSize = value.bytes.length;
        value.sha256 = hash(value.bytes);
        return value;
      },
    );
    expect((await capture()).metadata.entries[0]).toMatchObject({
      reason: "invalid-image",
    });
    mocks.render.mockRejectedValueOnce(new Error("private diagnostic"));
    const failed = await capture();
    expect(failed.metadata.entries[0]).toMatchObject({
      reason: "render-unavailable",
    });
    expect(JSON.stringify(failed.metadata)).not.toContain("private diagnostic");
  });

  it("checks native PNG MIME and decoder failures", async () => {
    mocks.render.mockImplementationOnce(
      (...args: Parameters<typeof render>) => {
        const value = render(...args);
        value.bytes = Buffer.from(jpeg);
        value.byteSize = value.bytes.length;
        value.sha256 = hash(value.bytes);
        return value;
      },
    );
    expect(
      (await capture(["/api/treeOfLife?fmt=png"])).metadata.entries[0],
    ).toMatchObject({ reason: "render-mismatch" });
    vi.spyOn(rasterModule, "createSharpRitualImageValidator").mockReturnValue({
      validate: vi
        .fn()
        .mockRejectedValue(new RitualUploadError("INVALID_IMAGE")),
    });
    expect(
      (await capture(["/api/treeOfLife?fmt=png"])).metadata.entries[0],
    ).toMatchObject({ reason: "invalid-image" });
  });

  it("checks validator output identity and wipes both copies on disagreement", async () => {
    const validate = svgModule.createRitualSvgValidator().validate;
    let copy: Uint8Array | undefined;
    vi.spyOn(svgModule, "createRitualSvgValidator").mockReturnValue({
      validate: async (...args) => {
        const value = await validate(...args);
        if (value.status === "validated") {
          copy = value.bytes;
          value.bytes[0] = 0;
        }
        return value;
      },
    });
    expect((await capture()).metadata.entries[0]).toMatchObject({
      reason: "render-mismatch",
    });
    expect(copy?.every((byte) => byte === 0)).toBe(true);
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a pre-aborted batch without rendering", async () => {
    await expect(
      capture([ref], { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("honors cooperative cancellation after render and wipes output", async () => {
    const controller = new AbortController();
    mocks.render.mockImplementationOnce(
      (...args: Parameters<typeof render>) => {
        const value = render(...args);
        controller.abort();
        return value;
      },
    );
    await expect(
      capture([ref], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(supplied[0].every((byte) => byte === 0)).toBe(true);
  });

  it("honors the cooperative elapsed deadline and destroys prior captures", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mocks.render
      .mockImplementationOnce(render)
      .mockImplementationOnce((...args: Parameters<typeof render>) => {
        const value = render(...args);
        now = GENERATED_RITUAL_IMAGE_LIMITS.timeoutMs + 1;
        return value;
      });
    await expect(
      capture([
        "/api/treeOfLife?fmt=png",
        "/api/treeOfLife?fmt=png&field=index",
      ]),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(supplied.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
      true,
    );
  });

  it("honors the deadline timer between asynchronous phases", async () => {
    vi.useFakeTimers();
    mocks.render.mockImplementationOnce(
      async (...args: Parameters<typeof render>) => {
        await vi.advanceTimersByTimeAsync(30_001);
        return render(...args);
      },
    );
    await expect(capture()).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("represents an empty catalog without loading the renderer", async () => {
    const catalog = await capture([]);
    expect(catalog.metadata.entries).toEqual([]);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
