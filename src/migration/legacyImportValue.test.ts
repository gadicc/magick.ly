import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { ObjectId } from "bson";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixture as membershipFixture,
  sourceKey,
} from "../../tests/membershipFixtures";
import { fixture as ritualFixture } from "../../tests/ritualFixtures";
import { fixture as studyFixture } from "../../tests/studyFixtures";
import { createUuidV7 } from "../lib/ids";
import {
  LegacyImportValueError,
  LEGACY_IMPORT_VALUE_LIMITS as limits,
  parseLegacyImportValue as parse,
  LEGACY_IMPORT_VALUE_PROFILE as profile,
  serializeLegacyImportValue as serialize,
} from "./legacyImportValue";
import { normalizeLegacyAuth } from "./normalizeLegacyAuth";
import {
  legacyProviderAlias,
  planBetterAuthImport,
} from "./planBetterAuthImport";
import { planLegacyDiscourseImport } from "./planLegacyDiscourseImport";
import { planLegacyFileImport } from "./planLegacyFileImport";
import { planLegacyMembershipImport } from "./planLegacyMembershipImport";
import { planLegacyRitualImport } from "./planLegacyRitualImport";
import { planLegacyStudyImport } from "./planLegacyStudyImport";

const wire = (value: unknown) => JSON.stringify([profile, value]);
function invalid(work: () => unknown) {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LegacyImportValueError);
  expect((caught as Error).name).toBe("LegacyImportValueError");
  expect((caught as Error).message).toBe("INVALID_IMPORT_VALUE");
  expect(Reflect.ownKeys(caught as object).sort()).toEqual([
    "message",
    "name",
    "stack",
  ]);
  return caught;
}
function roundTrip<T>(value: T): T {
  const serialized = serialize(value),
    restored = parse(serialized);
  // Vitest treats an own constructor property as type identity. Node compares
  // the real prototype and fields, including this valid JSON key.
  expect(isDeepStrictEqual(restored, value)).toBe(true);
  expect(serialize(restored)).toBe(serialized);
  return restored as T;
}
function nested(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index++) value = [value];
  return value;
}
function nestedWire(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index++) value = ["array", [value]];
  return value;
}
afterEach(() => vi.restoreAllMocks());

describe("protected import value codec exact values", () => {
  it.each([
    null,
    true,
    false,
    "",
    0,
    1,
    -1,
    0.1,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])("round-trips exact JSON scalar %#", (value) => {
    roundTrip(value);
  });
  it("preserves every control byte, escape, surrogate pair and exact opaque archive string", () => {
    const text =
      "\uFEFF  \r\n" +
      Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join(
        "",
      ) +
      '\\"雪e\u0301😀\u2028\u2029';
    const value = {
      source: text,
      sourceEjson: '{"key":{"$date":{"$numberLong":"1"}},"__proto__":null}',
      contentJson: '{"children":[], "forMe":true}',
      literal: '["date","2020-01-01T00:00:00.000Z"]',
      dates: [new Date(0), new Date(-1), new Date("2026-09-13T12:34:56.789Z")],
    };
    expect(roundTrip(value)).toStrictEqual(value);
  });
  it.each([
    new Date(-8640000000000000),
    new Date(8640000000000000),
    new Date("0000-01-01T00:00:00.000Z"),
    new Date("+010000-01-01T00:00:00.000Z"),
  ])("round-trips canonical extended Date %#", (value) => {
    expect(roundTrip(value)).not.toBe(value);
  });
  it("keeps tag-looking containers as data and dangerous keys as own values", () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":["date","2020-01-01T00:00:00.000Z"],"toString":"ordinary","hasOwnProperty":false,"":"empty","a.b[0]":"literal","x\\u0000y":2}',
    );
    value.tags = [
      [profile, null],
      ["date", new Date(0)],
      ["array", []],
      ["object", [["a", 1]]],
    ];
    const result = roundTrip(value);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.__proto__)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")).toMatchObject({
      enumerable: true,
      writable: true,
      configurable: true,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it("retains JS own-key order and copies shared input graphs instead of restoring aliases", () => {
    const shared = { at: new Date(0), list: ["same"] },
      input = {
        first: shared,
        second: shared,
        keys: JSON.parse('{"b":1,"2":2,"a":3,"1":4}'),
      };
    Object.freeze(shared.list);
    Object.freeze(shared);
    Object.freeze(input);
    const result = roundTrip(input);
    expect(Object.keys(result.keys)).toEqual(["1", "2", "b", "a"]);
    expect(result.first).not.toBe(result.second);
    expect(result.first.at).not.toBe(result.second.at);
    result.first.at.setTime(100);
    result.first.list.push("changed");
    expect(result.second.at.getTime()).toBe(0);
    expect(result.second.list).toEqual(["same"]);
    expect(shared.at.getTime()).toBe(0);
    expect(shared.list).toEqual(["same"]);
  });
  it("returns independent objects on repeated decode and ignores no post-encode input mutation", () => {
    const input = { nested: { when: new Date(1), value: "original" } },
      json = serialize(input),
      first = parse(json) as typeof input,
      second = parse(json) as typeof input;
    input.nested.when.setTime(9);
    input.nested.value = "changed";
    first.nested.when.setTime(7);
    first.nested.value = "first";
    expect(second).toEqual({
      nested: { when: new Date(1), value: "original" },
    });
    expect(json).toBe(serialize(second));
  });
});

describe("refuse lossy or executable source state", () => {
  const badFactories: [string, () => unknown][] = [
    ["undefined", () => undefined],
    ["function", () => () => null],
    ["symbol", () => Symbol("synthetic")],
    ["bigint", () => BigInt(1)],
    ["NaN", () => NaN],
    ["infinity", () => Infinity],
    ["negative infinity", () => -Infinity],
    ["negative zero", () => -0],
    ["lone high surrogate", () => "\ud800"],
    ["lone low surrogate", () => "\udfff"],
    ["invalid Date", () => new Date(NaN)],
    ["Map", () => new Map([["a", 1]])],
    ["Set", () => new Set([1])],
    ["RegExp", () => /x/],
    ["URL", () => new URL("https://example.invalid")],
    ["Uint8Array", () => new Uint8Array([1])],
    ["Buffer", () => Buffer.from([1])],
    ["boxed number", () => new Number(1)],
    ["boxed string", () => new String("x")],
    [
      "class",
      () =>
        new (class Value {
          a = 1;
        })(),
    ],
    ["Date subclass", () => new (class Value extends Date {})()],
    ["Array subclass", () => new (class Value extends Array {})()],
    ["null prototype", () => Object.assign(Object.create(null), { a: 1 })],
    [
      "custom prototype",
      () => Object.assign(Object.create({ inherited: true }), { a: 1 }),
    ],
    ["forged Date", () => Object.create(Date.prototype)],
    ["cross realm object", () => runInNewContext("({a:1})")],
    ["cross realm Date", () => runInNewContext("new Date(0)")],
    ["sparse array", () => [, 1]],
    [
      "array gap",
      () => {
        const a = [1, 2];
        delete a[0];
        return a;
      },
    ],
    ["array extra key", () => Object.assign([1], { extra: 2 })],
    ["nested undefined", () => ({ a: undefined })],
    ["array undefined", () => [undefined]],
    ["lone surrogate key", () => ({ ["\ud800"]: true })],
    ["object symbol", () => ({ [Symbol("secret")]: true })],
    ["array symbol", () => Object.assign([1], { [Symbol("secret")]: true })],
    ["Date extra property", () => Object.assign(new Date(0), { a: 1 })],
    [
      "Date symbol",
      () => Object.assign(new Date(0), { [Symbol("secret")]: 1 }),
    ],
    [
      "Date own nonenumerable",
      () => Object.defineProperty(new Date(0), "hidden", { value: 1 }),
    ],
    [
      "object nonenumerable",
      () => Object.defineProperty({}, "hidden", { value: 1 }),
    ],
    [
      "array nonenumerable index",
      () => Object.defineProperty([1], "0", { value: 1, enumerable: false }),
    ],
    ["array noncanonical index", () => Object.assign([], { "01": "x" })],
    [
      "cycle",
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
    ],
    [
      "array cycle",
      () => {
        const value: unknown[] = [];
        value.push(value);
        return value;
      },
    ],
    [
      "indirect cycle",
      () => {
        const value: Record<string, unknown> = { child: {} };
        (value.child as Record<string, unknown>).parent = value;
        return value;
      },
    ],
    [
      "toJSON function",
      () => ({
        toJSON() {
          return "replacement";
        },
      }),
    ],
  ];
  it.each(badFactories)(
    "rejects %s without hidden serialization",
    (_name, factory) => {
      invalid(() => serialize(factory()));
    },
  );
  it.each(["object", "array", "Date"])("never invokes %s getters", (kind) => {
    const getter = vi.fn(() => {
      throw new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC");
    });
    const value = kind === "object" ? {} : kind === "array" ? [1] : new Date(0);
    Object.defineProperty(value, kind === "array" ? "0" : "payload", {
      get: getter,
      enumerable: true,
      configurable: true,
    });
    invalid(() => serialize(value));
    expect(getter).not.toHaveBeenCalled();
  });
  it("safe-normalizes reflective proxy failures and revoked proxies", () => {
    const secret = new Error("SYNTHETIC_PRIVATE_DIAGNOSTIC");
    const value = new Proxy(
      {},
      {
        ownKeys() {
          throw secret;
        },
      },
    );
    const error = invalid(() => serialize(value));
    expect(error).not.toBe(secret);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    invalid(() => serialize(revoked.proxy));
  });
  it("refuses own setters instead of dropping them", () => {
    const setter = vi.fn();
    const value = Object.defineProperty({}, "value", {
      set: setter,
      enumerable: true,
    });
    invalid(() => serialize(value));
    expect(setter).not.toHaveBeenCalled();
  });
});

describe("strict canonical decoding", () => {
  const badWires: [string, () => unknown][] = [
    ["null envelope", () => "null"],
    ["object envelope", () => "{}"],
    ["short envelope", () => JSON.stringify([profile])],
    ["extra envelope fields", () => JSON.stringify([profile, null, null])],
    ["unknown profile", () => JSON.stringify(["other", null])],
    ["missing text", () => undefined],
    ["null input", () => null],
    ["object input", () => ({})],
    ["Buffer input", () => Buffer.from("x")],
    ["truncated JSON", () => "["],
    ["raw secret text", () => "SYNTHETIC_PRIVATE_SOURCE"],
    ["plain object payload", () => wire({ a: 1 })],
    ["untyped array", () => wire([])],
    ["extra tagged fields", () => wire(["array", [], 3])],
    ["unknown tag", () => wire(["class", []])],
    ["invalid date text", () => wire(["date", "not-a-date"])],
    ["nontext date", () => wire(["date", 0])],
    ["invalid date day", () => wire(["date", "2021-02-29T00:00:00.000Z"])],
    ["date missing milliseconds", () => wire(["date", "2020-01-01T00:00:00Z"])],
    [
      "date UTC alternate",
      () => wire(["date", "2020-01-01T00:00:00.000+00:00"]),
    ],
    [
      "noncanonical signed date",
      () => wire(["date", "+002020-01-01T00:00:00.000Z"]),
    ],
    ["array content object", () => wire(["array", {}])],
    ["object content object", () => wire(["object", {}])],
    ["nonpair object entry", () => wire(["object", [null]])],
    ["short object pair", () => wire(["object", [["a"]]])],
    ["extra object pair", () => wire(["object", [["a", 1, 2]]])],
    ["nonstring key", () => wire(["object", [[1, true]]])],
    [
      "duplicate key",
      () =>
        wire([
          "object",
          [
            ["a", 1],
            ["a", 2],
          ],
        ]),
    ],
    [
      "duplicate prototype key",
      () =>
        wire([
          "object",
          [
            ["__proto__", 1],
            ["__proto__", 2],
          ],
        ]),
    ],
    ["lone surrogate key", () => wire(["object", [["\ud800", 1]]])],
    ["lone surrogate string", () => wire("\ud800")],
    ["negative zero", () => `[${JSON.stringify(profile)},-0]`],
    ["nonfinite number", () => `[${JSON.stringify(profile)},1e400]`],
    ["number alternate exponent", () => `[${JSON.stringify(profile)},1e0]`],
    ["number alternate decimal", () => `[${JSON.stringify(profile)},1.0]`],
    ["prefix whitespace", () => " " + wire(null)],
    ["suffix whitespace", () => wire(null) + "\n"],
    ["prefix BOM", () => "\uFEFF" + wire(null)],
    ["inner whitespace", () => wire(null).replace(",", ", ")],
    ["escaped ASCII", () => wire("a").replace('"a"', '"\\u0061"')],
    ["escaped slash", () => wire("/").replace('"/"', '"\\/"')],
    [
      "integer keys reordered",
      () =>
        wire([
          "object",
          [
            ["2", "two"],
            ["1", "one"],
          ],
        ]),
    ],
  ];
  it.each(badWires)("rejects %s safely", (_name, factory) => {
    invalid(() => parse(factory() as string));
  });
  it("keeps readable ordinary string dates as strings", () => {
    expect(parse(wire("2020-01-01T00:00:00.000Z"))).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });
});

describe("bounded encoding and parsing", () => {
  it("accepts exact logical depth and rejects the next level in both directions", () => {
    expect(serialize(parse(serialize(nested(limits.depth))))).toBe(
      serialize(nested(limits.depth)),
    );
    invalid(() => serialize(nested(limits.depth + 1)));
    invalid(() => parse(wire(nestedWire(limits.depth + 1))));
  });
  it("rejects a too-deep JSON wire before JSON.parse allocates its containers", () => {
    const input = "[".repeat(4096) + "null" + "]".repeat(4096);
    const parseSpy = vi.spyOn(JSON, "parse");
    invalid(() => parse(input));
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it("charges serialized escaping before attempting a much larger JSON string allocation", () => {
    const input = "\0".repeat(Math.floor(limits.bytes / 6) + 1);
    const stringify = vi.spyOn(JSON, "stringify");
    invalid(() => serialize(input));
    expect(stringify).not.toHaveBeenCalled();
  });
  it("rejects string source bytes beyond the whole wire budget", () => {
    invalid(() => serialize("x".repeat(limits.bytes + 1)));
  });
  it("rejects wire bytes beyond limit before JSON.parse", () => {
    const input = "x".repeat(limits.bytes + 1);
    const parseSpy = vi.spyOn(JSON, "parse");
    invalid(() => parse(input));
    expect(parseSpy).not.toHaveBeenCalled();
  });
  it("charges UTF8 multibyte strings and keys rather than UTF16 length", () => {
    invalid(() => serialize("雪".repeat(Math.floor(limits.bytes / 3) + 1)));
    invalid(() =>
      serialize({ ["雪".repeat(Math.floor(limits.bytes / 3) + 1)]: null }),
    );
  });
  it("charges repeated references against logical node budget in both directions", () => {
    const shared = {};
    const value = Array(limits.nodes).fill(shared);
    invalid(() => serialize(value));
    invalid(() => parse(wire(["array", Array(limits.nodes).fill(null)])));
  });
  it("rejects oversized sparse array without expanding its missing values", () => {
    const array: unknown[] = [];
    array.length = limits.nodes + 1;
    invalid(() => serialize(array));
  });
  it("accounts for container/framing bytes as well as source strings", () => {
    const overhead = Buffer.byteLength(wire(""));
    const text = "x".repeat(limits.bytes - overhead + 1);
    invalid(() => serialize(text));
  });
});

describe("actual synthetic domain planner outputs", () => {
  it("round-trips exact membership, ritual, study, Files, auth and Discourse plans", () => {
    const m = membershipFixture(),
      r = ritualFixture(),
      s = studyFixture();
    const source = new ObjectId("123456789012345678901234"),
      canonical = createUuidV7(),
      at = new Date("2026-09-13T12:34:56.789Z");
    const normalized = normalizeLegacyAuth({
      users: [
        {
          _id: source,
          name: "Synthetic",
          email: "synthetic@example.invalid",
          services: [{ service: "google", id: "synthetic-provider" }],
        },
      ],
      accounts: [],
      sessions: [],
    });
    const provider = createUuidV7();
    const map = new Map([
      [sourceKey(normalized.users[0].source), canonical],
      [sourceKey(legacyProviderAlias(normalized.accounts[0])), provider],
    ]);
    const lookup = (ref: Parameters<typeof sourceKey>[0]) =>
      map.get(sourceKey(ref)) ?? null;
    const auth = planBetterAuthImport(normalized, { importedAt: at, lookup });
    const discourse = planLegacyDiscourseImport(
      [
        {
          source: normalized.users[0].source,
          discourseId: Number.MAX_SAFE_INTEGER,
        },
      ],
      {
        canonicalUserIds: [canonical],
        sourceForumOrigin: "https://forums.example.test",
        importedAt: at,
        lookup,
      },
    );
    const file = planLegacyFileImport(
      [
        {
          _id: source,
          filename: "\uFEFFexact\r\n雪.svg",
          sha256: "a".repeat(64),
          size: 42,
          mimeType: "image/svg+xml",
          createdAt: at,
          type: "image",
          image: { format: "svg", size: 42, width: 8, height: 6 },
        },
      ],
      {
        lookup: () => createUuidV7(),
        storageProvider: "synthetic-r2",
        sourceBucket: "synthetic",
        sourceObjectKeyPrefix: "synthetic/",
        importedAt: at,
      },
    );
    const plans = {
      auth,
      discourse,
      membership: planLegacyMembershipImport(m.input, m.options()),
      ritual: planLegacyRitualImport(r.input, r.options()),
      study: planLegacyStudyImport(s.input, s.options()),
      file,
    };
    const restored = roundTrip(plans);
    expect(restored.study.snapshots[0].sourceEjson).toBe(
      plans.study.snapshots[0].sourceEjson,
    );
    expect(restored.ritual.revisions[0].source).toBe(
      plans.ritual.revisions[0].source,
    );
    expect(restored.file.files[0].originalFilename).toBe(
      plans.file.files[0].originalFilename,
    );
    expect(restored.auth.users[0].createdAt).toBeInstanceOf(Date);
    expect(restored.discourse.links[0].discourseUserId).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
