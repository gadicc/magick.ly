import { crc32 } from "node:zlib";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { RITUAL_IMAGE_LIMITS, RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

vi.mock("server-only", () => ({}));

const active = () => new AbortController().signal;
async function still(format: "png" | "jpeg" | "gif" | "webp") {
  return sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 230, g: 20, b: 0, alpha: 1 },
    },
  })
    .toFormat(format)
    .toBuffer();
}
async function animation(format: "gif" | "webp") {
  const pixels = Buffer.concat([
    Buffer.from([255, 0, 0, 255, 255, 0, 0, 255]),
    Buffer.from([0, 0, 255, 255, 0, 0, 255, 255]),
  ]);
  return sharp(pixels, {
    raw: { width: 2, height: 2, channels: 4, pageHeight: 1 },
  })
    .toFormat(format, { delay: [100, 200], loop: 0 })
    .toBuffer();
}
function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

describe("complete bounded image validation", () => {
  it.each(["png", "jpeg", "gif", "webp"] as const)(
    "fully decodes static %s without changing source bytes",
    async (format) => {
      const bytes = await still(format),
        before = Buffer.from(bytes);
      await expect(
        createSharpRitualImageValidator().validate(bytes, active()),
      ).resolves.toEqual({
        contentType: `image/${format}`,
        width: 3,
        frameHeight: 2,
        frames: 1,
        decodedPixels: 6,
      });
      expect(bytes).toEqual(before);
    },
  );
  it.each(["gif", "webp"] as const)(
    "decodes all frames of animated %s",
    async (format) => {
      const bytes = await animation(format);
      const metadata = await sharp(bytes, { animated: true }).metadata();
      expect(metadata.pages).toBe(2);
      await expect(
        createSharpRitualImageValidator().validate(bytes, active()),
      ).resolves.toMatchObject({
        contentType: `image/${format}`,
        width: 2,
        frameHeight: 1,
        frames: 2,
        decodedPixels: 4,
      });
    },
  );
  it("rejects a damaged later GIF frame even when its first frame still decodes", async () => {
    const bytes = await animation("gif"),
      damaged = bytes.subarray(0, bytes.length - 4);
    await expect(
      sharp(damaged, { pages: 1, failOn: "warning" }).raw().toBuffer(),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      createSharpRitualImageValidator().validate(damaged, active()),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });
  it("rejects truncated WebP and inconsistent RIFF lengths instead of accepting surviving frames", async () => {
    const bytes = await animation("webp");
    const truncated = Buffer.from(bytes.subarray(0, bytes.length - 4));
    const rewrittenLength = Buffer.from(truncated);
    rewrittenLength.writeUInt32LE(rewrittenLength.length - 8, 4);
    for (const damaged of [
      truncated,
      rewrittenLength,
      Buffer.concat([bytes, Buffer.from([0])]),
    ]) {
      await expect(
        createSharpRitualImageValidator().validate(damaged, active()),
      ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    }
  });
  it("rejects GIF trailing data, missing trailer and unsupported text rendering blocks", async () => {
    const bytes = await still("gif");
    const plainText = Buffer.concat([
      bytes.subarray(0, bytes.length - 1),
      Buffer.from([0x21, 0x01, 0x00, 0x3b]),
    ]);
    for (const damaged of [
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([bytes, Buffer.from([0])]),
      plainText,
    ]) {
      await expect(
        createSharpRitualImageValidator().validate(damaged, active()),
      ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    }
  });
  it("honors cancellation while actual file-type detection is underway", async () => {
    const bytes = await animation("webp"),
      controller = new AbortController();
    const pending = createSharpRitualImageValidator().validate(
      bytes,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
  it.each([0, 8192])(
    "rejects APNG even with %i bytes of preceding ancillary data",
    async (padding) => {
      const base = await still("png"),
        animationControl = Buffer.alloc(8);
      animationControl.writeUInt32BE(2);
      const ancillary = padding
        ? pngChunk(
            "tEXt",
            Buffer.concat([
              Buffer.from("Comment\0"),
              Buffer.alloc(padding, 65),
            ]),
          )
        : Buffer.alloc(0);
      const bytes = Buffer.concat([
        base.subarray(0, 33),
        ancillary,
        pngChunk("acTL", animationControl),
        base.subarray(33),
      ]);
      expect(await fileTypeFromBuffer(bytes)).toEqual({
        ext: "apng",
        mime: "image/apng",
      });
      await expect(
        createSharpRitualImageValidator().validate(bytes, active()),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_ANIMATION" });
    },
  );
  it("rejects SVG and plausible PNG headers without pixel data", async () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10]);
    header.set([73, 72, 68, 82], 12);
    header[19] = 1;
    header[23] = 1;
    for (const bytes of [
      header,
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      ),
    ]) {
      await expect(
        createSharpRitualImageValidator().validate(bytes, active()),
      ).rejects.toBeInstanceOf(RitualUploadError);
    }
  });
  it("enforces frame, dimension and aggregate pixel limits", async () => {
    const bytes = await animation("gif");
    for (const limit of [
      { maxFrames: 1 },
      { maxDimension: 1 },
      { maxPixels: 3 },
    ]) {
      await expect(
        createSharpRitualImageValidator({
          ...RITUAL_IMAGE_LIMITS,
          ...limit,
        }).validate(bytes, active()),
      ).rejects.toMatchObject({ code: "IMAGE_LIMIT" });
    }
  });
  it("keeps validated limits fixed when the caller later changes its configuration", async () => {
    const limits = { ...RITUAL_IMAGE_LIMITS, maxDimension: 1 };
    const validator = createSharpRitualImageValidator(limits);
    limits.maxDimension = RITUAL_IMAGE_LIMITS.maxDimension;
    await expect(
      validator.validate(await still("png"), active()),
    ).rejects.toMatchObject({ code: "IMAGE_LIMIT" });
  });
  it("rejects empty and oversized input at the decoder boundary too", async () => {
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(20 * 1024 * 1024 + 1),
    ]) {
      await expect(
        createSharpRitualImageValidator().validate(bytes, active()),
      ).rejects.toMatchObject({ code: "TOO_LARGE" });
    }
  });
  it("rejects unsafe disabled or expanded resource limits and pre-aborted work", async () => {
    expect(() =>
      createSharpRitualImageValidator({ ...RITUAL_IMAGE_LIMITS, maxFrames: 0 }),
    ).toThrow();
    expect(() =>
      createSharpRitualImageValidator({
        ...RITUAL_IMAGE_LIMITS,
        decodeSeconds: 16,
      }),
    ).toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSharpRitualImageValidator().validate(
        await still("png"),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });
});
