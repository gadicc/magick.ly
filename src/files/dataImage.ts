/** Transport limits for inline images; callers may only tighten these caps. */
export const DATA_IMAGE_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxReferenceBytes: 1024 * 1024,
});

export type DataImageErrorCode =
  | "INVALID_LIMITS"
  | "INVALID_REFERENCE"
  | "REFERENCE_LIMIT"
  | "FRAGMENT_NOT_SEPARATED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "MALFORMED_PERCENT_ENCODING"
  | "INVALID_BASE64"
  | "EMPTY_DATA"
  | "BYTE_LIMIT";

/** Safe to report without disclosing the inline image or its surrounding source. */
export class DataImageError extends Error {
  constructor(readonly code: DataImageErrorCode) {
    super(code);
    this.name = "DataImageError";
  }
}

/** A transport declaration, not a verified image type or permission to display it. */
export type DataImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml";

function hex(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function whitespace(byte: number): boolean {
  return byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function base64Value(byte: number): number {
  if (byte >= 65 && byte <= 90) return byte - 65;
  if (byte >= 97 && byte <= 122) return byte - 71;
  if (byte >= 48 && byte <= 57) return byte + 4;
  if (byte === 43) return 62;
  if (byte === 47) return 63;
  return -1;
}

// Two bounded passes avoid allocating a decoded body before checking its size.
// Decode percent escapes as bytes: decodeURIComponent would reject binary %FF.
function visitBody(
  reference: string,
  start: number,
  base64: boolean,
  visit: (byte: number) => void,
): void {
  for (let i = start; i < reference.length; i++) {
    let byte = reference.charCodeAt(i);
    if (byte === 37) {
      const high = hex(reference.charCodeAt(i + 1));
      const low = hex(reference.charCodeAt(i + 2));
      if (high < 0 || low < 0)
        throw new DataImageError("MALFORMED_PERCENT_ENCODING");
      byte = high * 16 + low;
      i += 2;
    } else if (byte >= 127 || (byte <= 32 && !(base64 && whitespace(byte)))) {
      // Require escaped Unicode/whitespace instead of silently applying URL
      // parser trimming, control-character removal or replacement characters.
      throw new DataImageError("INVALID_REFERENCE");
    }
    visit(byte);
  }
}

/**
 * Decode a bounded, fragment-free inline image into owned original bytes.
 * Accepts explicit image MIME types, optional SVG charset=utf-8, and base64 or
 * percent-byte bodies. Raw Unicode and raw non-base64 whitespace must be escaped.
 * Callers retain the original reference and separate its display fragment first.
 *
 * Percent decoding precedes WHATWG forgiving-base64 decoding (ASCII whitespace,
 * optional padding and discarded unused bits). Malformed escapes, junk and
 * malformed padding fail explicitly. This narrower header/URL profile performs
 * no MIME sniffing, SVG validation, authorization or asset-completeness check.
 */
export function decodeDataImage(
  reference: string,
  options: Partial<typeof DATA_IMAGE_LIMITS> = {},
): { declaredMime: DataImageMime; bytes: Uint8Array } {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some(
      (key) => key !== "maxBytes" && key !== "maxReferenceBytes",
    )
  )
    throw new DataImageError("INVALID_LIMITS");
  const limits = { ...DATA_IMAGE_LIMITS, ...options };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > DATA_IMAGE_LIMITS[key]
    )
      throw new DataImageError("INVALID_LIMITS");
  }
  if (typeof reference !== "string")
    throw new DataImageError("INVALID_REFERENCE");
  // Accepted references are ASCII, so their string length is their byte length.
  if (reference.length > limits.maxReferenceBytes)
    throw new DataImageError("REFERENCE_LIMIT");
  if (reference.includes("#"))
    throw new DataImageError("FRAGMENT_NOT_SEPARATED");
  const header =
    /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))(;charset=utf-8)?(;base64)?,/i.exec(
      reference,
    );
  if (!header || (header[2] && header[1].toLowerCase() !== "image/svg+xml"))
    throw new DataImageError("UNSUPPORTED_MEDIA_TYPE");
  const base64 = Boolean(header[3]);
  const start = header[0].length;
  let digits = 0;
  let padding = 0;
  let size = 0;
  visitBody(reference, start, base64, (byte) => {
    if (!base64) size++;
    else if (whitespace(byte)) return;
    else if (byte === 61) {
      if (++padding > 2) throw new DataImageError("INVALID_BASE64");
    } else {
      if (padding || base64Value(byte) < 0)
        throw new DataImageError("INVALID_BASE64");
      size = Math.floor((++digits * 6) / 8);
    }
    if (size > limits.maxBytes) throw new DataImageError("BYTE_LIMIT");
  });
  if (base64 && (digits % 4 === 1 || (padding && (digits + padding) % 4)))
    throw new DataImageError("INVALID_BASE64");
  if (!size) throw new DataImageError("EMPTY_DATA");

  const bytes = new Uint8Array(size);
  let offset = 0;
  let buffer = 0;
  let bits = 0;
  visitBody(reference, start, base64, (byte) => {
    if (!base64) bytes[offset++] = byte;
    else if (byte !== 61 && !whitespace(byte)) {
      buffer = (buffer << 6) | base64Value(byte);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[offset++] = (buffer >> bits) & 255;
        buffer &= (1 << bits) - 1;
      }
    }
  });
  return { declaredMime: header[1].toLowerCase() as DataImageMime, bytes };
}
