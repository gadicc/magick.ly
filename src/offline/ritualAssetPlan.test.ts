import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ObjectId } from "bson";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExternalRitualImageCatalog } from "../files/externalRitualImageCatalog";
import type { GeneratedRitualImageCatalog } from "../files/generatedRitualImageCatalogTypes";
import {
  createLegacyRitualImageCatalog,
  type LegacyRitualImageCatalog,
  type LegacyRitualImageSource,
} from "../files/legacyRitualImageCatalog";
import type { PrivateRitualImageCatalog } from "../files/privateRitualImageCatalogTypes";
import { formatRitualFileLocator } from "../files/ritualFileLocator";
import {
  createStaticRitualImageCatalog,
  type StaticRitualImageCatalog,
} from "../files/staticRitualImageCatalog";
import * as svgModule from "../files/validateRitualSvg";
import { createUuidV7 } from "../lib/ids";
import { planLegacyFileImport } from "../migration/planLegacyFileImport";
import { parseComponentImageRequest } from "../render/componentImageRequest";
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
const legacyCatalogs: LegacyRitualImageCatalog[] = [];
const externalCatalogs: ExternalRitualImageCatalog[] = [];
const generatedCatalogs: GeneratedRitualImageCatalog[] = [];
const privateCatalogs: PrivateRitualImageCatalog[] = [];
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
  for (const legacy of legacyCatalogs.splice(0)) legacy.dispose();
  for (const external of externalCatalogs.splice(0)) external.dispose();
  for (const generated of generatedCatalogs.splice(0)) generated.dispose();
  for (const privateCatalog of privateCatalogs.splice(0))
    privateCatalog.dispose();
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
async function legacy(bytes: Uint8Array = png, contentType = "image/png") {
  const bucket = "synthetic-legacy-bucket";
  const imported = planLegacyFileImport(
    [
      {
        _id: new ObjectId(),
        sha256: hash(bytes),
        size: bytes.length,
        type: "image",
        mimeType: contentType,
        image: {},
        createdAt: new Date("2014-01-02"),
      },
    ],
    {
      lookup: () => createUuidV7(),
      storageProvider: "r2",
      sourceBucket: bucket,
      sourceObjectKeyPrefix: bucket + "/",
      importedAt: new Date("2026-09-12"),
    },
  );
  const handle = vi.fn(async () => ({
    response: {
      statusCode: 200,
      headers: {
        "content-length": String(bytes.length),
        "content-type": "application/octet-stream",
      },
      body: Readable.from([Buffer.from(bytes)]),
    },
  }));
  const catalog = await createLegacyRitualImageCatalog({
    storage: {
      kind: "r2",
      endpoint:
        "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
      bucket,
      credentials: {
        accessKeyId: "SYNTHETIC",
        secretAccessKey: "synthetic-only",
      },
    },
    sources: [
      {
        file: imported.files[0],
        snapshot: imported.snapshots[0],
      } as LegacyRitualImageSource,
    ],
    requestHandler: { handle },
  });
  legacyCatalogs.push(catalog);
  return { catalog, handle, fileId: imported.files[0].id };
}
// Synthetic capability for plan ownership/identity tests. Native network acquisition
// has its own suite; actual fixed-policy captures are also exercised in corpus acceptance.
function external(
  reference = "https://images.example/image.png",
  replacement = false,
): ExternalRitualImageCatalog {
  const identity = {
    profile: "magickli-external-image-catalog-v1" as const,
    policySha256: "a".repeat(64),
    validationSha256: catalog.metadata.validationSha256,
    entries: [
      {
        kind: "available" as const,
        referenceSha256: hash(reference),
        acquisitionReferenceSha256: hash(
          replacement ? reference + "?replacement" : reference,
        ),
        representation: replacement
          ? ("same-file-standard-thumbnail" as const)
          : ("original" as const),
        sha256: hash(png),
        bytes: png.length,
        validationKind: "raster" as const,
        mime: "image/png" as const,
        width: 3,
        frameHeight: 2,
        frames: 1,
        decodedPixels: 6,
      },
    ],
  };
  let captured: Uint8Array | null = new Uint8Array(png);
  const result = {
    metadata: { ...identity, sha256: hash(JSON.stringify(identity)) },
    copyBytes: (sha256: string) =>
      captured && sha256 === hash(reference) ? new Uint8Array(captured) : null,
    dispose: () => {
      captured?.fill(0);
      captured = null;
    },
  };
  externalCatalogs.push(result);
  return result;
}

function privateCatalog(reference: string): PrivateRitualImageCatalog {
  const locator = new URL(reference, "https://magick.ly").searchParams;
  const entry = {
    kind: "available" as const,
    referenceSha256: hash(reference),
    ritualId: locator.get("ritualId")!,
    attachmentId: locator.get("attachmentId")!,
    fileId: locator.get("id")!,
    sourceSha256: hash(png),
    sha256: hash(png),
    bytes: png.length,
    validationKind: "raster" as const,
    mime: "image/png" as const,
    width: 3,
    frameHeight: 2,
    frames: 1,
    decodedPixels: 6,
  };
  const identity = {
    profile: "magickli-private-ritual-image-catalog-v1" as const,
    validationSha256: catalog.metadata.validationSha256,
    entries: [entry],
  };
  let captured: Uint8Array | null = Uint8Array.from(png);
  const result = {
    metadata: { ...identity, sha256: hash(JSON.stringify(identity)) },
    copyBytes: (referenceSha256: string) =>
      captured && referenceSha256 === entry.referenceSha256
        ? Uint8Array.from(captured)
        : null,
    dispose: () => {
      captured?.fill(0);
      captured = null;
    },
  };
  privateCatalogs.push(result);
  return result;
}

// A captured-byte capability keeps plan tests separate from the renderer's own
// real-font/native-codec suite. Requests use the production closed parser.
function generated(
  references = ["/api/render/tree-of-life?fmt=png&field=name.roman"],
): GeneratedRitualImageCatalog {
  const entries = references.map((reference) => {
    const request = parseComponentImageRequest(
      "tree-of-life",
      new URL(reference, "https://magick.ly").searchParams,
    );
    const staticEntry = catalog.metadata.entries.find(
      (entry) =>
        entry.pathname ===
        (request.format === "svg" ? "/pics/diagram.svg" : "/pics/image.png"),
    )!;
    if (staticEntry.kind !== "available") throw Error("Missing fixture image");
    const {
      kind: _kind,
      pathname: _path,
      canonicalPathname: _canonical,
      ...facts
    } = staticEntry;
    return {
      ...facts,
      kind: "available" as const,
      referenceSha256: hash(reference),
      sourceSha256: hash("synthetic JSX " + JSON.stringify(request.props)),
      request,
      renderer: {
        profile: "magickli-tree-image-outlines-v1" as const,
        resvg: "2.6.2",
        wasmSha256: hash("synthetic WASM"),
        fonts: [{ file: "synthetic-font.ttf", sha256: hash("synthetic font") }],
        defaultFontSize: 16,
      },
    };
  });
  const identity = {
    profile: "magickli-generated-image-catalog-v1" as const,
    validationSha256: catalog.metadata.validationSha256,
    entries,
  };
  const captured = new Map(
    entries.map((entry) => [
      entry.referenceSha256,
      new Uint8Array(entry.request.format === "svg" ? Buffer.from(svg) : png),
    ]),
  );
  const result = {
    metadata: { ...identity, sha256: hash(JSON.stringify(identity)) },
    copyBytes(referenceSha256: string) {
      const bytes = captured.get(referenceSha256);
      return bytes ? new Uint8Array(bytes) : null;
    },
    dispose() {
      for (const bytes of captured.values()) bytes.fill(0);
      captured.clear();
    },
  };
  generatedCatalogs.push(result);
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

it("resolves legacy public snapshots while retaining exact query spelling, origins and per-occurrence fragments", async () => {
  const { catalog: legacyCatalog, handle, fileId } = await legacy();
  const sha256 = hash(png),
    reference = `/api/file2?sha256=${sha256}`;
  const source = doc(
    reference + "#one",
    reference + "#two",
    `/api/file2?%73ha256=${sha256}`,
    `https://magick.ly${reference}`,
    "/pics/image.png",
  );
  const result = await plan(source, { legacyCatalog });
  expect(result.metadata.profile).toBe("magickli-ritual-asset-plan-v5");
  expect(result.metadata.legacyCatalogSha256).toBe(
    legacyCatalog.metadata.sha256,
  );
  expect(result.metadata.resolutionComplete).toBe(true);
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0, 0, 1, 2, 3,
  ]);
  expect(result.metadata.occurrences.map((row) => row.displayFragment)).toEqual(
    ["#one", "#two", "", "", ""],
  );
  expect(result.metadata.assets.map((row) => row.networkReference)).toEqual([
    reference,
    `/api/file2?%73ha256=${sha256}`,
    `https://magick.ly${reference}`,
    "/pics/image.png",
  ]);
  expect(result.metadata.assets[0]).toMatchObject({
    provenance: {
      kind: "legacy-public",
      fileId,
      sourceSha256: legacyCatalog.metadata.entries[0].sourceSha256,
      provenanceSha256: legacyCatalog.metadata.entries[0].provenanceSha256,
    },
    mime: "image/png",
    width: 3,
    frameHeight: 2,
    frames: 1,
  });
  expect(result.metadata.occurrences.map((row) => row.src)).toEqual(
    JSON.parse(source).children.map((row: { src: string }) => row.src),
  );
  expect(handle).toHaveBeenCalledTimes(1); // Catalog acquisition only; planning performs no GET.
});

it("resolves a finalized private locator with its distinct ritual association provenance", async () => {
  const locator = {
    ritualId: createUuidV7(),
    attachmentId: createUuidV7(),
    fileId: createUuidV7(),
  };
  const reference = formatRitualFileLocator(locator);
  const privateImages = privateCatalog(reference);
  const result = await plan(doc(`${reference}#crop`, reference), {
    privateCatalog: privateImages,
  });
  expect(result.metadata).toMatchObject({
    profile: "magickli-ritual-asset-plan-v5",
    inventoryProfile: "magickli-jrt-assets-v3",
    privateCatalogSha256: privateImages.metadata.sha256,
    resolutionComplete: true,
  });
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0, 0,
  ]);
  expect(result.metadata.assets[0]).toMatchObject({
    networkReference: reference,
    sha256: hash(png),
    provenance: { kind: "private-ritual", ...locator, sourceSha256: hash(png) },
    validationKind: "raster",
    mime: "image/png",
  });
  expect(result.copyBytes(0)).toEqual(Uint8Array.from(png));
});

it("keeps private locators incomplete without an exact authorized catalog entry", async () => {
  const reference = formatRitualFileLocator({
    ritualId: createUuidV7(),
    attachmentId: createUuidV7(),
    fileId: createUuidV7(),
  });
  const without = await plan(doc(reference));
  expect(without.metadata.privateCatalogSha256).toBeNull();
  expect(without.metadata.issues[0]?.code).toBe("private-ritual-file-pending");
  const wrong = privateCatalog(reference);
  const available = wrong.metadata.entries[0];
  if (available.kind !== "available") throw Error();
  Object.assign(available, { attachmentId: createUuidV7() });
  const mismatched = await plan(doc(reference), { privateCatalog: wrong });
  expect(mismatched.metadata.resolutionComplete).toBe(false);
  expect(mismatched.metadata.issues[0]?.code).toBe(
    "private-ritual-file-unavailable",
  );
});

it("keeps legacy SVG dependency facts and original bytes without treating them as raster dimensions", async () => {
  const bytes = new TextEncoder().encode(svg),
    { catalog: legacyCatalog } = await legacy(bytes, "image/svg+xml");
  const result = await plan(doc(`/api/file2?sha256=${hash(bytes)}#a`), {
    legacyCatalog,
  });
  expect(result.metadata.assets[0]).toMatchObject({
    validationKind: "svg",
    mime: "image/svg+xml",
    elements: 2,
    embeddedRasters: [],
  });
  expect(result.metadata.assets[0]).not.toHaveProperty("width");
  expect(result.copyBytes(0)).toEqual(bytes);
  expect(Object.isFrozen(result.metadata.assets[0].provenance)).toBe(true);
});

it("retains legacy captures after catalog disposal and clears only its own bytes on plan disposal", async () => {
  const { catalog: legacyCatalog } = await legacy();
  const result = await plan(doc(`/api/file2?sha256=${hash(png)}`), {
    legacyCatalog,
  });
  legacyCatalog.dispose();
  const first = result.copyBytes(0)!;
  first.fill(0);
  const owned = result.copyBytes(0)!;
  expect(owned).toEqual(new Uint8Array(png));
  result.dispose();
  expect(result.copyBytes(0)).toBeNull();
  expect(owned).toEqual(new Uint8Array(png));
});

it("binds the supplied legacy catalog identity even when the document contains no legacy images", async () => {
  const { catalog: legacyCatalog } = await legacy();
  const without = await plan(doc());
  const withLegacy = await plan(doc(), { legacyCatalog });
  expect(without.metadata.legacyCatalogSha256).toBeNull();
  expect(withLegacy.metadata.sha256).not.toBe(without.metadata.sha256);
});

it("snapshots the trusted legacy metadata before yielding", async () => {
  const { catalog: original } = await legacy();
  const metadata = structuredClone(original.metadata);
  const legacyCatalog = { ...original, metadata };
  const pending = plan(doc(`/api/file2?sha256=${hash(png)}`), {
    legacyCatalog,
  });
  Object.assign(metadata, { sha256: "changed", entries: [] });
  const result = await pending;
  expect(result.metadata.legacyCatalogSha256).toBe(original.metadata.sha256);
  expect(result.metadata.resolutionComplete).toBe(true);
});

it("leaves absent, unresolved or disposed legacy snapshots incomplete", async () => {
  const { catalog: available } = await legacy();
  expect(
    (
      await plan(doc(`/api/file2?sha256=${"0".repeat(64)}`), {
        legacyCatalog: available,
      })
    ).metadata.issues[0].code,
  ).toBe("legacy-unavailable");
  const { catalog: unsupported } = await legacy(png, "image/tiff");
  expect(
    (
      await plan(doc(`/api/file2?sha256=${hash(png)}`), {
        legacyCatalog: unsupported,
      })
    ).metadata.resolutionComplete,
  ).toBe(false);
  available.dispose();
  expect(
    (
      await plan(doc(`/api/file2?sha256=${hash(png)}`), {
        legacyCatalog: available,
      })
    ).metadata.issues[0].code,
  ).toBe("legacy-unavailable");
});

it.each(["profile", "validationSha256"] as const)(
  "rejects incompatible legacy %s before copying bytes",
  async (field) => {
    const { catalog: original } = await legacy();
    const copyBytes = vi.fn(original.copyBytes);
    const legacyCatalog = {
      ...original,
      copyBytes,
      metadata: { ...original.metadata, [field]: "unsupported" },
    } as LegacyRitualImageCatalog;
    await expect(
      plan(doc(`/api/file2?sha256=${hash(png)}`), { legacyCatalog }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(copyBytes).not.toHaveBeenCalled();
  },
);

it.each(["size", "digest"])(
  "refuses a legacy snapshot %s mismatch and clears the returned allocation",
  async (mismatch) => {
    const { catalog: original } = await legacy();
    const bytes = new Uint8Array(
      mismatch === "size" ? png.length + 1 : png.length,
    ).fill(1);
    const result = await plan(doc(`/api/file2?sha256=${hash(png)}`), {
      legacyCatalog: { ...original, copyBytes: () => bytes },
    });
    expect(result.metadata.issues[0].code).toBe("legacy-snapshot-mismatch");
    expect(result.metadata.resolutionComplete).toBe(false);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  },
);

it("charges each distinct legacy reference, deduplicates fragments, and clears earlier copies on failure", async () => {
  const { catalog: original } = await legacy();
  const copies: Uint8Array[] = [];
  const legacyCatalog = {
    ...original,
    copyBytes: (sha256: string) => {
      const bytes = original.copyBytes(sha256)!;
      copies.push(bytes);
      return bytes;
    },
  };
  const ref = `/api/file2?sha256=${hash(png)}`;
  expect(
    (
      await plan(doc(ref + "#a", ref + "#b"), {
        legacyCatalog,
        limits: { capturedBytes: png.length },
      })
    ).metadata.resolutionComplete,
  ).toBe(true);
  expect(copies.length).toBe(1);
  copies.length = 0;
  await expect(
    plan(doc(ref, `https://magick.ly${ref}`), {
      legacyCatalog,
      limits: { capturedBytes: png.length },
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  expect(copies.length).toBe(1);
  expect(copies[0].every((byte) => byte === 0)).toBe(true);
});

it("does not let a legacy snapshot resolve a private-file route, foreign origin or unsupported query", async () => {
  const { catalog: legacyCatalog, fileId } = await legacy();
  const result = await plan(
    doc(
      `/api/files/${fileId}`,
      `https://other.example/api/file2?sha256=${hash(png)}`,
      `/api/file2?sha256=${hash(png)}&returnMeta=1`,
    ),
    { legacyCatalog },
  );
  expect(result.metadata.resolutionComplete).toBe(false);
  expect(result.metadata.assets).toEqual([]);
  expect(
    result.metadata.occurrences.every((row) => row.assetIndex === null),
  ).toBe(true);
});

it("resolves external captures by the exact original network reference and preserves per-occurrence fragments", async () => {
  const reference = "https://images.example/image.png?x=%20&x=+",
    externalCatalog = external(reference);
  const result = await plan(doc(reference + "#one", reference + "#two"), {
    externalCatalog,
  });
  expect(result.metadata.profile).toBe("magickli-ritual-asset-plan-v5");
  expect(result.metadata.externalCatalogSha256).toBe(
    externalCatalog.metadata.sha256,
  );
  expect(result.metadata.resolutionComplete).toBe(true);
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0, 0,
  ]);
  expect(result.metadata.occurrences.map((row) => row.displayFragment)).toEqual(
    ["#one", "#two"],
  );
  expect(result.metadata.assets[0]).toMatchObject({
    networkReference: reference,
    provenance: {
      kind: "external",
      referenceSha256: hash(reference),
      acquisitionReferenceSha256: hash(reference),
      representation: "original",
      policySha256: externalCatalog.metadata.policySha256,
    },
    mime: "image/png",
    width: 3,
    frameHeight: 2,
    decodedPixels: 6,
  });
});

it("retains explicit replacement provenance without substituting the source or display dimensions", async () => {
  const reference = "https://images.example/800px-image.jpg",
    externalCatalog = external(reference, true);
  const source = JSON.stringify({
    type: "doc",
    children: [{ type: "img", src: reference, width: 450, height: 300 }],
  });
  const result = await plan(source, { externalCatalog });
  expect(result.metadata.assets[0]).toMatchObject({
    networkReference: reference,
    width: 3,
    frameHeight: 2,
    provenance: {
      kind: "external",
      referenceSha256: hash(reference),
      acquisitionReferenceSha256: hash(reference + "?replacement"),
      representation: "same-file-standard-thumbnail",
    },
  });
  expect(result.metadata.occurrences[0].src).toBe(reference);
  expect(JSON.parse(source).children[0]).toMatchObject({
    src: reference,
    width: 450,
    height: 300,
  });
});

it("does not match a normalized/reordered external query or alternate origin", async () => {
  const ref = "https://images.example/image.png?a=1&b=%20",
    externalCatalog = external(ref);
  const result = await plan(
    doc(
      ref,
      ref.replace("a=1&b=%20", "b=%20&a=1"),
      ref.replace("%20", "+"),
      ref.replace("images.example", "other.example"),
    ),
    { externalCatalog },
  );
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0,
    null,
    null,
    null,
  ]);
  expect(result.metadata.issues.map((row) => row.code)).toEqual(
    Array(3).fill("external-unavailable"),
  );
});

it("keeps external byte copies independent of source-catalog and plan disposal", async () => {
  const externalCatalog = external(),
    result = await plan(doc("https://images.example/image.png"), {
      externalCatalog,
    });
  externalCatalog.dispose();
  const one = result.copyBytes(0)!;
  one.fill(0);
  const retained = result.copyBytes(0);
  expect(retained).toEqual(new Uint8Array(png));
  result.dispose();
  expect(result.copyBytes(0)).toBeNull();
  expect(retained).toEqual(new Uint8Array(png));
});

it("snapshots external metadata before yielding and binds supplied catalog identity even when unused", async () => {
  const externalCatalog = external(),
    expected = structuredClone(externalCatalog.metadata);
  const pending = plan(doc("https://images.example/image.png"), {
    externalCatalog,
  });
  Object.assign(externalCatalog.metadata, { sha256: "changed", entries: [] });
  const result = await pending;
  expect(result.metadata.externalCatalogSha256).toBe(expected.sha256);
  expect(result.metadata.resolutionComplete).toBe(true);
  const without = await plan(doc()),
    withExternal = await plan(doc(), { externalCatalog: external() });
  expect(without.metadata.externalCatalogSha256).toBeNull();
  expect(withExternal.metadata.sha256).not.toBe(without.metadata.sha256);
});

it("keeps missing, refused and disposed external captures incomplete", async () => {
  const externalCatalog = external(),
    reference = "https://images.example/image.png";
  externalCatalog.dispose();
  expect(
    (await plan(doc(reference), { externalCatalog })).metadata.issues[0].code,
  ).toBe("external-unavailable");
  const failed = external();
  Object.assign(failed.metadata, {
    entries: [
      {
        kind: "unresolved",
        referenceSha256: hash(reference),
        reason: "unsafe-address",
      },
    ],
  });
  expect(
    (await plan(doc(reference), { externalCatalog: failed })).metadata
      .resolutionComplete,
  ).toBe(false);
});

it.each(["profile", "validationSha256"] as const)(
  "refuses incompatible external %s without copying",
  async (field) => {
    const externalCatalog = external(),
      copyBytes = vi.fn(externalCatalog.copyBytes);
    Object.assign(externalCatalog.metadata, { [field]: "unsupported" });
    await expect(
      plan(doc("https://images.example/image.png"), {
        externalCatalog: { ...externalCatalog, copyBytes },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(copyBytes).not.toHaveBeenCalled();
  },
);

it.each(["size", "digest"])(
  "checks copied external %s and clears mismatched allocations",
  async (mismatch) => {
    const externalCatalog = external(),
      bytes = new Uint8Array(png.length + (mismatch === "size" ? 1 : 0)).fill(
        1,
      );
    const result = await plan(doc("https://images.example/image.png"), {
      externalCatalog: { ...externalCatalog, copyBytes: () => bytes },
    });
    expect(result.metadata.issues[0].code).toBe("external-snapshot-mismatch");
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  },
);

it("charges external copies against the same aggregate budget as static and inline captures", async () => {
  const externalCatalog = external(),
    copies: Uint8Array[] = [];
  const wrapped = {
    ...externalCatalog,
    copyBytes: (sha: string) => {
      const bytes = externalCatalog.copyBytes(sha)!;
      copies.push(bytes);
      return bytes;
    },
  };
  await expect(
    plan(doc("https://images.example/image.png", "/pics/image.png"), {
      externalCatalog: wrapped,
      limits: { capturedBytes: png.length },
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  expect(copies.length).toBe(1);
  expect(copies[0].every((byte) => byte === 0)).toBe(true);
});

it("resolves exact generated aliases while retaining source URLs, fragments and full provenance", async () => {
  const refs = [
    "/api/treeOfLife?fmt=png&field=name.roman",
    "/api/render/tree-of-life?fmt=png&field=name.roman",
    "https://magick.ly/api/render/tree-of-life?fmt=png&field=name.roman",
    "/api/render/tree-of-life?field=name.roman&fmt=svg",
  ];
  const generatedCatalog = generated(refs),
    source = JSON.stringify({
      type: "doc",
      children: [...refs, refs[1]].map((ref, index) => ({
        type: "img",
        src: ref + "#" + index,
        width: 450,
        height: 300,
      })),
    }),
    original = source,
    copyBytes = vi.fn(generatedCatalog.copyBytes),
    result = await plan(source, {
      generatedCatalog: { ...generatedCatalog, copyBytes },
    });
  expect(result.metadata).toMatchObject({
    profile: "magickli-ritual-asset-plan-v5",
    inventoryProfile: "magickli-jrt-assets-v3",
    generatedCatalogSha256: generatedCatalog.metadata.sha256,
    resolutionComplete: true,
  });
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0, 1, 2, 3, 1,
  ]);
  expect(result.metadata.occurrences.map((row) => row.displayFragment)).toEqual(
    ["#0", "#1", "#2", "#3", "#4"],
  );
  expect(copyBytes.mock.calls.map(([reference]) => reference)).toEqual(
    refs.map(hash),
  );
  for (const [index, reference] of refs.entries()) {
    const entry = generatedCatalog.metadata.entries[index];
    if (entry.kind !== "available") throw Error("Missing fixture image");
    expect(result.metadata.assets[index]).toMatchObject({
      networkReference: reference,
      sha256: entry.sha256,
      bytes: entry.bytes,
      provenance: {
        kind: "generated",
        referenceSha256: hash(reference),
        sourceSha256: entry.sourceSha256,
        request: entry.request,
        renderer: entry.renderer,
      },
      validationKind: index === 3 ? "svg" : "raster",
      mime: index === 3 ? "image/svg+xml" : "image/png",
    });
    expect(result.copyBytes(index)).toEqual(
      new Uint8Array(index === 3 ? Buffer.from(svg) : png),
    );
  }
  expect(result.metadata.occurrences[0].src).toBe(refs[0] + "#0");
  expect(source).toBe(original);
  expect(result.metadata.contentSha256).toBe(hash(original));
  expect(JSON.parse(source).children[0]).toMatchObject({
    width: 450,
    height: 300,
  });
});

it("does not substitute equivalent query spelling, order, route alias or another origin for a generated capture", async () => {
  const reference = "/api/render/tree-of-life?fmt=png&field=name%2Eroman",
    generatedCatalog = generated([reference]),
    copyBytes = vi.fn(generatedCatalog.copyBytes);
  const result = await plan(
    doc(
      reference,
      reference.replace("%2E", "."),
      reference.replace(
        "fmt=png&field=name%2Eroman",
        "field=name%2Eroman&fmt=png",
      ),
      reference.replace("/render/tree-of-life", "/treeOfLife"),
      "https://magick.ly" + reference,
      "https://other.example" + reference,
      "/api/render/rose-sigil?fmt=png",
    ),
    { generatedCatalog: { ...generatedCatalog, copyBytes } },
  );
  expect(result.metadata.occurrences.map((row) => row.assetIndex)).toEqual([
    0,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(result.metadata.issues.map((row) => row.code)).toEqual([
    "unrecognized-local-reference",
    ...Array(4).fill("generated-unavailable"),
    "external-pending",
    "unresolved-reference",
  ]);
  expect(copyBytes).toHaveBeenCalledExactlyOnceWith(hash(reference));
});

it("owns generated byte and nested metadata snapshots independently of both catalog and plan disposal", async () => {
  const reference = "/api/render/tree-of-life?fmt=png&field=name.roman",
    generatedCatalog = generated(),
    expected = structuredClone(generatedCatalog.metadata),
    pending = plan(doc(reference), { generatedCatalog });
  const entry = generatedCatalog.metadata.entries[0];
  if (entry.kind !== "available") throw Error("Missing fixture image");
  entry.request.props.field = "changed after call";
  entry.renderer.fonts[0].sha256 = "changed after call";
  Object.assign(generatedCatalog.metadata, { sha256: "changed", entries: [] });
  const result = await pending;
  const expectedEntry = expected.entries[0];
  if (expectedEntry.kind !== "available") throw Error("Missing fixture image");
  expect(result.metadata.generatedCatalogSha256).toBe(expected.sha256);
  expect(result.metadata.assets[0].provenance).toMatchObject({
    request: expectedEntry.request,
    renderer: expectedEntry.renderer,
  });
  const provenance = result.metadata.assets[0].provenance;
  if (provenance.kind !== "generated")
    throw Error("Missing generated provenance");
  expect(Object.isFrozen(provenance.request.props)).toBe(true);
  expect(Object.isFrozen(provenance.renderer.fonts[0])).toBe(true);
  expect(Object.isFrozen(entry.request.props)).toBe(false);
  generatedCatalog.dispose();
  const one = result.copyBytes(0)!;
  one.fill(0);
  const retained = result.copyBytes(0)!;
  expect(retained).toEqual(new Uint8Array(png));
  result.dispose();
  expect(result.copyBytes(0)).toBeNull();
  expect(retained).toEqual(new Uint8Array(png));
});

it("binds generated catalog identity even when unused and distinguishes absence from changed metadata", async () => {
  const generatedCatalog = generated(),
    without = await plan(doc()),
    first = await plan(doc(), { generatedCatalog });
  expect(without.metadata.generatedCatalogSha256).toBeNull();
  expect(first.metadata.generatedCatalogSha256).toBe(
    generatedCatalog.metadata.sha256,
  );
  expect(first.metadata.sha256).not.toBe(without.metadata.sha256);
  Object.assign(generatedCatalog.metadata, {
    sha256: hash("new capture metadata"),
  });
  const changed = await plan(doc(), { generatedCatalog });
  expect(changed.metadata.generatedCatalogSha256).toBe(
    generatedCatalog.metadata.sha256,
  );
  expect(changed.metadata.sha256).not.toBe(first.metadata.sha256);
});

it.each(["missing", "unresolved", "disposed", "copy-error"])(
  "keeps a %s generated capture unavailable without leaking internal details",
  async (mode) => {
    const generatedCatalog = generated(),
      reference = "/api/render/tree-of-life?fmt=png&field=name.roman";
    if (mode === "missing")
      Object.assign(generatedCatalog.metadata, { entries: [] });
    if (mode === "unresolved")
      Object.assign(generatedCatalog.metadata, {
        entries: [
          {
            kind: "unresolved",
            referenceSha256: hash(reference),
            reason: "render-unavailable",
          },
        ],
      });
    if (mode === "disposed") generatedCatalog.dispose();
    const copyBytes = vi.fn(
      mode === "copy-error"
        ? () => {
            throw Error("private-renderer-detail");
          }
        : generatedCatalog.copyBytes,
    );
    const result = await plan(doc(reference + "#one", reference + "#two"), {
      generatedCatalog: { ...generatedCatalog, copyBytes },
    });
    expect(result.metadata.resolutionComplete).toBe(false);
    expect(result.metadata.assets).toEqual([]);
    expect(result.metadata.issues.map((row) => row.code)).toEqual([
      "generated-unavailable",
      "generated-unavailable",
    ]);
    expect(JSON.stringify(result.metadata.issues)).not.toContain(
      "private-renderer-detail",
    );
    expect(copyBytes).toHaveBeenCalledTimes(
      mode === "missing" || mode === "unresolved" ? 0 : 1,
    );
  },
);

it.each(["profile", "validationSha256"] as const)(
  "rejects incompatible generated %s before copying or resolving any occurrence",
  async (field) => {
    const generatedCatalog = generated(),
      copyBytes = vi.fn(generatedCatalog.copyBytes);
    Object.assign(generatedCatalog.metadata, { [field]: "unsupported" });
    await expect(
      plan(doc(), { generatedCatalog: { ...generatedCatalog, copyBytes } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(copyBytes).not.toHaveBeenCalled();
  },
);

it.each(["size", "digest"])(
  "rejects copied generated %s mismatch and wipes its allocation",
  async (mismatch) => {
    const generatedCatalog = generated(),
      bytes = new Uint8Array(png.length + (mismatch === "size" ? 1 : 0)).fill(
        1,
      );
    const result = await plan(
      doc("/api/render/tree-of-life?fmt=png&field=name.roman"),
      {
        generatedCatalog: { ...generatedCatalog, copyBytes: () => bytes },
      },
    );
    expect(result.metadata.resolutionComplete).toBe(false);
    expect(result.metadata.assets).toEqual([]);
    expect(result.metadata.issues[0].code).toBe("generated-snapshot-mismatch");
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  },
);

it("charges generated snapshots before copying, deduplicates only fragments and wipes prior captures on failure", async () => {
  const refs = [
      "/api/render/tree-of-life?fmt=png&field=name.roman",
      "/api/treeOfLife?fmt=png&field=name.roman",
    ],
    generatedCatalog = generated(refs),
    copies: Uint8Array[] = [],
    copyBytes = vi.fn((referenceSha256: string) => {
      const bytes = generatedCatalog.copyBytes(referenceSha256)!;
      copies.push(bytes);
      return bytes;
    }),
    wrapped = { ...generatedCatalog, copyBytes };
  await expect(
    plan(doc(refs[0]), {
      generatedCatalog: wrapped,
      limits: { capturedBytes: 1 },
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  expect(copyBytes).not.toHaveBeenCalled();
  const exact = await plan(doc(refs[0] + "#one", refs[0] + "#two"), {
    generatedCatalog: wrapped,
    limits: { capturedBytes: png.length },
  });
  expect(exact.metadata.resolutionComplete).toBe(true);
  expect(copyBytes).toHaveBeenCalledTimes(1);
  exact.dispose();
  copies.length = 0;
  copyBytes.mockClear();
  await expect(
    plan(doc(...refs), {
      generatedCatalog: wrapped,
      limits: { capturedBytes: png.length },
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
  expect(copyBytes).toHaveBeenCalledTimes(1);
  expect(copies[0].every((byte) => byte === 0)).toBe(true);
});

it.each(["static", "inline"])(
  "shares the capture budget with an earlier %s image",
  async (kind) => {
    const generatedCatalog = generated(),
      copyBytes = vi.fn(generatedCatalog.copyBytes);
    await expect(
      plan(
        doc(
          kind === "static" ? "/pics/image.png" : data(png, "image/png"),
          "/api/render/tree-of-life?fmt=png&field=name.roman",
        ),
        {
          generatedCatalog: { ...generatedCatalog, copyBytes },
          limits: { capturedBytes: png.length },
        },
      ),
    ).rejects.toMatchObject({ code: "CAPTURE_LIMIT" });
    expect(copyBytes).not.toHaveBeenCalled();
  },
);

it("releases a generated copy when cancellation happens during the capability call", async () => {
  const generatedCatalog = generated(),
    controller = new AbortController(),
    returned = generatedCatalog.copyBytes(
      hash("/api/render/tree-of-life?fmt=png&field=name.roman"),
    )!;
  await expect(
    plan(doc("/api/render/tree-of-life?fmt=png&field=name.roman"), {
      signal: controller.signal,
      generatedCatalog: {
        ...generatedCatalog,
        copyBytes: () => {
          controller.abort();
          return returned;
        },
      },
    }),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(returned.every((byte) => byte === 0)).toBe(true);
});

it("keeps absent/static, protected legacy, external and generated sources explicitly incomplete", async () => {
  const source = doc(
    "/pics/missing.png",
    "/api/file2?sha256=" + "a".repeat(64),
    "https://remote.invalid/private-name.png",
    "/api/treeOfLife?field=name.roman",
    "/api/render/tree-of-life?field=name.roman",
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
