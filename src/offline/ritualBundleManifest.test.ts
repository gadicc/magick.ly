import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type { RitualRenderDescriptorV1 } from "./permissionContract";
import {
  type ExpectedRitualBundleManifest,
  RITUAL_BUNDLE_MANIFEST_LIMITS as LIMITS,
  parseRitualBundleManifest,
} from "./ritualBundleManifest";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const fragment = (src: string) => {
  const index = src.indexOf("#");
  return index < 0 ? [src, ""] : [src.slice(0, index), src.slice(index)];
};
function fixture(
  refs = ["/pics/example.png#first", "/pics/example.png#second"],
) {
  const renderedJson = JSON.stringify({
    children: refs.map((src) => ({ type: "img", src })),
  });
  const assets = [...new Set(refs.map((src) => fragment(src)[0]))].map(
    (reference) => ({
      key: createUuidV7(),
      reference,
      sha256: "a".repeat(64),
      mime: "image/png",
      bytes: 64,
      purpose: "read",
    }),
  );
  return {
    version: 1,
    bundleId: createUuidV7(),
    ritualId: createUuidV7(),
    descriptor: {
      descriptorSha256: "b".repeat(64),
      contentSha256: sha(renderedJson),
      outputFormat: "json-rich-text",
      outputFormatVersion: "1",
    } satisfies RitualRenderDescriptorV1,
    title: "A ritual",
    renderedJson,
    assets,
    occurrences: refs.map((src, index) => ({
      path: [index],
      src,
      displayFragment: fragment(src)[1],
      assetKey: assets.find((row) => row.reference === fragment(src)[0])!.key,
    })),
  };
}
type Fixture = ReturnType<typeof fixture>;
function bound(value: Fixture, manifestJson = JSON.stringify(value)) {
  return {
    manifestSha256: sha(manifestJson),
    bundleId: value.bundleId,
    ritualId: value.ritualId,
    descriptor: { ...value.descriptor },
  };
}
const parse = (value: Fixture, wireValue: unknown = value) => {
  const json = JSON.stringify(wireValue);
  return parseRitualBundleManifest(json, bound(value, json));
};
function body(value: Fixture, tree: unknown) {
  value.renderedJson = JSON.stringify(tree);
  value.descriptor.contentSha256 = sha(value.renderedJson);
  return value;
}

describe("read bundle manifest boundary", () => {
  it("preserves exact title/body, queries, fragments, and one asset used at multiple source paths", async () => {
    const refs = [
      "/pics/exact.png?b=2&a=%2F&a=/##%20",
      "/pics/exact.png?b=2&a=%2F&a=/#another",
      "/pics/exact.png?a=%2F&a=/&b=2",
    ];
    const value = fixture(refs);
    value.title = "\uFEFF  Ritual 🜁\r\n ";
    value.renderedJson = ` { "forMe": false, "children": ${JSON.stringify(
      refs.map((src) => ({ type: "img", src, width: "50%" })),
    )}, "metadata": "\\u0000\\ud800" }\n`;
    value.descriptor.contentSha256 = sha(value.renderedJson);
    const result = await parse(value);
    expect(result).toEqual(value);
    expect(result?.assets).toHaveLength(2);
    expect(result?.renderedJson).toBe(value.renderedJson);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.descriptor)).toBe(true);
    expect(Object.isFrozen(result?.assets[0])).toBe(true);
    expect(Object.isFrozen(result?.occurrences[0].path)).toBe(true);
  });

  it("allows empty image sets and empty/whitespace titles", async () => {
    for (const title of ["", " \r\n\uFEFF "]) {
      const value = fixture([]);
      value.title = title;
      expect(await parse(value)).toEqual(value);
    }
  });

  it("checks display-only references without inventing trusted origins or private-file access", async () => {
    const refs = [
      "/api/file2?sha256=" + "c".repeat(64),
      "/api/treeOfLife?field=name.he",
      "/api/render/tree-of-life?field=name.roman",
      "https://images.example.test/a.png?keep=%2F",
      "data:image/png;base64,AQ==",
      "/logical/new-private-route/opaque-key",
    ];
    const value = fixture(refs);
    expect(await parse(value)).toEqual(value);
  });

  it("keeps task say+do as one source occurrence and suppresses hidden child references", async () => {
    const value = fixture(["/pics/visible.png#keep"]);
    body(value, {
      children: [
        {
          type: "task",
          role: "reader",
          say: true,
          do: true,
          children: [{ type: "img", src: value.occurrences[0].src }],
        },
        {
          type: "text",
          text: "Visible",
          children: [{ type: "img", src: "/ignored.png" }],
        },
      ],
    });
    value.occurrences[0].path = [0, 0];
    expect(await parse(value)).toEqual(value);
  });

  it("copies expected bindings before an asynchronous hash settles", async () => {
    const value = fixture(),
      json = JSON.stringify(value),
      expected = bound(value);
    const pending = parseRitualBundleManifest(json, expected);
    expected.bundleId = createUuidV7();
    expected.ritualId = createUuidV7();
    expected.manifestSha256 = "0".repeat(64);
    expected.descriptor.contentSha256 = "0".repeat(64);
    expect(await pending).toEqual(value);
  });

  it("accepts every supported image MIME with the declared per-type byte ceiling", async () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ]) {
      const value = fixture(["/pics/one"]);
      value.assets[0].mime = mime;
      value.assets[0].bytes =
        mime === "image/svg+xml" ? LIMITS.svgBytes : LIMITS.rasterBytes;
      expect(await parse(value)).toEqual(value);
      value.assets[0].bytes++;
      expect(await parse(value)).toBeNull();
    }
  });

  it("accepts the exact count and aggregate capture ceilings, rejecting the next entry/byte", async () => {
    const value = fixture(
      Array.from({ length: LIMITS.assets }, (_, index) => `/pics/${index}.png`),
    );
    value.assets.forEach((row) => {
      row.bytes = LIMITS.capturedBytes / LIMITS.assets;
    });
    expect(await parse(value)).toEqual(value);
    value.assets[0].bytes++;
    expect(await parse(value)).toBeNull();
    expect(
      await parse(
        fixture(
          Array.from(
            { length: LIMITS.assets + 1 },
            (_, index) => `/pics/${index}.png`,
          ),
        ),
      ),
    ).toBeNull();
  });

  it("counts UTF-8 bytes for title and rendered-body limits and preserves exact boundary text", async () => {
    const value = fixture([]);
    value.title = "é".repeat(LIMITS.titleBytes / 2);
    expect(await parse(value)).toEqual(value);
    value.title += "é";
    expect(await parse(value)).toBeNull();
    value.title = "";
    const prefix = '{"children":[],"unused":"',
      suffix = '"}';
    value.renderedJson =
      prefix +
      "x".repeat(LIMITS.renderedBytes - prefix.length - suffix.length) +
      suffix;
    value.descriptor.contentSha256 = sha(value.renderedJson);
    expect(await parse(value)).toEqual(value);
    value.renderedJson += " ";
    value.descriptor.contentSha256 = sha(value.renderedJson);
    expect(await parse(value)).toBeNull();
    value.renderedJson = JSON.stringify({
      children: [],
      unused: "é".repeat(LIMITS.renderedBytes / 2),
    });
    value.descriptor.contentSha256 = sha(value.renderedJson);
    expect(await parse(value)).toBeNull();
  });

  it("bounds reference and total envelope bytes before accepting JSON", async () => {
    const prefix = "https://example.test/?q=";
    const value = fixture([
      prefix + "x".repeat(LIMITS.referenceBytes - prefix.length),
    ]);
    expect(await parse(value)).toEqual(value);
    expect(await parse(fixture([value.assets[0].reference + "x"]))).toBeNull();
    const oversized = '"' + "x".repeat(LIMITS.manifestBytes) + '"';
    expect(
      await parseRitualBundleManifest(oversized, bound(value, oversized)),
    ).toBeNull();
    const multibyte = '"' + "é".repeat(LIMITS.manifestBytes / 2) + '"';
    expect(
      await parseRitualBundleManifest(multibyte, bound(value, multibyte)),
    ).toBeNull();
  });

  it.each([null, undefined, [], {}, 1, false, "", "{", "null", "[]", "false"])(
    "returns null for invalid wire input %j",
    async (input) => {
      expect(
        await parseRitualBundleManifest(input, bound(fixture())),
      ).toBeNull();
    },
  );

  it("requires exact stringify serialization without normalizing nested body bytes", async () => {
    const value = fixture(),
      json = JSON.stringify(value);
    for (const wire of [
      " " + json,
      "\uFEFF" + json,
      json.replace('"version":1', '"version":1,"version":1'),
      json.replace('"title":"A ritual"', '"title":"\\u0041 ritual"'),
      json.replace('"version":1', '"version":1.0'),
    ])
      expect(
        await parseRitualBundleManifest(wire, bound(value, wire)),
      ).toBeNull();
  });

  it.each([
    "version",
    "bundleId",
    "ritualId",
    "descriptor",
    "title",
    "renderedJson",
    "assets",
    "occurrences",
  ])("rejects missing or foreign top-level %s", async (key) => {
    const value = fixture(),
      altered: Record<string, unknown> = { ...value };
    delete altered[key];
    expect(await parse(value, altered)).toBeNull();
    expect(
      await parse(value, { ...value, ownerId: createUuidV7() }),
    ).toBeNull();
  });

  it("rejects wrong descriptor bindings and actual rendered bytes independently", async () => {
    const value = fixture(),
      json = JSON.stringify(value);
    for (const expected of [
      { ...bound(value), manifestSha256: "0".repeat(64) },
      { ...bound(value), bundleId: createUuidV7() },
      { ...bound(value), ritualId: createUuidV7() },
      {
        ...bound(value),
        descriptor: { ...value.descriptor, descriptorSha256: "0".repeat(64) },
      },
      {
        ...bound(value),
        descriptor: { ...value.descriptor, contentSha256: "0".repeat(64) },
      },
    ])
      expect(await parseRitualBundleManifest(json, expected)).toBeNull();
    value.renderedJson += " ";
    expect(await parse(value)).toBeNull();
  });

  it.each([
    { outputFormat: "other" },
    { outputFormatVersion: "2" },
    { descriptorSha256: "B".repeat(64) },
    { contentSha256: "not-a-hash" },
    { contentSha256: null },
    { sourceSha256: "a".repeat(64) },
  ])("rejects malformed descriptor %j", async (patch) => {
    const value = fixture();
    expect(
      await parse(value, {
        ...value,
        descriptor: { ...value.descriptor, ...patch },
      }),
    ).toBeNull();
  });

  it("requires canonical UUIDv7 identities at both binding and payload boundaries", async () => {
    const value = fixture();
    for (const invalid of [
      "bad",
      createUuidV7().toUpperCase(),
      "00000000-0000-4000-8000-000000000000",
    ]) {
      expect(
        await parseRitualBundleManifest(JSON.stringify(value), {
          ...bound(value),
          bundleId: invalid,
        }),
      ).toBeNull();
      expect(
        await parseRitualBundleManifest(JSON.stringify(value), {
          ...bound(value),
          ritualId: invalid,
        }),
      ).toBeNull();
      expect(
        await parse(value, {
          ...value,
          assets: [{ ...value.assets[0], key: invalid }],
        }),
      ).toBeNull();
    }
  });

  it("rejects expected getters, inherited/extra properties, and proxies without throwing", async () => {
    const value = fixture(),
      expected = bound(value),
      getter = vi.fn(() => expected.bundleId);
    const accessor = { ...expected };
    Object.defineProperty(accessor, "bundleId", {
      enumerable: true,
      get: getter,
    });
    const candidates = [
      null,
      [],
      Object.create(expected),
      { ...expected, extra: true },
      accessor,
      {
        ...expected,
        descriptor: { ...expected.descriptor, outputFormatVersion: "2" },
      },
      { ...expected, descriptor: null },
      { ...expected, manifestSha256: "A".repeat(64) },
      new Proxy(expected, {
        ownKeys() {
          throw new Error("private detail");
        },
      }),
    ];
    for (const candidate of candidates)
      expect(
        await parseRitualBundleManifest(
          JSON.stringify(value),
          candidate as ExpectedRitualBundleManifest,
        ),
      ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { bytes: 0 },
    { bytes: -1 },
    { bytes: 1.5 },
    { bytes: "1" },
    { bytes: null },
    { mime: "image/avif" },
    { mime: "IMAGE/PNG" },
    { purpose: "source" },
    { sha256: "A".repeat(64) },
    { reference: "" },
    { reference: "/image#fragment" },
    { reference: "\ud800" },
    { reference: 1 },
    { extra: "provider" },
  ])("rejects invalid asset facts %j", async (patch) => {
    const value = fixture();
    expect(
      await parse(value, {
        ...value,
        assets: [{ ...value.assets[0], ...patch }],
      }),
    ).toBeNull();
  });

  it("rejects duplicate keys/references, unused assets and mismatched asset associations", async () => {
    const value = fixture(["/one.png", "/two.png"]);
    for (const assets of [
      [value.assets[0], { ...value.assets[1], key: value.assets[0].key }],
      [
        value.assets[0],
        { ...value.assets[1], reference: value.assets[0].reference },
      ],
      [
        ...value.assets,
        { ...value.assets[0], key: createUuidV7(), reference: "/unused.png" },
      ],
      [{ ...value.assets[0], reference: "/wrong.png" }, value.assets[1]],
    ])
      expect(await parse(value, { ...value, assets })).toBeNull();
    expect(
      await parse(value, {
        ...value,
        occurrences: value.occurrences.map((row) => ({
          ...row,
          assetKey: value.assets[0].key,
        })),
      }),
    ).toBeNull();
  });

  it.each([
    { path: [99] },
    { path: [-1] },
    { path: [0.5] },
    { path: ["0"] },
    { path: null },
    { path: new Array(129).fill(0) },
    { src: "/wrong.png" },
    { displayFragment: "first" },
    { displayFragment: "#wrong" },
    { assetKey: "bad" },
    { assetKey: "00000000-0000-7000-8000-000000000000" },
    { extra: true },
  ])("rejects wrong occurrence bindings %j", async (patch) => {
    const value = fixture();
    expect(
      await parse(value, {
        ...value,
        occurrences: [
          { ...value.occurrences[0], ...patch },
          value.occurrences[1],
        ],
      }),
    ).toBeNull();
  });

  it("rejects missing, duplicate or extraneous source paths", async () => {
    const value = fixture();
    for (const occurrences of [
      [],
      [value.occurrences[0]],
      [value.occurrences[0], value.occurrences[0]],
      [...value.occurrences, { ...value.occurrences[0], path: [2] }],
    ])
      expect(await parse(value, { ...value, occurrences })).toBeNull();
  });

  it.each([
    { children: [{ type: "stylesheet", href: "/font.css" }] },
    {
      children: [
        { type: "span", style: { backgroundImage: "url(/hidden.png)" } },
      ],
    },
    {
      children: [
        { type: "img", src: "/pics/example.png", srcSet: "/other.png 2x" },
      ],
    },
    { children: [{ type: "cursor" }] },
    { children: "bad" },
    null,
    [],
  ])(
    "rejects incomplete or unsupported rendered structure %j",
    async (tree) => {
      expect(await parse(body(fixture([]), tree))).toBeNull();
    },
  );

  it.each([
    "//example.test/a.png",
    "/a/../b.png",
    "/bad path.png",
    "/bad\\path.png",
    "javascript:alert(1)",
    "/nul\0.png",
  ])(
    "rejects invalid rendering identity %j even when declared as an asset",
    async (ref) => {
      expect(await parse(fixture([ref]))).toBeNull();
    },
  );
});
