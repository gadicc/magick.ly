import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createStaticRitualImageCatalog,
  type StaticRitualImageCatalog,
} from "../files/staticRitualImageCatalog";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  type PreparedRitualBundle,
  prepareRitualBundle,
} from "./prepareRitualBundle";
import { createRitualAssetPlan, type RitualAssetPlan } from "./ritualAssetPlan";
import type { RitualAssetPlanMetadata } from "./ritualAssetPlanTypes";
import { parseRitualBundleManifest } from "./ritualBundleManifest";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

vi.mock("server-only", () => ({}));
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
const inline = (value: Uint8Array | string, mime: string) =>
  `data:${mime};base64,${Buffer.from(value).toString("base64")}`;
let catalog: StaticRitualImageCatalog;
let plan: RitualAssetPlan;
let contentJson: string;
let png: Buffer;
let input: Parameters<typeof prepareRitualBundle>[0];
const prepared: PreparedRitualBundle[] = [];
const plans: RitualAssetPlan[] = [];
beforeEach(async () => {
  catalog = await createStaticRitualImageCatalog({
    publicDirectory: path.resolve("public"),
    paths: [],
  });
  png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const raster = inline(png, "image/png");
  contentJson = JSON.stringify(
    {
      children: [
        { type: "text", value: "\uFEFF e\u0301 é 🌍\r\n" },
        { type: "img", src: raster + "#first" },
        { type: "img", src: inline(svg, "image/svg+xml") },
        { type: "img", src: raster + "#second" },
      ],
    },
    null,
    2,
  );
  plan = await createRitualAssetPlan(contentJson, {
    contentSha256: hash(contentJson),
    knownAppOrigins: [],
    staticCatalog: catalog,
  });
  plans.push(plan);
  const ritualId = createUuidV7();
  input = {
    ritualId,
    title: "\uFEFF  exact e\u0301 title\r\n",
    contentJson,
    descriptor: createRitualRenderDescriptor(
      {
        id: ritualId,
        currentRevisionId: createUuidV7(),
        currentCompiledArtifactId: null,
        version: 2,
      },
      { contentSha256: hash(contentJson) },
    ),
    plan,
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const bundle of prepared.splice(0)) bundle.dispose();
  for (const value of plans.splice(0)) value.dispose();
  catalog.dispose();
});
async function prepare(overrides: Partial<typeof input> = {}) {
  const result = await prepareRitualBundle({ ...input, ...overrides });
  prepared.push(result);
  return result;
}
function altered(change: Partial<RitualAssetPlanMetadata>, rehash = true) {
  const metadata = { ...structuredClone(plan.metadata), ...change };
  if (rehash) {
    const { sha256: _sha, ...identity } = metadata;
    metadata.sha256 = hash(JSON.stringify(identity));
  }
  return {
    metadata,
    copyBytes: vi.fn((index: number) => plan.copyBytes(index)),
    dispose: () => {},
  };
}

it("prepares real PNG/SVG snapshots with exact source and occurrence identities", async () => {
  const result = await prepare();
  expect(result.kind).toBe("prepared");
  expect(result.manifest.title).toBe(input.title);
  expect(result.manifest.renderedJson).toBe(contentJson);
  expect(result.manifest.descriptor).toEqual(input.descriptor);
  expect(result.manifestSha256).toBe(hash(result.manifestJson));
  expect(isUuidV7(result.manifest.bundleId)).toBe(true);
  expect(result.manifest.assets).toHaveLength(2);
  expect(result.manifest.occurrences.map((row) => row.path)).toEqual([
    [1],
    [2],
    [3],
  ]);
  expect(result.manifest.occurrences.map((row) => row.assetKey)).toEqual([
    result.manifest.assets[0].key,
    result.manifest.assets[1].key,
    result.manifest.assets[0].key,
  ]);
  expect(result.manifest.occurrences.map((row) => row.displayFragment)).toEqual(
    ["#first", "", "#second"],
  );
  for (const asset of result.manifest.assets) {
    expect(isUuidV7(asset.key)).toBe(true);
    const bytes = result.copyBytes(asset.key)!;
    expect(hash(bytes)).toBe(asset.sha256);
    expect(bytes.length).toBe(asset.bytes);
  }
  expect(
    await parseRitualBundleManifest(result.manifestJson, {
      manifestSha256: result.manifestSha256,
      bundleId: result.manifest.bundleId,
      ritualId: input.ritualId,
      descriptor: input.descriptor,
    }),
  ).toEqual(result.manifest);
  expect(JSON.parse(result.manifestJson)).not.toHaveProperty("plan");
  expect(result.manifestJson).not.toContain("validationSha256");
  expect(result.manifestJson).not.toContain("sourceSha256");
  expect(plan.metadata.contentSha256).toBe(hash(contentJson));
});

it("preserves reserved IDs and produces the same manifest on a preparation retry", async () => {
  const identity = {
    bundleId: createUuidV7(),
    assetKeys: plan.metadata.assets.map(() => createUuidV7()),
  };
  const a = await prepare({ identity });
  const b = await prepare({ identity });
  expect(a.manifest.bundleId).toBe(identity.bundleId);
  expect(a.manifest.assets.map((row) => row.key)).toEqual(identity.assetKeys);
  expect(b.manifestSha256).toBe(a.manifestSha256);
  expect(b.manifestJson).toBe(a.manifestJson);
});

it("owns copies independently of the plan, caller buffers and disposal", async () => {
  const result = await prepare();
  const key = result.manifest.assets[0].key;
  plan.dispose();
  const first = result.copyBytes(key)!;
  first.fill(0);
  const retained = result.copyBytes(key)!;
  expect(Buffer.from(retained)).toEqual(png);
  result.dispose();
  result.dispose();
  expect(result.copyBytes(key)).toBeNull();
  expect(result.copyBytes("unknown")).toBeNull();
  expect(Buffer.from(retained)).toEqual(png);
});

it("snapshots all inputs before await without freezing caller metadata", async () => {
  const wrapper = altered({});
  const options = {
    ...input,
    descriptor: { ...input.descriptor },
    plan: wrapper,
    identity: {
      bundleId: createUuidV7(),
      assetKeys: plan.metadata.assets.map(() => createUuidV7()),
    },
  };
  const bundleId = options.identity.bundleId;
  const promise = prepareRitualBundle(options);
  options.title = "late";
  options.contentJson = "{}";
  options.ritualId = createUuidV7();
  options.descriptor.contentSha256 = "0".repeat(64);
  options.identity.bundleId = createUuidV7();
  options.identity.assetKeys.fill(createUuidV7());
  Reflect.set(wrapper.metadata.assets[0], "sha256", "f".repeat(64));
  const result = await promise;
  prepared.push(result);
  expect(result.manifest.bundleId).toBe(bundleId);
  expect(result.manifest.title).toBe(input.title);
  expect(result.manifest.renderedJson).toBe(contentJson);
  expect(result.plan.assets[0].sha256).toBe(plan.metadata.assets[0].sha256);
  expect(Object.isFrozen(wrapper.metadata)).toBe(false);
  expect(Object.isFrozen(result.manifest)).toBe(true);
  expect(Object.isFrozen(result.manifest.assets[0])).toBe(true);
  expect(Object.isFrozen(result.plan.assets[0].provenance)).toBe(true);
});

it("supports a complete image-free ritual", async () => {
  const json = '{"children":[{"type":"text","value":"exact"}]}';
  const empty = await createRitualAssetPlan(json, {
    contentSha256: hash(json),
    knownAppOrigins: [],
    staticCatalog: catalog,
  });
  plans.push(empty);
  const result = await prepare({
    contentJson: json,
    descriptor: { ...input.descriptor, contentSha256: hash(json) },
    plan: empty,
  });
  expect(result.manifest.assets).toEqual([]);
  expect(result.manifest.occurrences).toEqual([]);
});

it.each([
  { ritualId: "not-an-id" },
  { title: "\ud800" },
  { title: "x".repeat(65537) },
  { contentJson: "\ud800" },
  { contentJson: "x".repeat(4 * 1024 * 1024 + 1) },
  { timeoutMs: 0 },
  { timeoutMs: 30_001 },
  { timeoutMs: 0.5 },
])(
  "rejects invalid bounded preparation inputs (case %#)",
  async (overrides) => {
    await expect(prepare(overrides)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  },
);

it.each(["bundle", "count", "duplicate", "same-as-bundle", "hole"])(
  "rejects invalid reserved identities: %s",
  async (kind) => {
    const identity = {
      bundleId: createUuidV7(),
      assetKeys: plan.metadata.assets.map(() => createUuidV7()),
    };
    if (kind === "bundle") identity.bundleId = "invalid";
    if (kind === "count") identity.assetKeys.pop();
    if (kind === "duplicate") identity.assetKeys[1] = identity.assetKeys[0];
    if (kind === "same-as-bundle") identity.assetKeys[0] = identity.bundleId;
    if (kind === "hole") delete identity.assetKeys[0];
    await expect(prepare({ identity })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  },
);

it.each([
  { profile: "old" },
  { inventoryProfile: "old" },
  { sha256: "invalid" },
  { validationSha256: "invalid" },
  { assets: null },
  { assets: Array(513).fill({}) },
  { occurrences: null },
  { occurrences: Array(513).fill({}) },
  { issues: null },
])("rejects unsupported/malformed plan metadata (case %#)", async (change) => {
  const wrapper = altered(change as never, false);
  await expect(prepare({ plan: wrapper })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  expect(wrapper.copyBytes).not.toHaveBeenCalled();
});

it.each([
  { resolutionComplete: false },
  { issues: [{ code: "missing", path: [] }] },
])("rejects incomplete plans before copying", async (change) => {
  const wrapper = altered(change);
  await expect(prepare({ plan: wrapper })).rejects.toMatchObject({
    code: "INCOMPLETE",
  });
  expect(wrapper.copyBytes).not.toHaveBeenCalled();
});

it("rejects source/descriptor or plan identity disagreement", async () => {
  await expect(
    prepare({ contentJson: contentJson + " " }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_MISMATCH" });
  await expect(
    prepare({
      descriptor: { ...input.descriptor, contentSha256: "0".repeat(64) },
    }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_MISMATCH" });
  await expect(
    prepare({
      plan: altered({ generatedCatalogSha256: "0".repeat(64) }, false),
    }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_MISMATCH" });
});

it.each([null, -1, 0.5, 2])(
  "rejects an unresolved or invalid asset index %s",
  async (assetIndex) => {
    const wrapper = altered({
      occurrences: plan.metadata.occurrences.map((row, index) =>
        index ? row : { ...row, assetIndex },
      ),
    });
    await expect(prepare({ plan: wrapper })).rejects.toMatchObject({
      code: "INCOMPLETE",
    });
    expect(wrapper.copyBytes).not.toHaveBeenCalled();
  },
);

it("rejects missing occurrence coverage even if plan metadata claims completeness", async () => {
  const wrapper = altered({ occurrences: plan.metadata.occurrences.slice(1) });
  await expect(prepare({ plan: wrapper })).rejects.toMatchObject({
    code: "INCOMPLETE",
  });
  expect(wrapper.copyBytes).not.toHaveBeenCalled();
});

it.each(["missing", "wrong-size", "wrong-hash", "throws"])(
  "wipes earlier owned copies when the next capture fails: %s",
  async (kind) => {
    const copies: Uint8Array[] = [];
    const wrapper = altered({});
    wrapper.copyBytes.mockImplementation((index) => {
      if (index === 1 && kind === "missing") return null;
      if (index === 1 && kind === "throws")
        throw new Error("private provider details");
      const bytes = plan.copyBytes(index)!;
      const result =
        index === 1 && kind === "wrong-size" ? new Uint8Array(1) : bytes;
      if (index === 1 && kind === "wrong-hash") result[0] ^= 1;
      copies.push(result);
      return result;
    });
    await expect(prepare({ plan: wrapper })).rejects.toMatchObject({
      code:
        kind === "missing" || kind === "throws"
          ? "INCOMPLETE"
          : "SNAPSHOT_MISMATCH",
    });
    expect(copies.length).toBeGreaterThan(0);
    for (const bytes of copies)
      expect(bytes.every((value) => value === 0)).toBe(true);
    expect(Buffer.from(plan.copyBytes(0)!)).toEqual(png);
  },
);

it("refuses a disposed source plan", async () => {
  plan.dispose();
  await expect(prepare()).rejects.toMatchObject({ code: "INCOMPLETE" });
});

it("maps malformed noncloneable input to a safe error", async () => {
  const badPlan = altered({});
  Reflect.set(badPlan.metadata, "unexpected", () => "private data");
  await expect(prepare({ plan: badPlan })).rejects.toMatchObject({
    name: "PrepareRitualBundleError",
    code: "INVALID_INPUT",
    message: "INVALID_INPUT",
  });
  await expect(prepare({ descriptor: null as never })).rejects.toMatchObject({
    code: "SNAPSHOT_MISMATCH",
  });
  expect(badPlan.copyBytes).not.toHaveBeenCalled();
});

it("observes cancellation before work, across hashing and during capture", async () => {
  const aborted = AbortSignal.abort();
  await expect(prepare({ signal: aborted })).rejects.toMatchObject({
    code: "ABORTED",
  });
  const duringHash = new AbortController();
  const promise = prepare({ signal: duringHash.signal });
  duringHash.abort();
  await expect(promise).rejects.toMatchObject({ code: "ABORTED" });
  const duringCopy = new AbortController();
  const copies: Uint8Array[] = [];
  const wrapper = altered({});
  wrapper.copyBytes.mockImplementation((index) => {
    const bytes = plan.copyBytes(index)!;
    copies.push(bytes);
    if (index === 1) duringCopy.abort();
    return bytes;
  });
  await expect(
    prepare({ signal: duringCopy.signal, plan: wrapper }),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(copies).toHaveLength(2);
  for (const bytes of copies)
    expect(bytes.every((value) => value === 0)).toBe(true);
});

it("enforces its cooperative deadline and wipes captured bytes", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const copies: Uint8Array[] = [];
  const wrapper = altered({});
  wrapper.copyBytes.mockImplementation((index) => {
    const bytes = plan.copyBytes(index)!;
    copies.push(bytes);
    now = 100;
    return bytes;
  });
  await expect(prepare({ plan: wrapper, timeoutMs: 10 })).rejects.toMatchObject(
    { code: "TIMEOUT" },
  );
  expect(copies).toHaveLength(1);
  expect(copies[0].every((value) => value === 0)).toBe(true);
});
