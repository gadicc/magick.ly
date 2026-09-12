import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => {
  const pipeline = {
    metadata: vi.fn(),
    toBuffer: vi.fn(),
    destroy: vi.fn(),
    timeout() {
      return this;
    },
    toColourspace() {
      return this;
    },
    ensureAlpha() {
      return this;
    },
    raw() {
      return this;
    },
  };
  return { pipeline, factory: vi.fn(() => pipeline) };
});
vi.mock("sharp", () => ({ default: native.factory }));

import { createSharpRitualImageValidator } from "./validateRitualImage";

// These tests project inconsistent native results which valid inputs cannot
// reliably produce. Real all-frame decoding is exercised in the other suite;
// the separate native-timeout smoke proves libvips actually stops its worker.
beforeEach(() => {
  vi.clearAllMocks();
  native.pipeline.metadata.mockResolvedValue({ width: 2, height: 2 });
  native.pipeline.toBuffer.mockResolvedValue({
    info: { width: 2, height: 2, channels: 4 },
    data: Buffer.alloc(16),
  });
});
async function png() {
  const actual = await vi.importActual<typeof import("sharp")>("sharp");
  return actual
    .default({
      create: { width: 2, height: 2, channels: 4, background: "red" },
    })
    .png()
    .toBuffer();
}

describe("native decoder failure projection", () => {
  it("fails closed if reported frame count disagrees with the accepted container", async () => {
    native.pipeline.metadata.mockResolvedValue({
      width: 2,
      height: 2,
      pages: 2,
      pageHeight: 1,
    });
    await expect(
      createSharpRitualImageValidator().validate(
        await png(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(native.pipeline.toBuffer).not.toHaveBeenCalled();
    expect(native.pipeline.destroy).toHaveBeenCalledOnce();
  });
  it("fails closed if native decoded output is incomplete despite successful metadata", async () => {
    native.pipeline.toBuffer.mockResolvedValue({
      info: { width: 2, height: 2, channels: 4 },
      data: Buffer.alloc(15),
    });
    await expect(
      createSharpRitualImageValidator().validate(
        await png(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(native.pipeline.destroy).toHaveBeenCalledOnce();
  });
  it("projects the observed native timeout to a safe domain error and destroys the pipeline", async () => {
    native.pipeline.toBuffer.mockRejectedValue(
      new Error("timeout: 27% complete; provider-private context"),
    );
    await expect(
      createSharpRitualImageValidator().validate(
        await png(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "TIMEOUT" });
    expect(native.pipeline.destroy).toHaveBeenCalledOnce();
  });
});
