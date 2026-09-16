import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRitualSvgValidator } from "@/files/validateRitualSvg";
import { renderComponentImage } from "./componentImage";
import { COMPONENT_IMAGE_SLUGS, CONTRACTS } from "./contracts";
import {
  COMPONENT_IMAGE_PROFILE,
  TREE_IMAGE_PROFILE,
} from "./outlineTreeImage";
import { COMPONENT_IMAGE_REGISTRY } from "./registry";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const render = (slug: string, query = "") =>
  renderComponentImage(slug, new URLSearchParams(query));
const validate = (bytes: Uint8Array) =>
  createRitualSvgValidator().validate(bytes, new AbortController().signal);

describe("component image registry", () => {
  it("registers exactly the contract slugs", () => {
    expect(Object.keys(COMPONENT_IMAGE_REGISTRY).sort()).toEqual(
      [...COMPONENT_IMAGE_SLUGS].sort(),
    );
    expect(COMPONENT_IMAGE_REGISTRY["tree-of-life"].profile).toBe(
      TREE_IMAGE_PROFILE,
    );
  });

  it("reproduces the published ritual Tree of Life bytes under the unchanged profile", async () => {
    const jade = await readFile("src/doc/2=9.jade", "utf8");
    const reference = jade.match(/\/api\/treeOfLife\?([^"'\s)]+)/)?.[1];
    expect(reference).toBeDefined();
    const image = await render("tree-of-life", reference);
    expect(image.identity.profile).toBe(TREE_IMAGE_PROFILE);
    expect(image.identity.fonts).toHaveLength(5);
    // Recorded in plans/009 from the production build and the generated catalog.
    expect(image.byteSize).toBe(142_962);
    expect(image.sha256).toBe(
      "00c82f49fa8318986a278ec4f3f3ea49520f9ecdae797c12d011e53475ebfef9",
    );
    expect(await validate(image.bytes)).toMatchObject({ status: "validated" });
  });

  // Pinned after visual review of the rasterised output (see plans/027).
  // The path minimums are glyph-coverage floors measured after visual review:
  // every label, symbol and Hebrew letter becomes at least one outlined path,
  // so a font that silently dropped glyphs would fall below them.
  it.each([
    ["astro-geomancy-chart", "", 1024, 1024, 100],
    ["astro-geomancy-chart", "m=2222111122221111&width=256", 256, 256, 100],
    ["enochian-tablet", "", 840, 1188, 300],
    ["enochian-tablet", "id=air&height=297", 210, 297, 300],
    ["seven-branched-candlestick", "", 1024, 1024, 60],
    ["rose-sigil", "text=גדי", 1024, 1024, 26],
    ["rose-sigil", "text=שלום&rose=false&width=200", 200, 200, 1],
  ] as const)(
    "renders %s?%s as validated outlined SVG and a %dx%d PNG",
    async (slug, query, width, height, minimumPaths) => {
      const svg = await render(slug, query);
      expect(svg.contentType).toBe("image/svg+xml");
      expect(svg.identity.profile).toBe(COMPONENT_IMAGE_PROFILE);
      const text = svg.bytes.toString();
      expect(text).not.toMatch(/<text|<style|href=|font-family|<image/);
      expect((text.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(
        minimumPaths,
      );
      expect(text).toContain(`viewBox="${CONTRACTS[slug].viewBox.join(" ")}"`);
      expect(await validate(svg.bytes)).toMatchObject({ status: "validated" });
      const again = await render(slug, query);
      expect(again.sha256).toBe(svg.sha256);
      const png = await render(slug, `fmt=png${query ? `&${query}` : ""}`);
      expect(png.contentType).toBe("image/png");
      const decoded = await sharp(png.bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(decoded.info).toMatchObject({ width, height, channels: 4 });
      expect(png.sourceSha256).toBe(svg.sourceSha256);
    },
  );

  it("draws different geomancy readings and sigils differently", async () => {
    const a = await render("astro-geomancy-chart", "m=1111111111111111");
    const b = await render("astro-geomancy-chart", "m=2222222222222222");
    expect(a.sha256).not.toBe(b.sha256);
    const rose = await render("rose-sigil", "text=אב");
    const bare = await render("rose-sigil", "text=אב&rose=false");
    expect(rose.byteSize).toBeGreaterThan(bare.byteSize);
    expect(hash(rose.bytes)).toBe(rose.sha256);
  });
});
