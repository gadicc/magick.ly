import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  bundleTextSha256,
  type ExpectedRitualBundleStorageReceipt,
  isRitualBundlePublicationPolicyId,
  parseRitualBundleStorageReceipt,
  RITUAL_BUNDLE_LOCATION_LIMITS,
  RitualBundlePublicationError,
  type RitualBundleStorageReceiptV1,
  ritualBundleRequestHash,
} from "./ritualBundlePublication";

vi.mock("server-only", () => ({}));

const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const otherId = "019947c5-abcd-7000-8000-000000000099";
function fixture() {
  const receipt: RitualBundleStorageReceiptV1 = {
    profile: "magickli-ritual-bundle-object-receipt-v1",
    operationId: "019947c5-abcd-7000-8000-000000000001",
    bundleId: "019947c5-abcd-7000-8000-000000000002",
    assetKey: "019947c5-abcd-7000-8000-000000000003",
    claimId: "019947c5-abcd-7000-8000-000000000004",
    storageProvider: "r2",
    bucket: "synthetic-private-bundles",
    objectKey: "bundles/owned/é%2Fimage.svg?keep=2&first=1#part",
    sha256: sha("synthetic verified image bytes"),
    byteSize: 30,
    mime: "image/svg+xml",
    verifiedAtMs: 1_800_000_030_000,
  };
  const expected: ExpectedRitualBundleStorageReceipt = {
    operationId: receipt.operationId,
    bundleId: receipt.bundleId,
    key: receipt.assetKey,
    claimId: receipt.claimId,
    storageProvider: receipt.storageProvider,
    bucket: receipt.bucket,
    objectKey: receipt.objectKey,
    sha256: receipt.sha256,
    byteSize: receipt.byteSize,
    mime: receipt.mime,
    claimStartedAtMs: 1_800_000_000_000,
    claimExpiresAtMs: 1_800_000_120_000,
  };
  return { receipt, expected };
}
function parse(receipt: unknown, expected: ExpectedRitualBundleStorageReceipt) {
  const json = JSON.stringify(receipt);
  return parseRitualBundleStorageReceipt(json, sha(json), expected);
}

describe("persisted ritual bundle storage receipts", () => {
  it("returns a frozen independent receipt with exact owned location and byte facts", () => {
    const { receipt, expected } = fixture();
    const json = JSON.stringify(receipt);
    const result = parseRitualBundleStorageReceipt(json, sha(json), expected);
    expect(result).toEqual(receipt);
    expect(Object.isFrozen(result)).toBe(true);
    receipt.objectKey = "replacement";
    expected.bucket = "another-bucket";
    expect(result?.objectKey).toBe(
      "bundles/owned/é%2Fimage.svg?keep=2&first=1#part",
    );
    expect(result?.bucket).toBe("synthetic-private-bundles");
    expect(Reflect.set(result!, "byteSize", 0)).toBe(false);
  });

  it.each([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ] as const)("accepts reserved %s bytes", (mime) => {
    const { receipt, expected } = fixture();
    receipt.mime = expected.mime = mime;
    expect(parse(receipt, expected)).toEqual(receipt);
  });

  it.each([
    ["operationId", "operationId"],
    ["bundleId", "bundleId"],
    ["assetKey", "key"],
    ["claimId", "claimId"],
  ] as const)(
    "binds %s to the expected reservation/claim",
    (field, binding) => {
      const { receipt, expected } = fixture();
      expect(parse({ ...receipt, [field]: otherId }, expected)).toBeNull();
      expect(parse(receipt, { ...expected, [binding]: otherId })).toBeNull();
      // Even matching corrupt persisted identities cannot supply their own authority.
      for (const invalid of [
        receipt[field].toUpperCase(),
        "019947c5-abcd-4000-8000-000000000001",
        "not-a-uuid",
        null,
      ]) {
        expect(
          parse(
            { ...receipt, [field]: invalid },
            { ...expected, [binding]: invalid },
          ),
        ).toBeNull();
      }
    },
  );

  it("permits exact same-claim replay but rejects a prior worker receipt after reclaim", () => {
    const { receipt, expected } = fixture();
    expect(parse(receipt, expected)).toEqual(receipt);
    expect(parse(receipt, expected)).toEqual(receipt);
    expect(parse(receipt, { ...expected, claimId: otherId })).toBeNull();
    const reclaimed = {
      ...expected,
      claimId: otherId,
      claimStartedAtMs: expected.claimExpiresAtMs,
      claimExpiresAtMs: expected.claimExpiresAtMs + 120_000,
    };
    expect(parse(receipt, reclaimed)).toBeNull();
    expect(
      parse(
        {
          ...receipt,
          claimId: otherId,
          verifiedAtMs: reclaimed.claimStartedAtMs,
        },
        reclaimed,
      ),
    ).not.toBeNull();
  });

  it("requires the exact profile and all own fields, rejecting extensions and replacements", () => {
    const { receipt, expected } = fixture();
    expect(
      parse({ ...receipt, profile: "future-profile" }, expected),
    ).toBeNull();
    expect(parse({ ...receipt, etag: "not-byte-proof" }, expected)).toBeNull();
    for (const field of Object.keys(receipt)) {
      const missing: Record<string, unknown> = { ...receipt };
      delete missing[field];
      expect(parse(missing, expected)).toBeNull();
      expect(
        parse({ ...missing, unexpected: receipt.profile }, expected),
      ).toBeNull();
    }
    const proto = JSON.stringify(receipt).replace(
      /}$/,
      ',"__proto__":{"verifiedAtMs":0}}',
    );
    expect(
      parseRitualBundleStorageReceipt(proto, sha(proto), expected),
    ).toBeNull();
  });

  it("rejects non-object, malformed and non-exact JSON even with its matching hash", () => {
    const { receipt, expected } = fixture();
    const json = JSON.stringify(receipt);
    const alternatives = [
      "null",
      "false",
      "42",
      '"receipt"',
      "[]",
      "{}",
      "{",
      ` ${json}`,
      `${json}\n`,
      JSON.stringify(receipt, null, 2),
      json.replace("r2", "r\\u0032"),
      json.replace(/}$/, ',"storageProvider":"r2"}'),
      json.replace('"byteSize":30', '"byteSize":3e1'),
    ];
    for (const text of alternatives) {
      expect(
        parseRitualBundleStorageReceipt(text, sha(text), expected),
      ).toBeNull();
    }
    for (const nonText of [undefined, null, receipt, new String(json)]) {
      expect(
        parseRitualBundleStorageReceipt(nonText, sha(json), expected),
      ).toBeNull();
    }
  });

  it("hashes exact serialization without requiring a fixed object key order", () => {
    const { receipt, expected } = fixture();
    const reordered = Object.fromEntries(Object.entries(receipt).reverse());
    const original = JSON.stringify(receipt),
      json = JSON.stringify(reordered);
    expect(sha(json)).not.toBe(sha(original));
    expect(
      parseRitualBundleStorageReceipt(json, sha(original), expected),
    ).toBeNull();
    expect(parseRitualBundleStorageReceipt(json, sha(json), expected)).toEqual(
      receipt,
    );
  });

  it("rejects invalid digest encodings and a changed receipt under the old digest", () => {
    const { receipt, expected } = fixture();
    const json = JSON.stringify(receipt),
      hash = sha(json);
    for (const invalid of [
      undefined,
      null,
      1,
      "",
      hash.toUpperCase(),
      "a".repeat(63),
      "g".repeat(64),
    ]) {
      expect(
        parseRitualBundleStorageReceipt(json, invalid, expected),
      ).toBeNull();
    }
    expect(
      parseRitualBundleStorageReceipt(
        JSON.stringify({ ...receipt, verifiedAtMs: receipt.verifiedAtMs + 1 }),
        hash,
        expected,
      ),
    ).toBeNull();
  });

  it("bounds UTF-8 receipt bytes as well as JS length and rejects literal invalid Unicode", () => {
    const { expected } = fixture();
    for (const text of [" ".repeat(16_385), "🐉".repeat(4_097), '"\ud800"']) {
      expect(
        parseRitualBundleStorageReceipt(text, sha(text), expected),
      ).toBeNull();
    }
  });

  it("binds the lowercase byte digest rather than trusting matching malformed declarations", () => {
    const { receipt, expected } = fixture();
    expect(parse({ ...receipt, sha256: "a".repeat(64) }, expected)).toBeNull();
    for (const invalid of [
      receipt.sha256.toUpperCase(),
      "a".repeat(63),
      "g".repeat(64),
      null,
    ]) {
      expect(
        parse(
          { ...receipt, sha256: invalid },
          { ...expected, sha256: invalid as string },
        ),
      ).toBeNull();
    }
  });

  it("accepts positive safe byte facts only when they match the reservation", () => {
    const { receipt, expected } = fixture();
    expect(parse({ ...receipt, byteSize: 31 }, expected)).toBeNull();
    for (const invalid of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "30",
      null,
    ]) {
      expect(
        parse(
          { ...receipt, byteSize: invalid },
          { ...expected, byteSize: invalid as number },
        ),
      ).toBeNull();
    }
    // Capture/manifest size ceilings belong to their own contracts; this checks exact facts.
    for (const byteSize of [1, 32 * 1024 * 1024 + 1]) {
      expect(
        parse({ ...receipt, byteSize }, { ...expected, byteSize }),
      ).not.toBeNull();
    }
  });

  it("rejects changed or unsupported MIME even when both records declare it", () => {
    const { receipt, expected } = fixture();
    expect(parse({ ...receipt, mime: "image/png" }, expected)).toBeNull();
    for (const mime of [
      "text/html",
      "image/avif",
      "image/PNG",
      "image/svg+xml;charset=utf-8",
      null,
    ]) {
      expect(
        parse(
          { ...receipt, mime },
          { ...expected, mime: mime as typeof expected.mime },
        ),
      ).toBeNull();
    }
  });

  it.each([
    ["at start", 0, true],
    ["just before expiry", 119_999, true],
    ["before start", -1, false],
    ["at expiry", 120_000, false],
    ["after expiry", 120_001, false],
  ] as const)(
    "uses a half-open claim interval: %s",
    (_label, offset, valid) => {
      const { receipt, expected } = fixture();
      const result = parse(
        { ...receipt, verifiedAtMs: expected.claimStartedAtMs + offset },
        expected,
      );
      expect(result !== null).toBe(valid);
    },
  );

  it("rejects invalid verification instants and malformed stored claim intervals", () => {
    const { receipt, expected } = fixture();
    const invalidTimes = [
      -1,
      1.5,
      8_640_000_000_000_001,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      Infinity,
      "1800000030000",
      null,
    ];
    for (const instant of invalidTimes) {
      expect(parse({ ...receipt, verifiedAtMs: instant }, expected)).toBeNull();
      for (const key of ["claimStartedAtMs", "claimExpiresAtMs"] as const) {
        expect(parse(receipt, { ...expected, [key]: instant })).toBeNull();
      }
    }
    for (const key of ["claimStartedAtMs", "claimExpiresAtMs"] as const) {
      expect(parse(receipt, { ...expected, [key]: -0 })).toBeNull();
    }
    expect(
      parse(receipt, {
        ...expected,
        claimExpiresAtMs: expected.claimStartedAtMs,
      }),
    ).toBeNull();
    expect(
      parse(receipt, {
        ...expected,
        claimExpiresAtMs: expected.claimStartedAtMs - 1,
      }),
    ).toBeNull();
  });

  it("handles the nonnegative and Date-range boundaries without rounding", () => {
    const { receipt, expected } = fixture();
    expect(
      parse(
        { ...receipt, verifiedAtMs: 0 },
        { ...expected, claimStartedAtMs: 0, claimExpiresAtMs: 1 },
      ),
    ).not.toBeNull();
    const max = 8_640_000_000_000_000;
    expect(
      parse(
        { ...receipt, verifiedAtMs: max - 1 },
        { ...expected, claimStartedAtMs: max - 1, claimExpiresAtMs: max },
      ),
    ).not.toBeNull();
    expect(
      parse(
        { ...receipt, verifiedAtMs: max },
        { ...expected, claimStartedAtMs: max - 1, claimExpiresAtMs: max },
      ),
    ).toBeNull();
  });

  it.each([
    ["storageProvider", "🐉".repeat(32)],
    ["bucket", "b" + "é".repeat(127)],
    ["objectKey", "🐉".repeat(256)],
  ] as const)(
    "bounds %s by UTF-8 bytes and preserves its exact identity",
    (field, maximum) => {
      const { receipt, expected } = fixture();
      expect(Buffer.byteLength(maximum)).toBe(
        RITUAL_BUNDLE_LOCATION_LIMITS[field],
      );
      expect(
        parse(
          { ...receipt, [field]: maximum },
          { ...expected, [field]: maximum },
        )?.[field],
      ).toBe(maximum);
      expect(
        parse(
          { ...receipt, [field]: maximum + "a" },
          { ...expected, [field]: maximum + "a" },
        ),
      ).toBeNull();
      expect(
        parse({ ...receipt, [field]: receipt[field] + "/other" }, expected),
      ).toBeNull();
      for (const invalid of [null, 1, "", "a\0b", "\ud800", "\udc00"]) {
        expect(
          parse(
            { ...receipt, [field]: invalid },
            { ...expected, [field]: invalid },
          ),
        ).toBeNull();
      }
    },
  );

  it("rejects blank provider/bucket identities but does not normalize opaque object keys", () => {
    const { receipt, expected } = fixture();
    for (const field of ["storageProvider", "bucket"] as const) {
      expect(
        parse(
          { ...receipt, [field]: " \t\n" },
          { ...expected, [field]: " \t\n" },
        ),
      ).toBeNull();
    }
    for (const objectKey of [" ", " /a//é%2F?b=2&a=1#frag "]) {
      expect(
        parse({ ...receipt, objectKey }, { ...expected, objectKey })?.objectKey,
      ).toBe(objectKey);
      expect(
        parse(
          { ...receipt, objectKey },
          { ...expected, objectKey: objectKey.trim() },
        ),
      ).toBeNull();
    }
  });
});

describe("publication retry identity and safe errors", () => {
  it("hashes exact UTF-8 text without JSON parsing or Unicode normalization", () => {
    expect(bundleTextSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    for (const text of ["", "🐉é\r\n", '{ "a": 1 }'])
      expect(bundleTextSha256(text)).toBe(sha(text));
    expect(bundleTextSha256("é")).not.toBe(bundleTextSha256("e\u0301"));
    expect(bundleTextSha256('{ "a": 1 }')).not.toBe(
      bundleTextSha256('{"a":1}'),
    );
  });

  const request = () => ({
    operationId: fixture().receipt.operationId,
    actorId: "019947c5-abcd-7000-8000-000000000005",
    manifestSha256: sha("synthetic manifest"),
    planSha256: sha("synthetic private plan"),
    publicationPolicyId: "legacy.read:v1",
  });
  it("binds a domain-versioned request tuple independently of property insertion order", () => {
    const value = request();
    const expected = sha(
      JSON.stringify([
        "magickli-ritual-bundle-publication-request-v1",
        value.operationId,
        value.actorId,
        value.manifestSha256,
        value.planSha256,
        value.publicationPolicyId,
      ]),
    );
    expect(ritualBundleRequestHash(value)).toBe(expected);
    expect(
      ritualBundleRequestHash({
        publicationPolicyId: value.publicationPolicyId,
        planSha256: value.planSha256,
        manifestSha256: value.manifestSha256,
        actorId: value.actorId,
        operationId: value.operationId,
      }),
    ).toBe(expected);
    expect(ritualBundleRequestHash(value)).toBe(expected);
  });

  it.each([
    ["operationId", otherId],
    ["actorId", otherId],
    ["manifestSha256", sha("changed manifest")],
    ["planSha256", sha("changed plan")],
    ["publicationPolicyId", "legacy.read:v2"],
  ] as const)("changes retry identity when %s changes", (field, changed) => {
    const value = request(),
      original = ritualBundleRequestHash(value);
    value[field] = changed;
    expect(ritualBundleRequestHash(value)).not.toBe(original);
  });

  it("keeps manifest and plan roles distinct even when their digest values are swapped", () => {
    const value = request();
    expect(
      ritualBundleRequestHash({
        ...value,
        manifestSha256: value.planSha256,
        planSha256: value.manifestSha256,
      }),
    ).not.toBe(ritualBundleRequestHash(value));
  });

  it("allows bounded policy generations with an explicit lowercase ASCII grammar", () => {
    for (const valid of [
      "a",
      "0",
      "legacy.read:v1",
      "read-policy_2",
      "a" + ".".repeat(127),
    ]) {
      expect(isRitualBundlePublicationPolicyId(valid)).toBe(true);
    }
    for (const invalid of [
      undefined,
      null,
      1,
      {},
      [],
      new String("v1"),
      "",
      "A",
      ".v1",
      "-v1",
      "_v1",
      ":v1",
      "a".repeat(129),
      "v 1",
      "v1\n",
      "v1\0",
      "v1/next",
      "v1?next",
      "réad",
      "v1🐉",
    ]) {
      expect(isRitualBundlePublicationPolicyId(invalid)).toBe(false);
    }
  });

  it("exposes stable operation categories through Error without provider message or cause", () => {
    const codes = [
      "INVALID_REQUEST",
      "AUTH_REQUIRED",
      "ACTOR_CHANGED",
      "FORBIDDEN",
      "STALE",
      "EXPIRED",
      "BUSY",
      "OPERATION_CONFLICT",
      "INCOMPLETE",
      "ABORTED",
      "UNAVAILABLE",
    ] as const;
    for (const code of codes) {
      const error = new RitualBundlePublicationError(code);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RitualBundlePublicationError);
      expect(error.name).toBe("RitualBundlePublicationError");
      expect(error.code).toBe(code);
      expect(error.message).toBe(code);
      expect(error.cause).toBeUndefined();
      expect(JSON.parse(JSON.stringify(error))).toEqual({
        code,
        name: "RitualBundlePublicationError",
      });
    }
  });
});
