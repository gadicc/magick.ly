import { createHash } from "node:crypto";
import { Double, deserialize, Int32, Long, ObjectId, serialize } from "bson";

/** Closed source profile verified against the protected 190-document backup. */
export const LEGACY_BSON_PROFILE = "magickli-native-bson-projection-v1";
export const LEGACY_BSON_LIMITS = Object.freeze({
  bytes: 256 * 1024 * 1024,
  frameBytes: 16 * 1024 * 1024,
  rows: 100_000,
  nodes: 1_000_000,
  depth: 256,
});

/** Wire evidence contains no source identifiers, field names or field values. */
export interface LegacyBsonFrameEvidence {
  index: number;
  bytes: number;
  sha256: string;
  typeProfileSha256: string;
}

/** Decoded source is transient private input, never a public or log projection. */
export interface DecodedLegacyBson {
  profile: typeof LEGACY_BSON_PROFILE;
  sha256: string;
  bytes: number;
  rows: Record<string, unknown>[];
  frames: LegacyBsonFrameEvidence[];
}

/** BSON errors can contain source names/values; only a fixed category escapes. */
export class LegacyBsonDecodeError extends Error {
  constructor() {
    super("INVALID_LEGACY_BSON");
    this.name = "LegacyBsonDecodeError";
  }
}
function invalid(): never {
  throw new LegacyBsonDecodeError();
}
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const typedArrayProperties = Object.getOwnPropertyDescriptors(
  Object.getPrototypeOf(Uint8Array.prototype),
);

/**
 * Decode an already bounded inflated collection, preserving frame/type hashes
 * before the reviewed native-scalar projection. The file/manifest loader owns
 * provenance and gzip limits. This function performs no I/O or ID allocation.
 * Duplicate fields, noncanonical wire shapes and unsupported BSON types fail.
 */
export function decodeLegacyBson(input: Uint8Array): DecodedLegacyBson {
  let owned: Buffer | undefined;
  try {
    if (!(input instanceof Uint8Array)) invalid();
    // Read the actual view, not shadowable own properties or a custom iterator.
    const buffer = typedArrayProperties.buffer.get!.call(input) as ArrayBuffer;
    const byteLength = typedArrayProperties.byteLength.get!.call(
      input,
    ) as number;
    const byteOffset = typedArrayProperties.byteOffset.get!.call(
      input,
    ) as number;
    if (
      !(buffer instanceof ArrayBuffer) ||
      byteLength > LEGACY_BSON_LIMITS.bytes
    )
      invalid();
    owned = Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
    const result: DecodedLegacyBson = {
      profile: LEGACY_BSON_PROFILE,
      sha256: hash(owned),
      bytes: owned.length,
      rows: [],
      frames: [],
    };
    let nodes = 0;
    for (let offset = 0; offset < owned.length; ) {
      if (
        result.rows.length >= LEGACY_BSON_LIMITS.rows ||
        offset + 4 > owned.length
      )
        invalid();
      const bytes = owned.readInt32LE(offset);
      if (
        bytes < 5 ||
        bytes > LEGACY_BSON_LIMITS.frameBytes ||
        offset + bytes > owned.length ||
        owned[offset + bytes - 1] !== 0
      )
        invalid();
      const frame = owned.subarray(offset, offset + bytes);
      const typed = deserialize(frame, {
        promoteValues: false,
        promoteLongs: false,
        bsonRegExp: true,
        validation: { utf8: true },
      });
      const types = createHash("sha256");
      function visit(value: unknown, path: (string | number)[], depth: number) {
        if (
          ++nodes > LEGACY_BSON_LIMITS.nodes ||
          depth > LEGACY_BSON_LIMITS.depth
        )
          invalid();
        let kind: string;
        if (value === null) kind = "null";
        else if (typeof value === "boolean" || typeof value === "string")
          kind = typeof value;
        else if (value instanceof Int32) kind = "int32";
        else if (value instanceof Double) kind = "double";
        else if (value instanceof Long) {
          const integer = value.toBigInt();
          if (
            integer < BigInt(-Number.MAX_SAFE_INTEGER) ||
            integer > BigInt(Number.MAX_SAFE_INTEGER)
          )
            invalid();
          kind = "int64-safe";
        } else if (value instanceof ObjectId) kind = "objectid";
        else if (value instanceof Date) {
          if (!Number.isFinite(value.getTime())) invalid();
          kind = "date";
        } else if (Array.isArray(value)) kind = "array";
        else if (
          value &&
          typeof value === "object" &&
          Object.getPrototypeOf(value) === Object.prototype
        )
          kind = "object";
        else invalid();
        types.update(JSON.stringify([path, kind]));
        if (kind === "array")
          (value as unknown[]).forEach((entry, index) =>
            visit(entry, [...path, index], depth + 1),
          );
        else if (kind === "object")
          for (const [key, entry] of Object.entries(value as object))
            visit(entry, [...path, key], depth + 1);
      }
      visit(typed, [], 0);
      // Typed decode/re-encode must preserve every byte before any numeric
      // promotion. This refuses duplicate keys and normalized array indices.
      const repeated = serialize(typed);
      try {
        if (!frame.equals(repeated)) invalid();
      } finally {
        repeated.fill(0);
      }
      const row = deserialize(frame, {
        promoteValues: true,
        promoteLongs: true,
        validation: { utf8: true },
      });
      result.frames.push({
        index: result.rows.length,
        bytes,
        sha256: hash(frame),
        typeProfileSha256: types.digest("hex"),
      });
      result.rows.push(row);
      offset += bytes;
    }
    return result;
  } catch {
    return invalid();
  } finally {
    owned?.fill(0);
  }
}
