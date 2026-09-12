import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { countRitualImageFrames } from "./ritualImageFrames";
import { RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

vi.mock("server-only", () => ({}));

async function encoded(format: "gif" | "webp", frames = 1) {
  const pixels = Buffer.alloc(frames * 4);
  for (let frame = 0; frame < frames; frame++)
    pixels.set(frame % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], frame * 4);
  return sharp(pixels, {
    raw: { width: 1, height: frames, channels: 4, pageHeight: 1 },
  })
    .toFormat(format, { delay: Array.from({ length: frames }, () => 100) })
    .toBuffer();
}

describe("bounded animation container framing", () => {
  it.each(["gif", "webp"] as const)(
    "rejects every incomplete prefix of an actual two-frame %s",
    async (format) => {
      const bytes = await encoded(format, 2);
      expect(countRitualImageFrames(bytes, `image/${format}`)).toBe(2);
      for (let end = 0; end < bytes.length; end++)
        expect(
          () =>
            countRitualImageFrames(bytes.subarray(0, end), `image/${format}`),
          `truncated length ${end}`,
        ).toThrow(RitualUploadError);
    },
  );
  it.each(["gif", "webp"] as const)(
    "rejects an actual %s with 257 alternating frames before decoding",
    async (format) => {
      const bytes = await encoded(format, 257);
      expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(
        257,
      );
      await expect(
        createSharpRitualImageValidator().validate(
          bytes,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "IMAGE_LIMIT" });
    },
  );
  it("rejects GIFs with no image records or an unknown top-level block", () => {
    const header = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "binary");
    for (const tail of [[0x3b], [0x11, 0x3b], [0x2c, 0x00]])
      expect(() =>
        countRitualImageFrames(
          Buffer.concat([header, Buffer.from(tail)]),
          "image/gif",
        ),
      ).toThrow(RitualUploadError);
  });
  it("rejects a WebP animation whose outer animation flag contradicts its frame chunks", async () => {
    const bytes = await encoded("webp", 2);
    expect(bytes.subarray(12, 16).toString()).toBe("VP8X");
    bytes[20] &= ~2;
    expect(() => countRitualImageFrames(bytes, "image/webp")).toThrow(
      RitualUploadError,
    );
  });
  it("rejects WebP chunk lengths that exceed their declared container", async () => {
    const bytes = await encoded("webp", 2);
    bytes.writeUInt32LE(0xffffffff, 16);
    expect(() => countRitualImageFrames(bytes, "image/webp")).toThrow(
      RitualUploadError,
    );
  });
});
