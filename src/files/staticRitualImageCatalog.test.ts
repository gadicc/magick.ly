import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyStaticImageAliases } from "./legacyStaticImages";
import { RITUAL_UPLOAD_MAX_BYTES } from "./ritualUploadProtocol";
import {
  createStaticRitualImageCatalog,
  STATIC_RASTER_CATALOG_LIMITS,
  STATIC_RASTER_VALIDATION_COMPONENTS,
  type StaticRitualImageCatalog,
} from "./staticRitualImageCatalog";

vi.mock("server-only", () => ({}));

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
  it("keeps SVG, unknown bytes and damaged framing explicitly unresolved", async () => {
    await write(
      "/pics/vector.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
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
  const result = await catalog([]);
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
