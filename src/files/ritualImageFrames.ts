import {
  RITUAL_IMAGE_LIMITS,
  type RitualImageType,
  RitualUploadError,
} from "./ritualUploadProtocol";

/**
 * Bounded container framing only. Sharp still decodes all compressed pixel data.
 * This catches truncated tails which a decoder may silently expose as fewer frames.
 */
export function countRitualImageFrames(
  bytes: Uint8Array,
  type: RitualImageType,
): number {
  const invalid = (): never => {
    throw new RitualUploadError("INVALID_IMAGE");
  };
  const more = (count: number) => {
    if (count > RITUAL_IMAGE_LIMITS.maxFrames)
      throw new RitualUploadError("IMAGE_LIMIT");
    return count;
  };
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (type === "image/gif") {
    if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(0, 6)))
      invalid();
    let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
    let frames = 0;
    function blocks() {
      while (true) {
        if (offset >= bytes.length) invalid();
        const size = bytes[offset++];
        if (size === 0) return;
        if (offset + size > bytes.length) invalid();
        offset += size;
      }
    }
    while (offset < bytes.length) {
      const block = bytes[offset++];
      if (block === 0x3b) {
        if (offset !== bytes.length || frames === 0) invalid();
        return frames;
      }
      if (block === 0x21) {
        if (offset >= bytes.length) invalid();
        const label = bytes[offset++];
        // Plain Text extensions have rendering semantics Sharp doesn't expose as
        // validated image frames. Do not certify them through this image-only API.
        if (![0xf9, 0xfe, 0xff].includes(label)) invalid();
        blocks();
      } else if (block === 0x2c) {
        if (offset + 9 > bytes.length) invalid();
        const packed = bytes[offset + 8];
        offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
        if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8)
          invalid();
        offset++;
        blocks();
        frames = more(frames + 1);
      } else invalid();
    }
    return invalid();
  }
  if (type === "image/webp") {
    if (bytes.length < 20 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP")
      invalid();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12,
      frames = 0,
      still = false,
      animated = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) invalid();
      const chunk = ascii(offset, 4),
        size = view.getUint32(offset + 4, true);
      if (offset + 8 + size + (size % 2) > bytes.length) invalid();
      if (chunk === "ANMF") {
        if (size < 16) invalid();
        frames = more(frames + 1);
      }
      if (chunk === "VP8 " || chunk === "VP8L") still = true;
      if (chunk === "VP8X") {
        if (size !== 10) invalid();
        animated = (bytes[offset + 8] & 2) !== 0;
      }
      offset += 8 + size + (size % 2);
    }
    if (animated ? frames < 1 || still : frames > 0 || !still) invalid();
    return animated ? frames : 1;
  }
  return 1;
}
