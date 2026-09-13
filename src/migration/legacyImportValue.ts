/**
 * Protected import checkpoints contain Dates and exact JSON metadata. This wire
 * format tags every container, so literal tag-looking arrays/objects remain data
 * and arbitrary metadata keys never become paths or object prototypes. It has
 * no custom class revival, references, environment access or global registry.
 */
export const LEGACY_IMPORT_VALUE_PROFILE = "magickli-import-value-v1";
export const LEGACY_IMPORT_VALUE_LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  nodes: 1_000_000,
  depth: 256,
});

/** Category only: checkpoint values can contain private source or invite codes. */
export class LegacyImportValueError extends Error {
  constructor() {
    super("INVALID_IMPORT_VALUE");
    this.name = "LegacyImportValueError";
  }
}

type Scalar = null | boolean | string | number;
type Wire =
  | Scalar
  | ["date", string]
  | ["array", Wire[]]
  | ["object", [string, Wire][]];

function invalid(): never {
  throw new LegacyImportValueError();
}

function quotedBytes(value: string): number {
  if (!value.isWellFormed()) invalid();
  let bytes = Buffer.byteLength(value, "utf8") + 2;
  if (bytes > LEGACY_IMPORT_VALUE_LIMITS.bytes) invalid();
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes++;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
    if (bytes > LEGACY_IMPORT_VALUE_LIMITS.bytes) invalid();
  }
  return bytes;
}

/** Reject oversized structural input before JSON.parse allocates its containers. */
function scan(serialized: string) {
  let depth = 0;
  let tokens = 0;
  let quoted = false;
  let escaped = false;
  let primitive = false;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    if (quoted) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) quoted = false;
      continue;
    }
    if (code === 34) {
      quoted = true;
      primitive = false;
      tokens++;
    } else if (code === 91) {
      depth++;
      primitive = false;
      tokens++;
    } else if (code === 93) {
      depth--;
      primitive = false;
    } else if ([9, 10, 13, 32, 44].includes(code)) primitive = false;
    else {
      // This format uses arrays even for objects. Braces/colons outside a
      // string are never valid, and must not create arbitrary JSON objects.
      if ([58, 123, 125].includes(code)) invalid();
      if (!primitive) tokens++;
      primitive = true;
    }
    // One logical object level needs at most three wire arrays. Keys and
    // tags need at most four tokens per value; leave room for the envelope.
    if (
      depth < 0 ||
      depth > LEGACY_IMPORT_VALUE_LIMITS.depth * 3 + 8 ||
      tokens > LEGACY_IMPORT_VALUE_LIMITS.nodes * 4 + 8
    )
      invalid();
  }
}

/** No getters or non-enumerable/symbol state may silently disappear. */
function entries(value: object, array: boolean): [string, unknown][] {
  if (Object.getOwnPropertySymbols(value).length) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array) {
    const length = descriptors.length;
    if (!length || !("value" in length)) invalid();
    delete descriptors.length;
    const keys = Object.keys(descriptors);
    if (
      length.value > LEGACY_IMPORT_VALUE_LIMITS.nodes ||
      keys.length !== length.value ||
      keys.some((key, index) => key !== String(index))
    )
      invalid();
  }
  return Object.entries(descriptors).map(([key, descriptor]) => {
    if (!descriptor.enumerable || !("value" in descriptor)) invalid();
    if (!key.isWellFormed()) invalid();
    return [key, descriptor.value];
  });
}

/**
 * Canonical, bounded serialization of an already reviewed import projection.
 * This is a value codec, not validation of its source, grants or table rows.
 * Shared references are copied by value; cycles and lossy values are rejected.
 */
export function serializeLegacyImportValue(value: unknown): string {
  try {
    let nodes = 0;
    let wireBytes = 0;
    const ancestors = new Set<object>();
    function charge(bytes: number) {
      wireBytes += bytes;
      if (wireBytes > LEGACY_IMPORT_VALUE_LIMITS.bytes) invalid();
    }
    function text(value: string) {
      charge(quotedBytes(value));
      return value;
    }
    function encode(item: unknown, depth: number): Wire {
      if (
        ++nodes > LEGACY_IMPORT_VALUE_LIMITS.nodes ||
        depth > LEGACY_IMPORT_VALUE_LIMITS.depth
      )
        invalid();
      if (item === null || typeof item === "boolean") {
        charge(item === false ? 5 : 4);
        return item;
      }
      if (typeof item === "string") return text(item);
      if (typeof item === "number") {
        if (!Number.isFinite(item) || Object.is(item, -0)) invalid();
        charge(String(item).length);
        return item;
      }
      if (typeof item !== "object" || ancestors.has(item)) invalid();
      if (Object.getPrototypeOf(item) === Date.prototype) {
        if (
          !Number.isFinite(Date.prototype.getTime.call(item)) ||
          Reflect.ownKeys(item).length
        )
          invalid();
        charge(9);
        return ["date", text(Date.prototype.toISOString.call(item))];
      }
      const array = Array.isArray(item);
      if (
        Object.getPrototypeOf(item) !==
        (array ? Array.prototype : Object.prototype)
      )
        invalid();
      ancestors.add(item);
      const fields = entries(item, array);
      charge((array ? 12 : 13) + Math.max(0, fields.length - 1));
      const result: Wire = array
        ? ["array", fields.map(([, entry]) => encode(entry, depth + 1))]
        : [
            "object",
            fields.map(([key, entry]) => {
              charge(3);
              return [text(key), encode(entry, depth + 1)];
            }),
          ];
      ancestors.delete(item);
      return result;
    }
    charge(3 + quotedBytes(LEGACY_IMPORT_VALUE_PROFILE));
    const serialized = JSON.stringify([
      LEGACY_IMPORT_VALUE_PROFILE,
      encode(value, 0),
    ]);
    if (Buffer.byteLength(serialized, "utf8") !== wireBytes) invalid();
    return serialized;
  } catch {
    return invalid();
  }
}

/**
 * Decode only this exact canonical format, producing fresh owned values. The
 * caller must first verify its checkpoint digest and expected run binding.
 */
export function parseLegacyImportValue(serialized: string): unknown {
  try {
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized, "utf8") > LEGACY_IMPORT_VALUE_LIMITS.bytes
    )
      invalid();
    scan(serialized);
    const envelope: unknown = JSON.parse(serialized);
    if (
      !Array.isArray(envelope) ||
      envelope.length !== 2 ||
      envelope[0] !== LEGACY_IMPORT_VALUE_PROFILE
    )
      invalid();
    let nodes = 0;
    function decode(item: unknown, depth: number): unknown {
      if (
        ++nodes > LEGACY_IMPORT_VALUE_LIMITS.nodes ||
        depth > LEGACY_IMPORT_VALUE_LIMITS.depth
      )
        invalid();
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "string") {
        if (!item.isWellFormed()) invalid();
        return item;
      }
      if (typeof item === "number") {
        if (!Number.isFinite(item) || Object.is(item, -0)) invalid();
        return item;
      }
      if (!Array.isArray(item) || item.length !== 2) invalid();
      const [kind, content] = item;
      if (kind === "date") {
        if (typeof content !== "string") invalid();
        const date = new Date(content);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== content)
          invalid();
        return date;
      }
      if (!Array.isArray(content)) invalid();
      if (kind === "array")
        return content.map((entry) => decode(entry, depth + 1));
      if (kind !== "object") invalid();
      const value: Record<string, unknown> = {};
      for (const pair of content) {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== "string" ||
          !pair[0].isWellFormed() ||
          Object.hasOwn(value, pair[0])
        )
          invalid();
        Object.defineProperty(value, pair[0], {
          value: decode(pair[1], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return value;
    }
    const value = decode(envelope[1], 0);
    // Reject ignored fields, duplicate JSON members, alternate number/date
    // spellings and key ordering that would change on the next checkpoint save.
    if (serializeLegacyImportValue(value) !== serialized) invalid();
    return value;
  } catch {
    return invalid();
  }
}
