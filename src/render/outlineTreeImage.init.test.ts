import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A fresh module instance per test: the resource cache is module state.
async function load(initError: Error | null) {
  vi.resetModules();
  const actual =
    await vi.importActual<typeof import("@resvg/resvg-wasm")>(
      "@resvg/resvg-wasm",
    );
  const initWasm = vi.fn(async (bytes: Uint8Array) => {
    if (!initError) return actual.initWasm(bytes);
    if (/Already initialized/.test(initError.message))
      await actual.initWasm(bytes).catch(() => {});
    throw initError;
  });
  vi.doMock("@resvg/resvg-wasm", () => ({ ...actual, initWasm }));
  return { ...(await import("./outlineTreeImage")), initWasm };
}

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170.5 0 341 598" width="100%"><circle cx="0" cy="100" r="40"/></svg>';

afterEach(() => {
  vi.doUnmock("@resvg/resvg-wasm");
  vi.resetModules();
});

describe("bundled font loading", () => {
  it("refuses names outside the bundled lists before touching the filesystem", async () => {
    const { outlineComponentImage, TREE_IMAGE_PROFILE } = await load(null);
    await expect(
      outlineComponentImage(source, {
        profile: TREE_IMAGE_PROFILE,
        viewBox: [-170.5, 0, 341, 598],
        fonts: ["../secret.ttf" as never],
      }),
    ).rejects.toThrow("Unknown bundled font ../secret.ttf");
  });

  it("retries a font whose read failed without discarding the others", async () => {
    vi.resetModules();
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let failures = 1;
    const readFile = vi.fn(async (file: string, ...rest: unknown[]) => {
      if (String(file).endsWith("EnochianPlain.ttf") && failures-- > 0)
        throw new Error("EIO");
      return (fs.readFile as (...args: unknown[]) => Promise<Buffer>)(
        file,
        ...rest,
      );
    });
    vi.doMock("node:fs/promises", () => ({ ...fs, readFile }));
    const { outlineComponentImage, COMPONENT_IMAGE_PROFILE } = await import(
      "./outlineTreeImage"
    );
    const options = {
      profile: COMPONENT_IMAGE_PROFILE,
      viewBox: [-170.5, 0, 341, 598] as const,
      fonts: ["EnochianPlain.ttf" as const],
    };
    await expect(outlineComponentImage(source, options)).rejects.toThrow("EIO");
    const result = await outlineComponentImage(source, options);
    expect(result.identity.fonts.map((font) => font.file)).toContain(
      "EnochianPlain.ttf",
    );
    const enochianReads = readFile.mock.calls.filter((call) =>
      String(call[0]).endsWith("EnochianPlain.ttf"),
    );
    expect(enochianReads).toHaveLength(2);
    // The base fonts and WASM were read once; only the failed font was retried.
    const sansReads = readFile.mock.calls.filter((call) =>
      String(call[0]).endsWith("NotoSans-Regular.ttf"),
    );
    expect(sansReads).toHaveLength(1);
    vi.doUnmock("node:fs/promises");
  });
});

describe("WASM initialisation guard", () => {
  it("tolerates a runtime whose WASM instance is already initialised", async () => {
    const { outlineTreeImage } = await load(
      new Error(
        "Already initialized. The `initWasm()` function can be used only once.",
      ),
    );
    const result = await outlineTreeImage(source, false);
    expect(result.bytes.toString()).toContain('viewBox="-170.5 0 341 598"');
    expect(result.identity.profile).toBe("magickli-tree-image-outlines-v1");
  });

  it("surfaces other initialisation failures and retries on the next call", async () => {
    const { outlineTreeImage, initWasm } = await load(
      new Error("wasm load failed"),
    );
    await expect(outlineTreeImage(source, false)).rejects.toThrow(
      "wasm load failed",
    );
    // The failed load is not cached; the next call tries again.
    await expect(outlineTreeImage(source, false)).rejects.toThrow(
      "wasm load failed",
    );
    expect(initWasm).toHaveBeenCalledTimes(2);
  });
});
