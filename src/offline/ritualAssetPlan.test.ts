import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createStaticRitualImageCatalog,
  type StaticRitualImageCatalog,
} from "../files/staticRitualImageCatalog";
import * as svgModule from "../files/validateRitualSvg";
import {
  createRitualAssetPlan,
  RITUAL_ASSET_PLAN_LIMITS,
  type RitualAssetPlan,
} from "./ritualAssetPlan";

vi.mock("server-only", () => ({}));
const hash = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path id="a" d="M0 0L1 1"/></svg>';
const data = (bytes: Uint8Array | string, mime = "image/svg+xml") =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const doc = (...sources: string[]) =>
  JSON.stringify({
    type: "doc",
    children: sources.map((src) => ({ type: "img", src })),
  });
let directory: string;
let catalog: StaticRitualImageCatalog;
let png: Buffer;
const plans: RitualAssetPlan[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), "magickli-asset-plan-"));
  await fs.mkdir(path.join(directory, "pics"));
  png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(directory, "pics/image.png"), png);
  await fs.writeFile(path.join(directory, "pics/diagram.svg"), svg);
  catalog = await createStaticRitualImageCatalog({
    publicDirectory: directory,
    paths: ["/pics/image.png", "/pics/diagram.svg", "/pics/missing.png"],
  });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const plan of plans.splice(0)) plan.dispose();
  catalog.dispose();
  await fs.rm(directory, { recursive: true, force: true });
});
async function plan(
  contentJson: string,
  overrides: Partial<Parameters<typeof createRitualAssetPlan>[1]> = {},
) {
  const result = await createRitualAssetPlan(contentJson, {
    contentSha256: hash(contentJson),
    knownAppOrigins: ["https://magick.ly"],
    staticCatalog: catalog,
    ...overrides,
  });
  plans.push(result);
  return result;
}

it("resolves exact references without rewriting query spelling, fragments, paths or archived JSON", async () => {
  const source = doc(
    "/pics/image.png?x=%20&x=+&y=1#first",
    "/pics/image.png?x=%20&x=+&y=1#second",
    "/pics/image.png?y=1&x=%20&x=+",
    "https://magick.ly/pics/diagram.svg#a",
    data(svg) + "#a",
    data(png, "image/png"),
  );
  const original = source;
  const result = await plan(source);
  expect(result.metadata.resolutionComplete).toBe(true);
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0, 0, 1, 2, 3, 4,
  ]);
  expect(result.metadata.assets[0].networkReference).toBe(
    "/pics/image.png?x=%20&x=+&y=1",
  );
  expect(result.metadata.occurrences.map((row) => row.displayFragment)).toEqual(
    ["#first", "#second", "", "#a", "#a", ""],
  );
  expect(result.metadata.occurrences.map((row) => row.path)).toEqual([
    [0],
    [1],
    [2],
    [3],
    [4],
    [5],
  ]);
  expect(result.metadata.assets.map((row) => row.validationKind)).toEqual([
    "raster",
    "raster",
    "svg",
    "svg",
    "raster",
  ]);
  expect(result.copyBytes(0)).toEqual(new Uint8Array(png));
  expect(result.copyBytes(2)).toEqual(new TextEncoder().encode(svg));
  expect(result.copyBytes(3)).toEqual(result.copyBytes(2));
  expect(source).toBe(original);
  for (let i = 0; i < result.metadata.assets.length; i++)
    expect(hash(result.copyBytes(i)!)).toBe(result.metadata.assets[i].sha256);
  expect(result.metadata.assets[3]).not.toHaveProperty("width");
  const { sha256, ...identity } = result.metadata;
  expect(hash(JSON.stringify(identity))).toBe(sha256);
});

it("takes config before awaiting and produces a deterministic deeply frozen identity", async () => {
  const origins = ["https://magick.ly"];
  const limits = { capturedBytes: 2048 };
  const source = doc("https://magick.ly/pics/image.png");
  const pending = plan(source, { knownAppOrigins: origins, limits });
  origins.length = 0;
  limits.capturedBytes = 1;
  const first = await pending;
  expect(first.metadata.resolutionComplete).toBe(true);
  expect(first.metadata).toEqual(
    (await plan(source, { limits: { capturedBytes: 2048 } })).metadata,
  );
  expect(first.metadata.sha256).not.toBe((await plan(source)).metadata.sha256);
  expect(Object.isFrozen(first.metadata.occurrences[0].path)).toBe(true);
  expect(() =>
    Object.assign(first.metadata.assets[0].provenance, { kind: "inline" }),
  ).toThrow();
});

it("owns byte copies independently of the catalog, caller, files and disposal", async () => {
  const result = await plan(doc("/pics/image.png"));
  const owned = result.copyBytes(0)!;
  owned.fill(0);
  await fs.writeFile(path.join(directory, "pics/image.png"), "changed");
  catalog.dispose();
  expect(result.copyBytes(0)).toEqual(new Uint8Array(png));
  const survivingCopy = result.copyBytes(0)!;
  result.dispose();
  result.dispose();
  expect(result.copyBytes(0)).toBeNull();
  expect(survivingCopy).toEqual(new Uint8Array(png));
  for (const index of [-1, 0.5, Infinity, 99, NaN])
    expect(result.copyBytes(index)).toBeNull();
});

it("keeps absent/static, protected legacy, external and generated sources explicitly incomplete", async () => {
  const source = doc(
    "/pics/missing.png",
    "/api/file2?sha256=" + "a".repeat(64),
    "https://remote.invalid/private-name.png",
    "/api/treeOfLife?field=name.roman",
    "/unknown",
    "javascript:invalid",
  );
  const fetch = vi.spyOn(globalThis, "fetch");
  const result = await plan(source);
  expect(result.metadata.resolutionComplete).toBe(false);
  expect(result.metadata.assets).toEqual([]);
  expect(
    result.metadata.occurrences.every((row) => row.assetIndex === null),
  ).toBe(true);
  expect(result.metadata.issues.map((row) => row.code)).toEqual(
    expect.arrayContaining([
      "static-unavailable",
      "legacy-file2-pending",
      "external-pending",
      "generated-tree-of-life-pending",
      "unresolved-reference",
    ]),
  );
  expect(JSON.stringify(result.metadata.issues)).not.toContain("private-name");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not mistake malformed JSON, unsupported styles or hidden metadata images for completeness", async () => {
  expect((await plan("{broken")).metadata.resolutionComplete).toBe(false);
  const source = JSON.stringify({
    type: "doc",
    note: { type: "img", src: "https://private.invalid/not-reachable" },
    children: [
      {
        type: "span",
        style: { backgroundImage: "url(https://private.invalid/css)" },
        children: [],
      },
      { type: "img", src: "/pics/image.png" },
    ],
  });
  const result = await plan(source);
  expect(result.metadata.resolutionComplete).toBe(false);
  expect(result.metadata.assets).toHaveLength(1);
  expect(JSON.stringify(result.metadata)).not.toContain("private.invalid");
  expect((await plan(doc())).metadata.resolutionComplete).toBe(true);
});

it.each([
  ["MIME mismatch", () => data(png, "image/jpeg"), "inline-mime-mismatch"],
  ["bad base64", () => "data:image/png;base64,!!!!", "inline-invalid-base64"],
  [
    "bad framing",
    () => data("not-an-image", "image/png"),
    "inline-unsupported-type",
  ],
  [
    "external SVG",
    () =>
      data(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://private.invalid/secret"/></svg>',
      ),
    "inline-svg-external-resource",
  ],
  [
    "active SVG",
    () =>
      data(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>private-source</script></svg>',
      ),
    "inline-svg-active-content",
  ],
] as const)(
  "retains a safe gap for %s and memoizes its exact reference",
  async (_name, source, code) => {
    const result = await plan(doc(source(), source() + "#fragment"));
    expect(result.metadata.resolutionComplete).toBe(false);
    expect(result.metadata.assets).toEqual([]);
    expect(result.metadata.issues.map((row) => row.code)).toEqual([code, code]);
    expect(JSON.stringify(result.metadata.issues)).not.toMatch(
      /private.invalid|private-source/,
    );
  },
);

it("fully validates and freezes embedded raster evidence in inline SVGs", async () => {
  const embedded = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${data(png, "image/png")}"/></svg>`;
  const result = await plan(doc(data(embedded)));
  const facts = result.metadata.assets[0];
  expect(facts.validationKind).toBe("svg");
  if (facts.validationKind !== "svg") throw Error("Expected SVG");
  expect(facts.embeddedRasters[0]).toMatchObject({
    sha256: hash(png),
    decodedPixels: 6,
  });
  expect(Object.isFrozen(facts.embeddedRasters[0])).toBe(true);
});

it.each([0, -1, Infinity, 1.5, RITUAL_ASSET_PLAN_LIMITS.capturedBytes + 1])(
  "rejects an invalid capture limit %s",
  async (value) => {
    await expect(
      plan(doc(), { limits: { capturedBytes: value } }),
    ).rejects.toMatchObject({ code: "INVALID_LIMITS" });
  },
);
it("rejects unknown limit names and impossible content bindings", async () => {
  await expect(
    plan(doc(), { limits: { extra: 1 } as never }),
  ).rejects.toMatchObject({ code: "INVALID_LIMITS" });
  await expect(plan(doc(), { contentSha256: "bad" })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(
    plan(doc(), { contentSha256: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "CONTENT_MISMATCH" });
  await expect(plan(" ".repeat(4 * 1024 * 1024 + 1))).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(plan("א".repeat(3 * 1024 * 1024))).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(
    plan(doc(), {
      staticCatalog: {
        ...catalog,
        metadata: { ...catalog.metadata, profile: "old" },
      } as never,
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

it("charges exact reference captures once and clears earlier captures on aggregate failure", async () => {
  const seen: Uint8Array[] = [];
  const wrapped = {
    ...catalog,
    copyBytes(name: string) {
      const bytes = catalog.copyBytes(name);
      if (bytes) seen.push(bytes);
      return bytes;
    },
  };
  const single = await plan(
    doc("/pics/image.png#first", "/pics/image.png#second"),
    { limits: { capturedBytes: png.length }, staticCatalog: wrapped },
  );
  expect(single.metadata.resolutionComplete).toBe(true);
  expect(seen).toHaveLength(1);
  single.dispose();
  seen.length = 0;
  await expect(
    plan(doc("/pics/image.png?x=1", "/pics/image.png?x=2"), {
      limits: { capturedBytes: png.length },
      staticCatalog: wrapped,
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  expect(seen).toHaveLength(1);
  expect(seen[0].every((byte) => byte === 0)).toBe(true);
});

it("bounds inline references and aggregate decoded pixels, including embedded rasters", async () => {
  const inline = data(png, "image/png");
  await expect(
    plan(doc(inline, data(svg)), { limits: { inlineImages: 1 } }),
  ).rejects.toMatchObject({ code: "INLINE_LIMIT" });
  const distinct =
    "data:image/png," +
    [...png].map((byte) => "%" + byte.toString(16).padStart(2, "0")).join("");
  const result = await plan(doc(inline, distinct), {
    limits: { inlinePixels: 6 },
  });
  expect(result.metadata.resolutionComplete).toBe(false);
  expect(result.metadata.assets).toHaveLength(1);
  expect(result.metadata.issues[0].code).toBe("inline-pixel-budget-exhausted");
  const embedded = `<svg xmlns="http://www.w3.org/2000/svg"><image href="${inline}"/></svg>`;
  expect(
    (await plan(doc(inline, data(embedded)), { limits: { inlinePixels: 6 } }))
      .metadata.resolutionComplete,
  ).toBe(false);
  expect(
    (await plan(doc(inline), { limits: { capturedBytes: 2 } })).metadata
      .issues[0].code,
  ).toBe("inline-byte-limit");
});

it.each(["disposed", "changed", "error"])(
  "refuses a %s trusted static capability without leaking bytes or errors",
  async (mode) => {
    const bytes = new Uint8Array(png);
    bytes[0] ^= 1;
    const wrapped = {
      ...catalog,
      copyBytes() {
        if (mode === "error") throw Error("private-storage-detail");
        return mode === "disposed" ? null : bytes;
      },
    };
    const result = await plan(doc("/pics/image.png"), {
      staticCatalog: wrapped,
    });
    expect(result.metadata.resolutionComplete).toBe(false);
    expect(JSON.stringify(result.metadata.issues)).not.toContain(
      "private-storage-detail",
    );
    if (mode === "changed")
      expect(bytes.every((byte) => byte === 0)).toBe(true);
  },
);

it("clears returned SVG bytes when cancellation races successful validation", async () => {
  const controller = new AbortController();
  const original = svgModule.createRitualSvgValidator;
  let returned: Uint8Array | undefined;
  vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(
    (limits) => {
      const validator = original(limits);
      return {
        async validate(...args) {
          const result = await validator.validate(...args);
          if (result.status === "validated") returned = result.bytes;
          controller.abort();
          return result;
        },
      };
    },
  );
  await expect(
    plan(doc(data(svg)), { signal: controller.signal }),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(returned?.every((byte) => byte === 0)).toBe(true);
});

it("rejects a pre-aborted operation and releases captures on whole-plan timeout", async () => {
  await expect(
    plan(doc(), { signal: AbortSignal.abort() }),
  ).rejects.toMatchObject({ code: "ABORTED" });
  vi.spyOn(svgModule, "createRitualSvgValidator").mockImplementation(() => ({
    async validate(_bytes, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { status: "refused", code: "ABORTED" };
    },
  }));
  const seen: Uint8Array[] = [];
  const wrapped = {
    ...catalog,
    copyBytes(name: string) {
      const bytes = catalog.copyBytes(name);
      if (bytes) seen.push(bytes);
      return bytes;
    },
  };
  await expect(
    plan(doc("/pics/image.png", data(svg)), {
      limits: { timeoutMs: 25 },
      staticCatalog: wrapped,
    }),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(seen).toHaveLength(1);
  expect(seen[0].every((byte) => byte === 0)).toBe(true);
});

it("reserves failed decode budgets and never allocates another inline image after exhaustion", async () => {
  const inline = data(png, "image/png");
  const exhausted = await plan(doc("/pics/image.png", inline), {
    limits: { capturedBytes: png.length },
  });
  expect(exhausted.metadata.issues[0].code).toBe("capture-budget-exhausted");
  const failed = await plan(doc(data("bad pixels", "image/png"), inline));
  expect(failed.metadata.issues.map((issue) => issue.code)).toEqual([
    "inline-unsupported-type",
    "inline-pixel-budget-exhausted",
  ]);
  const mismatch = await plan(doc(data(png, "image/jpeg"), inline), {
    limits: { inlinePixels: 6 },
  });
  expect(mismatch.metadata.issues.map((issue) => issue.code)).toEqual([
    "inline-mime-mismatch",
    "inline-pixel-budget-exhausted",
  ]);
});
