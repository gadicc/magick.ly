import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as yieldTask } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyStaticImageAliases } from "./legacyStaticImages";
import { RITUAL_UPLOAD_MAX_BYTES } from "./ritualUploadProtocol";
import {
  createStaticRitualImageCatalog,
  STATIC_RASTER_CATALOG_LIMITS,
  STATIC_RASTER_VALIDATION_COMPONENTS,
  STATIC_SVG_VALIDATION_COMPONENTS,
  type StaticRitualImageCatalog,
} from "./staticRitualImageCatalog";

vi.mock("server-only", () => ({}));

import * as svgModule from "./validateRitualSvg";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
let root: string;
let publicDirectory: string;
const catalogs: StaticRitualImageCatalog[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "magickli-static-catalog-"));
  publicDirectory = path.join(root, "public");
  await fs.mkdir(path.join(publicDirectory, "pics"), { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const catalog of catalogs.splice(0)) catalog.dispose();
  await fs.rm(root, { recursive: true, force: true });
});
async function raster(
  format: "png" | "jpeg" | "gif" | "webp" = "png",
  color = "red",
) {
  return sharp({
    create: { width: 3, height: 2, channels: 4, background: color },
  })
    .toFormat(format)
    .toBuffer();
}
async function write(name: string, bytes: Uint8Array | string) {
  const file = path.join(publicDirectory, name.slice(1));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return file;
}
async function catalog(
  paths: string[],
  options: Partial<Parameters<typeof createStaticRitualImageCatalog>[0]> = {},
) {
  const result = await createStaticRitualImageCatalog({
    publicDirectory,
    paths,
    ...options,
  });
  catalogs.push(result);
  return result;
}

describe("captured static raster evidence", () => {
  it.each(["png", "jpeg", "gif", "webp"] as const)(
    "validates actual %s pixels and preserves exact compressed bytes",
    async (format) => {
      const bytes = await raster(format);
      const pathname = `/pics/synthetic.${format}`;
      await write(pathname, bytes);
      const result = await catalog([pathname]);
      expect(result.metadata.entries).toEqual([
        {
          kind: "available",
          validationKind: "raster",
          pathname,
          canonicalPathname: pathname,
          sha256: hash(bytes),
          bytes: bytes.length,
          mime: `image/${format}`,
          width: 3,
          frameHeight: 2,
          frames: 1,
          decodedPixels: 6,
        },
      ]);
      expect(result.copyBytes(pathname)).toEqual(new Uint8Array(bytes));
      expect(result.metadata.availablePaths).toEqual([pathname]);
    },
  );
  it.each(["gif", "webp"] as const)(
    "validates every frame of %s",
    async (format) => {
      const pixels = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
      const bytes = await sharp(pixels, {
        raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
      })
        .toFormat(format, { delay: [100, 200], loop: 0 })
        .toBuffer();
      await write(`/pics/animated.${format}`, bytes);
      const result = await catalog([`/pics/animated.${format}`]);
      expect(result.metadata.entries[0]).toMatchObject({
        kind: "available",
        frames: 2,
        decodedPixels: 2,
      });
      expect(result.copyBytes(`/pics/animated.${format}`)).toEqual(
        new Uint8Array(bytes),
      );
    },
  );
  it("detects MIME from bytes, not a misleading extension", async () => {
    const bytes = await raster("jpeg");
    await write("/pics/not-a-png.png", bytes);
    expect(
      (await catalog(["/pics/not-a-png.png"])).metadata.entries[0],
    ).toMatchObject({ kind: "available", mime: "image/jpeg" });
  });
  it("keeps unsupported SVG, unknown bytes and damaged framing explicitly unresolved", async () => {
    await write(
      "/pics/vector.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://untrusted.invalid/x"/></svg>',
    );
    await write("/pics/not-an-image.png", "not an image");
    const gif = await raster("gif");
    await write("/pics/broken.gif", gif.subarray(0, gif.length - 1));
    const result = await catalog([
      "/pics/vector.svg",
      "/pics/not-an-image.png",
      "/pics/broken.gif",
    ]);
    expect(
      result.metadata.entries.map((e) => e.kind === "unresolved" && e.reason),
    ).toEqual(["invalid-image", "unsupported-type", "unsupported-svg"]);
    expect(result.metadata.availablePaths).toEqual([]);
    for (const entry of result.metadata.entries)
      expect(result.copyBytes(entry.pathname)).toBeNull();
  });
  it("keeps missing files and non-files out of usable membership", async () => {
    await fs.mkdir(path.join(publicDirectory, "pics/directory.png"));
    const result = await catalog(["/pics/missing.png", "/pics/directory.png"]);
    expect(
      result.metadata.entries.map((e) => e.kind === "unresolved" && e.reason),
    ).toEqual(["unsafe-file", "source-unavailable"]);
    expect(result.metadata.availablePaths).toEqual([]);
  });
  it.each([0, RITUAL_UPLOAD_MAX_BYTES + 1])(
    "rejects file size %i before opening or decoding",
    async (size) => {
      const file = await write("/pics/oversized.png", "x");
      await fs.truncate(file, size);
      const open = vi.spyOn(fs, "open");
      const result = await catalog(["/pics/oversized.png"]);
      expect(result.metadata.entries[0]).toMatchObject({
        kind: "unresolved",
        reason: "too-large",
      });
      expect(open).not.toHaveBeenCalled();
    },
  );
  it("is deterministic across input ordering, but changes with bytes, dimensions or configured membership", async () => {
    await write("/pics/a.png", await raster());
    await write("/pics/b.png", await raster("png", "blue"));
    const a = await catalog(["/pics/b.png", "/pics/a.png"]);
    const b = await catalog(["/pics/a.png", "/pics/b.png"]);
    expect(a.metadata).toEqual(b.metadata);
    expect((await catalog(["/pics/a.png"])).metadata.sha256).not.toBe(
      a.metadata.sha256,
    );
    await write("/pics/a.png", await raster("png", "green"));
    const c = await catalog(["/pics/a.png", "/pics/b.png"]);
    expect(c.metadata.sha256).not.toBe(a.metadata.sha256);
    expect(c.metadata.validationSha256).toBe(a.metadata.validationSha256);
  });
  it("retains independent snapshots after caller edits, disk replacement, deletion and disposal", async () => {
    const bytes = await raster();
    const file = await write("/pics/a.png", bytes);
    const result = await catalog(["/pics/a.png"]);
    const digest = result.metadata.sha256;
    const copy = result.copyBytes("/pics/a.png")!;
    copy.fill(0);
    await fs.writeFile(file, await raster("png", "blue"));
    expect(result.copyBytes("/pics/a.png")).toEqual(new Uint8Array(bytes));
    await fs.unlink(file);
    expect(result.copyBytes("/pics/a.png")).toEqual(new Uint8Array(bytes));
    expect(result.metadata.sha256).toBe(digest);
    expect(() => {
      Object.assign(result.metadata.entries[0], { bytes: 0 });
    }).toThrow();
    expect(() => {
      (result.metadata.availablePaths as string[]).push("/pics/fake.png");
    }).toThrow();
    const owned = result.copyBytes("/pics/a.png")!;
    result.dispose();
    expect(result.copyBytes("/pics/a.png")).toBeNull();
    expect(owned).toEqual(new Uint8Array(bytes));
  });
  it("never discovers unconfigured files or equates query, fragment, case and absolute URLs", async () => {
    await write("/pics/a.png", await raster());
    await write("/pics/secret.png", await raster());
    const result = await catalog(["/pics/a.png"]);
    for (const candidate of [
      "/pics/secret.png",
      "/pics/A.png",
      "/pics/a.png?x=1",
      "/pics/a.png#view",
      "https://magick.ly/pics/a.png",
    ])
      expect(result.copyBytes(candidate)).toBeNull();
    expect(result.metadata.entries).toHaveLength(1);
  });
});

describe("exact aliases", () => {
  it("binds each shared alias to a validated snapshot and keeps original/canonical identity separate", async () => {
    const bytes = await raster();
    for (const target of Object.values(legacyStaticImageAliases))
      await write(target, bytes);
    const result = await catalog(Object.values(legacyStaticImageAliases));
    for (const [pathname, canonicalPathname] of Object.entries(
      legacyStaticImageAliases,
    )) {
      expect(
        result.metadata.entries.find((e) => e.pathname === pathname),
      ).toMatchObject({
        kind: "available",
        pathname,
        canonicalPathname,
        sha256: hash(bytes),
      });
      expect(result.copyBytes(pathname)).toEqual(
        result.copyBytes(canonicalPathname),
      );
      expect(result.metadata.availablePaths).toContain(pathname);
    }
  });
  it("never exposes an alias whose target is absent, invalid or unconfigured", async () => {
    const [a, b] = Object.entries(legacyStaticImageAliases);
    await write(b[1], "broken");
    const result = await catalog([a[1], b[1]]);
    expect(result.metadata.availablePaths).toEqual([]);
    expect(
      result.metadata.entries.find((e) => e.pathname === a[0]),
    ).toMatchObject({ kind: "unresolved", reason: "source-unavailable" });
    expect(
      result.metadata.entries.find((e) => e.pathname === b[0]),
    ).toMatchObject({ kind: "unresolved", reason: "unsupported-type" });
    expect((await catalog([])).metadata.entries).toEqual([]);
  });
  it("captures both actual current public PNG alias targets and proves their shared exact byte identity", async () => {
    const actualPublic = await fs.realpath(path.join(here, "../../public"));
    const result = await catalog(Object.values(legacyStaticImageAliases), {
      publicDirectory: actualPublic,
    });
    expect(result.metadata.entries).toHaveLength(4);
    for (const [original, target] of Object.entries(legacyStaticImageAliases)) {
      const bytes = await fs.readFile(path.join(actualPublic, target.slice(1)));
      const entry = result.metadata.entries.find(
        (e) => e.pathname === original,
      )!;
      expect(entry).toMatchObject({
        kind: "available",
        canonicalPathname: target,
        sha256: hash(bytes),
        bytes: bytes.length,
        mime: "image/png",
        width: 1080,
        frameHeight: 1080,
      });
      expect(result.copyBytes(original)).toEqual(new Uint8Array(bytes));
    }
  });
});

describe("filesystem and build bounds", () => {
  it.each([
    "../pics/a.png",
    "/pics/../outside.png",
    "/pics/./a.png",
    "/pics//a.png",
    "/pics/a.png?x",
    "/pics/a.png#view",
    "/pics/%2e%2e/out.png",
    "/pics/a\\b.png",
    "/pics/a b.png",
    "/pics/α.png",
    "/other/a.png",
    "/pics/",
    "https://magick.ly/pics/a.png",
    "/pics/\0x.png",
  ])("rejects unsupported or unsafe configured pathname %j", async (value) => {
    const open = vi.spyOn(fs, "open");
    await expect(catalog([value])).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects duplicate paths, alias sources, relative roots and expanded limits", async () => {
    await expect(catalog(["/pics/a.png", "/pics/a.png"])).rejects.toMatchObject(
      { code: "INVALID_CONFIGURATION" },
    );
    await expect(
      catalog([Object.keys(legacyStaticImageAliases)[0]]),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      catalog([], { publicDirectory: "public" }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      catalog([], {
        limits: { paths: STATIC_RASTER_CATALOG_LIMITS.paths + 1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      catalog(["/pics/a.png", "/pics/b.png"], { limits: { paths: 1 } }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      catalog([], { limits: { capturedBytes: 0 } }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });
  it.each(["leaf", "directory", "public-root"])(
    "refuses %s symlinks without reading their contents",
    async (kind) => {
      const bytes = await raster();
      const outside = path.join(root, "outside");
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "a.png"), bytes);
      let pathname = "/pics/a.png";
      let selectedRoot = publicDirectory;
      if (kind === "leaf")
        await fs.symlink(
          path.join(outside, "a.png"),
          path.join(publicDirectory, "pics/a.png"),
        );
      if (kind === "directory") {
        await fs.symlink(outside, path.join(publicDirectory, "pics/nested"));
        pathname = "/pics/nested/a.png";
      }
      if (kind === "public-root") {
        selectedRoot = path.join(root, "linked");
        await fs.symlink(publicDirectory, selectedRoot);
      }
      const open = vi.spyOn(fs, "open");
      const result = await catalog([pathname], {
        publicDirectory: selectedRoot,
      });
      expect(result.metadata.entries[0]).toMatchObject({
        kind: "unresolved",
        reason: "unsafe-file",
      });
      expect(open).not.toHaveBeenCalled();
    },
  );
  it("supports exact nested regular paths", async () => {
    await write("/pics/nested/a.png", await raster());
    expect(
      (await catalog(["/pics/nested/a.png"])).metadata.availablePaths,
    ).toEqual(["/pics/nested/a.png"]);
  });
  it("bounds aggregate captured bytes before opening the next file", async () => {
    const bytes = await raster();
    await write("/pics/a.png", bytes);
    await write("/pics/b.png", bytes);
    const open = vi.spyOn(fs, "open");
    await expect(
      catalog(["/pics/a.png", "/pics/b.png"], {
        limits: { capturedBytes: bytes.length },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(open).toHaveBeenCalledTimes(1);
    // Failure publishes no partial catalog; rebuilding starts with a fresh budget.
    expect(
      (
        await catalog(["/pics/a.png"], {
          limits: { capturedBytes: bytes.length },
        })
      ).metadata.availablePaths,
    ).toEqual(["/pics/a.png"]);
  });
  it("clears already captured buffers when a later capture exceeds the total budget", async () => {
    const bytes = await raster();
    await write("/pics/a.png", bytes);
    await write("/pics/b.png", bytes);
    const observed: Uint8Array[] = [];
    const original = fs.open;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await original(...args);
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation((async (
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) => {
        observed.push(buffer);
        return read(buffer, offset, length, position);
      }) as typeof handle.read);
      return handle;
    });
    await expect(
      catalog(["/pics/a.png", "/pics/b.png"], {
        limits: { capturedBytes: bytes.length },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(observed).toHaveLength(1);
    expect(observed[0].every((byte) => byte === 0)).toBe(true);
  });
  it("handles partial reads and rejects truncation during a read while closing its handle", async () => {
    const bytes = await raster();
    const file = await write("/pics/a.png", bytes);
    const original = fs.open;
    let closed = false;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await original(...args);
      const read = handle.read.bind(handle),
        close = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockImplementation((async (
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) => {
        const result = await read(
          buffer,
          offset,
          Math.min(length, 5),
          position,
        );
        await fs.truncate(file, 5);
        return result;
      }) as typeof handle.read);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closed = true;
        await close();
      });
      return handle;
    });
    expect((await catalog(["/pics/a.png"])).metadata.entries[0]).toMatchObject({
      kind: "unresolved",
      reason: "source-changed",
    });
    expect(closed).toBe(true);
  });
  it("preserves explicit dimension-limit failure from the real validator", async () => {
    const bytes = await sharp({
      create: { width: 16_385, height: 1, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await write("/pics/wide.png", bytes);
    expect(
      (await catalog(["/pics/wide.png"])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "image-limit" });
  });
  it("counts invalid reads toward the aggregate budget too", async () => {
    await write("/pics/a.png", "invalid bytes");
    await write("/pics/b.png", "invalid bytes");
    const open = vi.spyOn(fs, "open");
    await expect(
      catalog(["/pics/a.png", "/pics/b.png"], {
        limits: { capturedBytes: 13 },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("captures options before asynchronous filesystem work", async () => {
    const bytes = await raster();
    await write("/pics/a.png", bytes);
    const options = {
      publicDirectory,
      paths: ["/pics/a.png"],
      limits: { capturedBytes: bytes.length },
    };
    const pending = createStaticRitualImageCatalog(options);
    options.paths[0] = "/pics/missing.png";
    options.publicDirectory = "/missing";
    options.limits.capturedBytes = 1;
    const result = await pending;
    catalogs.push(result);
    expect(result.metadata.availablePaths).toEqual(["/pics/a.png"]);
  });
  it("rejects pre-abort and cancellation after a captured file without exposing partial metadata", async () => {
    const controller = new AbortController();
    controller.abort();
    const open = vi.spyOn(fs, "open");
    await expect(
      catalog([], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(open).not.toHaveBeenCalled();
    const bytes = await raster();
    await write("/pics/a.png", bytes);
    await write("/pics/b.png", bytes);
    const active = new AbortController();
    const original = fs.lstat;
    vi.spyOn(fs, "lstat").mockImplementation((async (
      ...args: Parameters<typeof fs.lstat>
    ) => {
      if (args[0] === path.join(publicDirectory, "pics/b.png")) active.abort();
      return original(...args);
    }) as typeof fs.lstat);
    await expect(
      catalog(["/pics/a.png", "/pics/b.png"], { signal: active.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
  it("rejects file replacement between initial lstat and opening the snapshot", async () => {
    const file = await write("/pics/a.png", await raster());
    const replacement = await raster("png", "blue");
    const original = fs.open;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      await fs.unlink(file);
      await fs.writeFile(file, replacement);
      return original(...args);
    });
    expect((await catalog(["/pics/a.png"])).metadata.entries[0]).toMatchObject({
      kind: "unresolved",
      reason: "source-changed",
    });
  });
  it("rejects a disk change after capture and closes the owned handle", async () => {
    const file = await write("/pics/a.png", await raster());
    let seen = 0;
    const original = fs.lstat;
    vi.spyOn(fs, "lstat").mockImplementation((async (
      ...args: Parameters<typeof fs.lstat>
    ) => {
      if (args[0] === file && ++seen === 2)
        await fs.writeFile(file, await raster("png", "blue"));
      return original(...args);
    }) as typeof fs.lstat);
    const result = await catalog(["/pics/a.png"]);
    expect(result.metadata.entries[0]).toMatchObject({
      kind: "unresolved",
      reason: "source-changed",
    });
    expect(result.copyBytes("/pics/a.png")).toBeNull();
  });
});

it("pins actual validator/framing/policy sources and decoder dependencies, including native versions in the validation digest", async () => {
  const components = STATIC_RASTER_VALIDATION_COMPONENTS;
  for (const [file, expected] of [
    ["validateRitualImage.ts", components.validateRitualImageSha256],
    ["ritualImageFrames.ts", components.ritualImageFramesSha256],
    ["ritualUploadProtocol.ts", components.ritualUploadProtocolSha256],
  ])
    expect(hash(readFileSync(path.join(here, file)))).toBe(expected);
  expect(
    JSON.parse(
      readFileSync(
        path.join(here, "../../node_modules/sharp/package.json"),
        "utf8",
      ),
    ).version,
  ).toBe(components.sharp);
  expect(
    JSON.parse(
      readFileSync(
        path.join(here, "../../node_modules/file-type/package.json"),
        "utf8",
      ),
    ).version,
  ).toBe(components["file-type"]);
  const svgComponents = STATIC_SVG_VALIDATION_COMPONENTS;
  for (const [file, expected] of [
    ["validateRitualSvg.ts", svgComponents.validateRitualSvgSha256],
    ["dataImage.ts", svgComponents.dataImageSha256],
  ])
    expect(hash(readFileSync(path.join(here, file)))).toBe(expected);
  for (const name of ["css-tree", "saxes", "xmlchars"] as const)
    expect(
      JSON.parse(
        readFileSync(
          path.join(here, "../../node_modules", name, "package.json"),
          "utf8",
        ),
      ).version,
    ).toBe(svgComponents[name]);
  // Resolve from the package's real path so its own sibling copies win over
  // whichever versions pnpm happened to hoist.
  const parserRequire = createRequire(
    realpathSync(path.join(here, "../../node_modules/css-tree/package.json")),
  );
  for (const name of ["mdn-data", "source-map-js"] as const)
    expect(
      JSON.parse(
        readFileSync(parserRequire.resolve(name + "/package.json"), "utf8"),
      ).version,
    ).toBe(svgComponents[name]);
  const result = await catalog([]);
  expect(result.metadata.profile).toBe("magickli-static-image-catalog-v2");
  expect(result.metadata.validationProfile).toBe(
    "magickli-static-image-validation-v2",
  );
  expect(result.metadata.validationSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(sharp.versions.vips).toBeTruthy();
  const original = sharp.versions.vips;
  try {
    sharp.versions.vips = "synthetic-different-native-version";
    const changed = await catalog([]);
    expect(changed.metadata.validationSha256).not.toBe(
      result.metadata.validationSha256,
    );
    expect(changed.metadata.sha256).not.toBe(result.metadata.sha256);
  } finally {
    sharp.versions.vips = original;
  }
});

const svg = (body = "", attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
describe("static SVG compatibility catalog v2", () => {
  it("retains exact BOM/CRLF/Unicode bytes and discriminated dependency facts without outer pixel claims", async () => {
    const source =
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      svg(
        '<defs><path id="é" d="M0 0L1 1"/></defs><use href="#é"/><!--keep--><title>א &amp; ä</title>',
        'width="1000000" height="2000000"',
      );
    const bytes = Buffer.from(source);
    await write("/pics/diagram.svg", bytes);
    const result = await catalog(["/pics/diagram.svg"]);
    const entry = result.metadata.entries[0];
    expect(entry).toMatchObject({
      kind: "available",
      validationKind: "svg",
      mime: "image/svg+xml",
      svgProfile: svgModule.RITUAL_SVG_PROFILE,
      localReferences: 1,
      sha256: hash(bytes),
      bytes: bytes.length,
      embeddedRasters: [],
    });
    for (const key of [
      "width",
      "height",
      "frameHeight",
      "frames",
      "decodedPixels",
    ])
      expect(Object.hasOwn(entry, key)).toBe(false);
    expect(result.copyBytes("/pics/diagram.svg")).toEqual(
      new Uint8Array(bytes),
    );
  });
  it("freezes embedded raster facts separately and retains bytes across caller mutation and disk replacement", async () => {
    const png = await raster();
    const bytes = Buffer.from(
      svg(
        `<image href="data:image/png;base64,${png.toString("base64")}" width="3" height="2"/>`,
      ),
    );
    const file = await write("/pics/embedded.svg", bytes);
    const result = await catalog(["/pics/embedded.svg"]);
    const entry = result.metadata.entries[0];
    if (entry.kind !== "available" || entry.validationKind !== "svg")
      throw Error("Expected SVG");
    expect(entry.embeddedRasters).toEqual([
      {
        contentType: "image/png",
        width: 3,
        frameHeight: 2,
        frames: 1,
        decodedPixels: 6,
        sha256: hash(png),
        byteSize: png.length,
      },
    ]);
    expect(() => {
      Object.assign(entry.embeddedRasters[0], { sha256: "changed" });
    }).toThrow();
    expect(Object.isFrozen(entry.embeddedRasters)).toBe(true);
    result.copyBytes("/pics/embedded.svg")!.fill(0);
    await fs.writeFile(file, svg());
    expect(result.copyBytes("/pics/embedded.svg")).toEqual(
      new Uint8Array(bytes),
    );
    const rebuilt = await catalog(["/pics/embedded.svg"]);
    expect(rebuilt.metadata.sha256).not.toBe(result.metadata.sha256);
    expect(rebuilt.metadata.validationSha256).toBe(
      result.metadata.validationSha256,
    );
    result.dispose();
    expect(result.copyBytes("/pics/embedded.svg")).toBeNull();
  });
  it.each([
    ["syntax", "<not-closed", "invalid-svg"],
    [
      "active",
      svg("<script>private diagnostic sentinel</script>"),
      "invalid-svg",
    ],
    [
      "external",
      svg('<image href="https://untrusted.invalid/private-sentinel"/>'),
      "unsupported-svg",
    ],
    [
      "css",
      svg(
        "<style>@font-face{font-family:x;src:url(https://untrusted.invalid/font)}</style>",
      ),
      "unsupported-svg",
    ],
    ["unknown", svg("<meshgradient/>"), "unsupported-svg"],
    ["missing fragment", svg('<use href="#missing"/>'), "invalid-svg"],
  ])(
    "reports %s as a safe typed unresolved result",
    async (_name, source, reason) => {
      await write("/pics/bad.svg", source);
      const result = await catalog(["/pics/bad.svg"]);
      expect(result.metadata.entries).toEqual([
        {
          kind: "unresolved",
          pathname: "/pics/bad.svg",
          canonicalPathname: "/pics/bad.svg",
          reason,
        },
      ]);
      expect(JSON.stringify(result.metadata)).not.toContain("private-sentinel");
      expect(JSON.stringify(result.metadata)).not.toContain(
        "diagnostic sentinel",
      );
      expect(result.metadata.availablePaths).toEqual([]);
      expect(result.copyBytes("/pics/bad.svg")).toBeNull();
    },
  );
  it("bounds SVG capture at 4MiB before opening or allocating it", async () => {
    const file = await write("/pics/large.svg", svg());
    await fs.truncate(file, svgModule.RITUAL_SVG_LIMITS.bytes + 1);
    const open = vi.spyOn(fs, "open");
    expect(
      (await catalog(["/pics/large.svg"])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "too-large" });
    expect(open).not.toHaveBeenCalled();
  });
  it("charges SVG capture against the same aggregate budget as raster bytes", async () => {
    const png = await raster();
    await write("/pics/a.png", png);
    await write("/pics/b.svg", svg());
    const open = vi.spyOn(fs, "open");
    await expect(
      catalog(["/pics/a.png", "/pics/b.svg"], {
        limits: { capturedBytes: png.length },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("clears a previously captured SVG when the next read would exceed the aggregate bound", async () => {
    const bytes = Buffer.from(svg("<path/>"));
    await write("/pics/a.svg", bytes);
    await write("/pics/b.svg", bytes);
    const original = svgModule.createRitualSvgValidator;
    const results: Uint8Array[] = [];
    vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() => {
      const validator = original();
      return {
        validate: async (...args) => {
          const result = await validator.validate(...args);
          if (result.status === "validated") results.push(result.bytes);
          return result;
        },
      };
    });
    await expect(
      catalog(["/pics/a.svg", "/pics/b.svg"], {
        limits: { capturedBytes: bytes.length },
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(results).toHaveLength(1);
    expect(results[0].every((byte) => byte === 0)).toBe(true);
  });
  it("rejects excessive SVG expansion using the actual closed validator", async () => {
    const chain = Array.from(
      { length: 18 },
      (_, i) =>
        `<g id="n${i}">${i ? `<use href="#n${i - 1}"/><use href="#n${i - 1}"/>` : "<path/>"}</g>`,
    ).join("");
    await write(
      "/pics/expansion.svg",
      svg(`<defs>${chain}</defs><use href="#n17"/>`),
    );
    expect(
      (await catalog(["/pics/expansion.svg"])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "svg-limit" });
  });
  it("aborts during actual chunked SVG validation and exposes no partial catalog", async () => {
    await write("/pics/a.png", await raster());
    await write("/pics/b.svg", svg("<path/>".repeat(10_000)));
    const controller = new AbortController();
    const original = svgModule.createRitualSvgValidator;
    vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() => {
      const validator = original();
      return {
        validate: async (...args) => {
          const pending = validator.validate(...args);
          await yieldTask();
          controller.abort();
          return pending;
        },
      };
    });
    await expect(
      catalog(["/pics/a.png", "/pics/b.svg"], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
  it("clears the validator-owned SVG snapshot when cancellation races its successful return", async () => {
    await write("/pics/late.svg", svg());
    const controller = new AbortController();
    const original = svgModule.createRitualSvgValidator;
    const captured: Uint8Array[] = [];
    vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() => {
      const validator = original();
      return {
        validate: async (...args) => {
          const result = await validator.validate(...args);
          if (result.status === "validated") captured.push(result.bytes);
          controller.abort();
          return result;
        },
      };
    });
    await expect(
      catalog(["/pics/late.svg"], { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(captured).toHaveLength(1);
    expect(captured[0].every((byte) => byte === 0)).toBe(true);
  });
  it("retains a safe unresolved timeout with the actual parser and a tightened test deadline", async () => {
    await write("/pics/time.svg", svg("<path/>".repeat(15_000)));
    const original = svgModule.createRitualSvgValidator;
    vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() =>
      original({ timeoutMs: 1 }),
    );
    expect(
      (await catalog(["/pics/time.svg"])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "validation-timeout" });
  });
  it("rejects a changed validator snapshot instead of publishing mismatched byte facts", async () => {
    await write("/pics/changed.svg", svg());
    const original = svgModule.createRitualSvgValidator;
    const seen: Uint8Array[] = [];
    vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() => {
      const validator = original();
      return {
        validate: async (...args) => {
          const result = await validator.validate(...args);
          if (result.status === "validated") {
            result.bytes[0] ^= 1;
            seen.push(result.bytes);
          }
          return result;
        },
      };
    });
    expect(
      (await catalog(["/pics/changed.svg"])).metadata.entries[0],
    ).toMatchObject({ kind: "unresolved", reason: "source-changed" });
    expect(seen[0].every((byte) => byte === 0)).toBe(true);
  });
  it("validates all15 actual public images plus2 exact aliases without changing any source bytes", async () => {
    const publicDirectory = await fs.realpath(path.join(here, "../../public"));
    const names = [
      "30aethyrs.jpg",
      "Anxfisa_Golden_Dawn_Robes.jpg",
      "SevenBranchedCandleStick-magickly-export.png",
      "TableOfShewbread-magickly-export.png",
      "about.png",
      "candidate-hexagram.jpg",
      "candidate-hexagram.svg",
      "mercury.webp",
      "neophyte.svg",
      "planets2013.jpg",
      "theoricus1.svg",
      "theoricus2.svg",
      "treeOfLife.jpg",
      "zelator1.svg",
      "zelator2.svg",
    ];
    const paths = names.map((name) => `/pics/${name}`);
    const before = await Promise.all(
      paths.map(async (name) =>
        hash(await fs.readFile(path.join(publicDirectory, name.slice(1)))),
      ),
    );
    const result = await catalog(paths, { publicDirectory });
    expect(result.metadata.availablePaths).toHaveLength(17);
    const images = result.metadata.entries.filter(
      (entry) => entry.kind === "available",
    );
    expect(
      images.filter((entry) => entry.validationKind === "svg"),
    ).toHaveLength(6);
    expect(
      images.filter((entry) => entry.validationKind === "raster"),
    ).toHaveLength(11);
    for (const entry of images) {
      const bytes = result.copyBytes(entry.pathname)!;
      expect(hash(bytes)).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.bytes);
      if (entry.validationKind === "svg") {
        expect(entry.embeddedRasters).toHaveLength(
          entry.pathname.includes("theoricus1")
            ? 1
            : entry.pathname.includes("theoricus2")
              ? 3
              : 0,
        );
      }
    }
    const after = await Promise.all(
      paths.map(async (name) =>
        hash(await fs.readFile(path.join(publicDirectory, name.slice(1)))),
      ),
    );
    expect(after).toEqual(before);
    expect(
      (await catalog([...paths].reverse(), { publicDirectory })).metadata,
    ).toEqual(result.metadata);
  });
});
