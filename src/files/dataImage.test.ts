import { describe, expect, it } from "vitest";
import {
  DATA_IMAGE_LIMITS,
  DataImageError,
  type DataImageErrorCode,
  decodeDataImage,
} from "./dataImage";

function failure(
  reference: string,
  code: DataImageErrorCode,
  options?: Parameters<typeof decodeDataImage>[1],
) {
  expect(() => decodeDataImage(reference, options)).toThrowError(
    new DataImageError(code),
  );
}

describe("inline image byte transport", () => {
  it.each(["png", "jpeg", "gif", "webp", "svg+xml"])(
    "retains an explicit image/%s declaration without trusting it",
    (type) => {
      const decoded = decodeDataImage(`data:image/${type};base64,AAECA/7/`);
      expect(decoded.declaredMime).toBe(`image/${type}`);
      expect(decoded.bytes).toEqual(new Uint8Array([0, 1, 2, 3, 254, 255]));
    },
  );

  it.each([
    ["Zg==", "f"],
    ["Zg", "f"],
    ["Zm8=", "fo"],
    ["Zm8", "fo"],
    ["Zm9v", "foo"],
    ["Zm9vYg==", "foob"],
    ["Zm9vYmE=", "fooba"],
    ["Zm9vYmFy", "foobar"],
    [" Z\tg\n=\r=\f ", "f"],
    ["Zg%3D%3d%20%09%0a%0c%0d", "f"],
    // The web platform discards the unused final bits; byte identity is retained.
    ["Zh==", "f"],
    ["Zm9", "fo"],
  ])("decodes web-compatible base64 %j", (body, expected) => {
    expect(decodeDataImage(`data:image/png;base64,${body}`).bytes).toEqual(
      new TextEncoder().encode(expected),
    );
  });

  it("percent-decodes before base64 without treating plus as a space", () => {
    expect(decodeDataImage("DATA:IMAGE/JPEG;BASE64,%2b%2F8%3D")).toEqual({
      declaredMime: "image/jpeg",
      bytes: new Uint8Array([251, 255]),
    });
    expect(decodeDataImage("data:image/jpeg;base64,+/8=").bytes).toEqual(
      new Uint8Array([251, 255]),
    );
  });

  it("preserves arbitrary percent-encoded bytes, UTF-8 and punctuation", () => {
    const reference =
      'data:image/svg+xml;charset=UTF-8,%FF%00%EF%BB%BF%C3%A9%F0%9F%94%A5%23%25+?,<>"\\%20%0A';
    expect(decodeDataImage(reference).bytes).toEqual(
      new Uint8Array([
        255, 0, 239, 187, 191, 195, 169, 240, 159, 148, 165, 35, 37, 43, 63, 44,
        60, 62, 34, 92, 32, 10,
      ]),
    );
  });

  it("returns independent mutable snapshots", () => {
    const reference = "data:image/gif;base64,AAEC";
    const first = decodeDataImage(reference).bytes;
    first.fill(255);
    expect(decodeDataImage(reference).bytes).toEqual(new Uint8Array([0, 1, 2]));
  });

  it("does not label transported content as validated", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>';
    const decoded = decodeDataImage(
      `data:image/png,${encodeURIComponent(source)}`,
    );
    expect(new TextDecoder().decode(decoded.bytes)).toBe(source);
    expect(Object.keys(decoded)).toEqual(["declaredMime", "bytes"]);
  });

  it.each(["%", "%0", "%GG", "%0x", "%x0", "%u0041"])(
    "refuses malformed percent escape %j",
    (body) => {
      for (const encoding of ["", ";base64"])
        failure(
          `data:image/png${encoding},${body}`,
          "MALFORMED_PERCENT_ENCODING",
        );
    },
  );

  it.each([
    "A",
    "A=",
    "A===",
    "AA=",
    "AA===",
    "AAA==",
    "AAAA=",
    "AAAA==",
    "=AAA",
    "AA=A",
    "AA==A",
    "====",
    "AA$=",
    "AA_+",
    "AA-+",
    "AA,=",
    "AA%FF",
    "AA%00",
    "AA%0B",
    "AA%7F",
    "AA%23",
    "AA%25",
    "AA%C2%A0",
  ])("refuses malformed base64 %j", (body) => {
    failure(`data:image/png;base64,${body}`, "INVALID_BASE64");
  });

  it.each(["", ";base64", ";base64, "])("refuses empty images %j", (suffix) => {
    const reference = suffix.endsWith(" ")
      ? `data:image/png${suffix}`
      : `data:image/png${suffix},`;
    failure(reference, "EMPTY_DATA");
  });

  it.each([
    "data:,AA",
    "data:;base64,AA",
    "data:text/html,AA",
    "data:image/jpg,AA",
    "data:image/apng,AA",
    "data:image/avif,AA",
    "data:image/png;charset=utf-8,AA",
    "data:image/svg+xml;charset=iso-8859-1,AA",
    'data:image/svg+xml;charset="utf-8",AA',
    "data:image/png;name=secret,AA",
    "data:image/png;base64;base64,AA",
    "data:image/png; base64,AA",
    "data: image/png,AA",
    " data:image/png,AA",
    "data:image/png;base64",
    "https://example.test/image.png",
    "data:image/png%2cAA",
  ])("refuses unsupported header %j", (reference) => {
    failure(reference, "UNSUPPORTED_MEDIA_TYPE");
  });

  it.each(["#id", "#", "#svgView(viewBox(0,0,1,1))"])(
    "requires the caller to preserve and separate %j",
    (fragment) => {
      failure(`data:image/svg+xml,abc${fragment}`, "FRAGMENT_NOT_SEPARATED");
    },
  );

  it.each([
    "é",
    "🔥",
    "\ud800",
    "\udfff",
    "\u007f",
    "\u0000",
    "\u000b",
    "\u00a0",
  ])("refuses raw ambiguous character %j", (body) => {
    for (const encoding of ["", ";base64"])
      failure(`data:image/png${encoding},${body}`, "INVALID_REFERENCE");
  });

  it.each([" ", "\t", "\r", "\n", "\f"])(
    "requires escaping non-base64 whitespace %j",
    (space) => failure(`data:image/svg+xml,a${space}b`, "INVALID_REFERENCE"),
  );

  it("refuses non-string input without coercing it or disclosing it", () => {
    for (const value of [
      null,
      undefined,
      1,
      {},
      ["secret"],
      {
        toString: () => {
          throw new Error("secret");
        },
      },
    ])
      failure(value as unknown as string, "INVALID_REFERENCE");
    try {
      decodeDataImage("data:image/png;base64,secret-invalid!");
      expect.fail("Expected refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(DataImageError);
      expect((error as Error).message).toBe("INVALID_BASE64");
      expect(JSON.stringify(error)).not.toContain("secret");
    }
  });

  it("enforces exact decoded and reference limits in both encodings", () => {
    for (const reference of [
      "data:image/png,%00%01%02",
      "data:image/png;base64,AAEC",
    ])
      for (const maxBytes of [1, 2, 3]) {
        if (maxBytes === 3)
          expect(
            decodeDataImage(reference, {
              maxBytes,
              maxReferenceBytes: reference.length,
            }).bytes.byteLength,
          ).toBe(3);
        else failure(reference, "BYTE_LIMIT", { maxBytes });
        failure(reference, "REFERENCE_LIMIT", {
          maxReferenceBytes: reference.length - 1,
        });
      }
    failure(
      "x".repeat(DATA_IMAGE_LIMITS.maxReferenceBytes + 1),
      "REFERENCE_LIMIT",
    );
  });

  it("only accepts positive integer limits that tighten the hard caps", () => {
    for (const key of ["maxBytes", "maxReferenceBytes"])
      for (const value of [
        0,
        -1,
        0.5,
        NaN,
        Infinity,
        undefined,
        "1",
        1024 * 1024 + 1,
      ])
        failure("data:image/png,abc", "INVALID_LIMITS", {
          [key]: value,
        } as never);
    for (const options of [
      null,
      1,
      "1",
      { surprise: 1 },
      { constructor: 1 },
      { toString: 1 },
    ])
      failure("data:image/png,abc", "INVALID_LIMITS", options as never);
  });

  it("matches native data-URL fetch bytes for the accepted transport profile", async () => {
    // data: fetches are entirely local; no provider or network request is made.
    const references = [
      "data:image/png;base64,AAEC/f7/",
      "data:image/png;base64,AAEC%2Ff7%2F",
      "data:image/png;base64,Zh==",
      "data:image/png;base64, Z\tg\n=\r=\f ",
      "data:image/svg+xml;charset=utf-8,%FF%00%23%25+?,<>%22%5C%20%0A",
    ];
    for (const reference of references) {
      const response = await fetch(reference);
      expect(decodeDataImage(reference).bytes).toEqual(
        new Uint8Array(await response.arrayBuffer()),
      );
    }
  });
});
