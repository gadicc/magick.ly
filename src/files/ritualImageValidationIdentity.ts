import "server-only";
import { sha256Hex } from "@gadicc/loom/files/hash";
import sharp from "sharp";
import { DATA_IMAGE_LIMITS } from "./dataImage";
import {
  RITUAL_IMAGE_LIMITS,
  RITUAL_UPLOAD_MAX_BYTES,
} from "./ritualUploadProtocol";
import { RITUAL_SVG_LIMITS, RITUAL_SVG_PROFILE } from "./validateRitualSvg";

/** Changes require a new validation identity; regression tests bind the actual installed implementation. */
export const STATIC_RASTER_VALIDATION_COMPONENTS = Object.freeze({
  validateRitualImageSha256:
    "6d8f1da45ed0293b6e5d9c1f058f63fe7f017d07704135bb00e407ae4c2abb49",
  ritualImageFramesSha256:
    "629fb0130e13e5a9eba479d01ccfbd368f883d767c3731d62b6842d83bd627e0",
  ritualUploadProtocolSha256:
    "d8a8ebc12df7638de1e62f89b47ed642f1424797e28ea8438cd93d75f23c9a4a",
  sharp: "0.35.4",
  "file-type": "19.0.0",
});
/** Added SVG/parser semantics are independently pinned alongside the unchanged raster contract. */
export const STATIC_SVG_VALIDATION_COMPONENTS = Object.freeze({
  validateRitualSvgSha256:
    "4ebcd8a6648145b2d9098c626d2abe23fd027099a00ec4cb578f6d2ddb01989f",
  dataImageSha256:
    "1d8273b4d29bb8e00c8a5c716f7fd2759ed938082231f3eddba66c98f65a1e60",
  "css-tree": "3.2.1",
  "mdn-data": "2.27.1",
  "source-map-js": "1.2.1",
  saxes: "6.0.0",
  xmlchars: "2.2.0",
});
/** Identical validator semantics bind static, legacy and inline capture evidence. */
export async function getRitualImageValidationSha256(): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify([
        STATIC_RASTER_VALIDATION_COMPONENTS,
        STATIC_SVG_VALIDATION_COMPONENTS,
        RITUAL_SVG_PROFILE,
        RITUAL_SVG_LIMITS,
        DATA_IMAGE_LIMITS,
        RITUAL_IMAGE_LIMITS,
        RITUAL_UPLOAD_MAX_BYTES,
        Object.entries(sharp.versions).sort(([a], [b]) => (a < b ? -1 : 1)),
      ]),
    ),
  );
}
