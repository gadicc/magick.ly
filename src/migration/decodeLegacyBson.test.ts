import { createHash } from "node:crypto";
import {
  Binary,
  BSONRegExp,
  Code,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  serialize,
} from "bson";
import { describe, expect, it } from "vitest";
import { legacyImportFixture } from "../../tests/legacyImportFixtures";
import {
  decodeLegacyBson as decode,
  LegacyBsonDecodeError,
  LEGACY_BSON_LIMITS as limits,
} from "./decodeLegacyBson";
import {
  createLegacyImportCheckpoint,
  readLegacyImportCheckpoint,
} from "./legacyImportCheckpoint";
import { prepareLegacyImport } from "./prepareLegacyImport";

const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function rejected(input: Uint8Array) {
  try {
    decode(input);
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyBsonDecodeError);
    expect((error as Error).message).toBe("INVALID_LEGACY_BSON");
    expect(Reflect.ownKeys(error as object).sort()).toEqual([
      "message",
      "name",
      "stack",
    ]);
  }
}
describe("verified native BSON source projection", () => {
  it("reads intrinsic view bounds and refuses shared memory despite shadowed properties", () => {
    const frame = serialize({ value: "safe" });
    Object.defineProperties(frame, {
      byteLength: { value: 0 },
      byteOffset: { value: 99 },
      buffer: { value: new ArrayBuffer(0) },
      [Symbol.iterator]: {
        value: () => {
          throw new Error("private");
        },
      },
    });
    expect(decode(frame).rows).toEqual([{ value: "safe" }]);
    const shared = new Uint8Array(new SharedArrayBuffer(5));
    Object.defineProperty(shared, "buffer", { value: new ArrayBuffer(5) });
    rejected(shared);
  });
  it("preserves exact bytes/types before projecting safe numeric values", () => {
    const id = new ObjectId("000000000000000000000001");
    const values = {
      id,
      text: "\uFEFF e\u0301😀\r\n",
      bool: false,
      nil: null,
      date: new Date("2020-01-01T00:00:00.123Z"),
      int: new Int32(7),
      double: new Double(7),
      long: Long.fromNumber(Number.MAX_SAFE_INTEGER),
      nested: [{ value: new Double(-0) }, [true, "literal"]],
    };
    const bytes = serialize(values),
      before = Buffer.from(bytes);
    const result = decode(bytes);
    expect(bytes).toEqual(before);
    expect(result.bytes).toBe(bytes.length);
    expect(result.sha256).toBe(hash(bytes));
    expect(result.frames).toEqual([
      {
        index: 0,
        bytes: bytes.length,
        sha256: hash(bytes),
        typeProfileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    expect(result.rows[0]).toEqual({
      ...values,
      int: 7,
      double: 7,
      long: Number.MAX_SAFE_INTEGER,
      nested: [{ value: -0 }, [true, "literal"]],
    });
    bytes.fill(0);
    expect((result.rows[0].id as ObjectId).toHexString()).toBe(
      id.toHexString(),
    );
    expect((result.rows[0].date as Date).getTime()).toBe(values.date.getTime());
  });
  it("distinguishes wire numeric types that produce equal native values", () => {
    const cases = [new Int32(7), new Double(7), Long.fromNumber(7)].map(
      (value) => decode(serialize({ value })),
    );
    expect(cases.every((v) => v.rows[0].value === 7)).toBe(true);
    expect(new Set(cases.map((v) => v.frames[0].sha256)).size).toBe(3);
    expect(new Set(cases.map((v) => v.frames[0].typeProfileSha256)).size).toBe(
      3,
    );
    expect(
      decode(serialize({ value: new Int32(8) })).frames[0].typeProfileSha256,
    ).toBe(cases[0].frames[0].typeProfileSha256);
  });
  it("preserves collection frame order and source identifier types", () => {
    const id = new ObjectId("000000000000000000000001");
    const first = serialize({ _id: id }),
      second = serialize({ _id: id.toHexString() });
    const result = decode(Buffer.concat([first, second]));
    expect(result.frames.map((f) => f.index)).toEqual([0, 1]);
    expect(result.frames.map((f) => f.bytes)).toEqual([
      first.length,
      second.length,
    ]);
    expect(result.rows[0]._id).toBeInstanceOf(ObjectId);
    expect(result.rows[1]._id).toBe(id.toHexString());
  });
  it("accepts the exact byteOffset view, an empty collection, and safe negative Long", () => {
    const frame = serialize({ v: Long.fromNumber(-Number.MAX_SAFE_INTEGER) });
    const storage = Buffer.concat([
      Buffer.from([99]),
      frame,
      Buffer.from([99]),
    ]);
    expect(decode(storage.subarray(1, -1)).rows).toEqual([
      { v: -Number.MAX_SAFE_INTEGER },
    ]);
    expect(decode(new Uint8Array()).rows).toEqual([]);
    expect(decode(new Uint8Array()).frames).toEqual([]);
  });
  it.each([new Double(NaN), new Double(Infinity), new Double(-Infinity)])(
    "keeps exact double values for domain-specific validation %#",
    (value) => {
      expect(
        Object.is(decode(serialize({ value })).rows[0].value, value.value),
      ).toBe(true);
    },
  );
  it.each([
    new Binary(Buffer.from("private")),
    new BSONRegExp("private"),
    new Code("private"),
    Decimal128.fromString("7.1"),
    new MinKey(),
    new MaxKey(),
    Long.fromString("9007199254740992"),
    Long.fromString("-9007199254740992"),
  ])("refuses unsupported or lossy source type %#", (value) => {
    rejected(serialize({ privateName: value }));
  });
  it.each([
    Buffer.from([1]),
    Buffer.from([1, 2, 3]),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([4, 0, 0, 0, 0]),
    Buffer.from([9, 0, 0, 0, 0]),
    Buffer.from([5, 0, 0, 0, 1]),
  ])("refuses malformed frame boundaries %#", rejected);
  it("rejects trailing bytes, invalid tag and invalid UTF8 without leaking BSON diagnostics", () => {
    const frame = serialize({ secretFieldName: "private" });
    rejected(Buffer.concat([frame, Buffer.from([1])]));
    const type = Buffer.from(frame);
    type[4] = 0x7a;
    rejected(type);
    const utf = Buffer.from(frame);
    utf[5] = 0xff;
    rejected(utf);
  });
  it("rejects a duplicate field before native projection can overwrite it", () => {
    const frame = Buffer.from(serialize({ a: 1, b: 2 }));
    const index = frame.indexOf(Buffer.from([0x10, 0x62, 0]));
    expect(index).toBeGreaterThan(0);
    frame[index + 1] = 0x61;
    rejected(frame);
  });
  it("rejects noncanonical array indices rather than normalizing source bytes", () => {
    const frame = Buffer.from(serialize({ a: [1, 2] }));
    const index = frame.indexOf(Buffer.from([0x10, 0x31, 0]));
    expect(index).toBeGreaterThan(0);
    frame[index + 1] = 0x32;
    rejected(frame);
  });
  it("enforces logical depth before accepting a decoded record", () => {
    let value: unknown = null;
    for (let n = 0; n < limits.depth; n++) value = { v: value };
    expect(
      decode(serialize(value as Record<string, unknown>)).rows,
    ).toHaveLength(1);
    rejected(serialize({ v: value }));
  });
  it("enforces row count even for tiny valid frames", () => {
    rejected(
      Buffer.concat(
        Array.from({ length: limits.rows + 1 }, () =>
          Buffer.from([5, 0, 0, 0, 0]),
        ),
      ),
    );
  });
  it("enforces declared maximum BSON frame length", () => {
    const header = Buffer.alloc(5);
    header.writeInt32LE(limits.frameBytes + 1);
    rejected(header);
  });
  it("rejects unsupported input containers and shared memory", () => {
    for (const input of [
      null,
      [],
      "private",
      new DataView(new ArrayBuffer(5)),
      new Uint8Array(new SharedArrayBuffer(5)),
    ])
      rejected(input as never);
  });
  it("joins the actual full-domain builder and checkpoint with no wire/type drift", () => {
    const f = legacyImportFixture();
    const decoded = Object.fromEntries(
      Object.entries(f.input).map(([key, rows]) => [
        key,
        decode(
          Buffer.concat(
            rows.map((row) => serialize(row as Record<string, unknown>)),
          ),
        ).rows,
      ]),
    );
    const plan = prepareLegacyImport(
      decoded as unknown as typeof f.input,
      f.options,
    );
    const b = {
      runId: "01993000-0000-7000-8000-00000000aaaa",
      sourceManifestSha256: "a".repeat(64),
      sourceDescriptorSha256: "b".repeat(64),
      schemaSha256: "c".repeat(64),
      targetSha256: "d".repeat(64),
    };
    const saved = createLegacyImportCheckpoint(plan, b);
    expect(readLegacyImportCheckpoint(saved, b)).toEqual(plan);
    expect(plan.study.snapshots).toHaveLength(3);
    expect(plan.discourse.links[0].discourseUserId).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
