import "server-only";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { countRitualImageFrames } from "./ritualImageFrames";
import type {
  RitualImageValidator,
  ValidatedRitualImage,
} from "./ritualUploadContracts";
import {
  isRitualImageType,
  RITUAL_IMAGE_LIMITS,
  RITUAL_UPLOAD_MAX_BYTES,
  RitualUploadError,
} from "./ritualUploadProtocol";

/** Finite limits apply to all decoded frames together; callers may only tighten defaults. */
export interface RitualImageLimits {
  maxDimension: number;
  maxPixels: number;
  maxFrames: number;
  decodeSeconds: number;
}
/**
 * Fully decodes every supported frame into bounded temporary RGBA pixels. The
 * original compressed bytes are never changed or replaced by the decoded buffer.
 * APNG is rejected because this Sharp build does not validate all APNG frames.
 */
export function createSharpRitualImageValidator(
  limits: RitualImageLimits = RITUAL_IMAGE_LIMITS,
): RitualImageValidator {
  // Configuration can outlive its caller; retain the limits we actually validate.
  limits = { ...limits };
  for (const key of Object.keys(
    RITUAL_IMAGE_LIMITS,
  ) as (keyof RitualImageLimits)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > RITUAL_IMAGE_LIMITS[key]
    )
      throw new Error("Invalid image validation limits");
  }
  return {
    async validate(bytes, signal): Promise<ValidatedRitualImage> {
      if (signal.aborted) throw new RitualUploadError("ABORTED");
      if (bytes.byteLength < 1 || bytes.byteLength > RITUAL_UPLOAD_MAX_BYTES)
        throw new RitualUploadError("TOO_LARGE");
      let pipeline: ReturnType<typeof sharp> | undefined;
      const abort = () => pipeline?.destroy();
      signal.addEventListener("abort", abort, { once: true });
      try {
        // This additional detector distinguishes animated PNG before Sharp can
        // accidentally validate its first frame as an ordinary static PNG.
        const type = await fileTypeFromBuffer(bytes);
        if (type?.mime === "image/apng")
          throw new RitualUploadError("UNSUPPORTED_ANIMATION");
        if (!type || !isRitualImageType(type.mime))
          throw new RitualUploadError("UNSUPPORTED_TYPE");
        const containerFrames = countRitualImageFrames(bytes, type.mime);
        if (signal.aborted) throw new RitualUploadError("ABORTED");
        pipeline = sharp(bytes, {
          animated: true,
          failOn: "warning",
          limitInputPixels: limits.maxPixels,
          limitInputChannels: 5,
        }).timeout({ seconds: limits.decodeSeconds });
        const metadata = await pipeline.metadata();
        const frames = metadata.pages ?? 1;
        if (frames !== containerFrames)
          throw new RitualUploadError("INVALID_IMAGE");
        const width = metadata.width ?? 0;
        const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
        const decodedPixels = width * frameHeight * frames;
        if (
          ![width, frameHeight, frames, decodedPixels].every(
            (value) => Number.isSafeInteger(value) && value > 0,
          ) ||
          width > limits.maxDimension ||
          frameHeight > limits.maxDimension ||
          frames > limits.maxFrames ||
          decodedPixels > limits.maxPixels
        )
          throw new RitualUploadError("IMAGE_LIMIT");
        if (signal.aborted) throw new RitualUploadError("ABORTED");
        // Stats does not use Sharp's pipeline timeout. A raw all-pages pipeline
        // actually visits the accepted pixels and honors the native decode deadline.
        const decoded = await pipeline
          .toColourspace("srgb")
          .ensureAlpha()
          .raw({ depth: "uchar" })
          .toBuffer({ resolveWithObject: true });
        if (signal.aborted) throw new RitualUploadError("ABORTED");
        if (
          decoded.info.width !== width ||
          decoded.info.height !== frameHeight * frames ||
          decoded.info.channels !== 4 ||
          decoded.data.byteLength !== decodedPixels * 4
        )
          throw new RitualUploadError("INVALID_IMAGE");
        return {
          contentType: type.mime,
          width,
          frameHeight,
          frames,
          decodedPixels,
        };
      } catch (error) {
        if (signal.aborted) throw new RitualUploadError("ABORTED");
        if (error instanceof RitualUploadError) throw error;
        if (
          error instanceof Error &&
          /pixel limit|exceeds pixel/i.test(error.message)
        )
          throw new RitualUploadError("IMAGE_LIMIT");
        if (error instanceof Error && /timeout/i.test(error.message))
          throw new RitualUploadError("TIMEOUT");
        throw new RitualUploadError("INVALID_IMAGE");
      } finally {
        signal.removeEventListener("abort", abort);
        pipeline?.destroy();
      }
    },
  };
}
