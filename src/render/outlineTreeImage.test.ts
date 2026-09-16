import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRitualSvgValidator } from "@/files/validateRitualSvg";
import { outlineTreeImage, TREE_IMAGE_PROFILE } from "./outlineTreeImage";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const source = (text: string, width = "100%") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170.5 0 341 598" id="TreeOfLife" width="${width}"><style>svg {font-family:'Noto Sans', 'Noto Sans Hebrew'}</style><g id="duplicate"><circle cx="0" cy="100" r="40"/><text x="-25" y="100" fill="red">${text}</text></g><g id="duplicate"><path d="M0 200L10 220"/></g></svg>`;

describe("bundled Tree of Life outlines", () => {
  // These pin accepted shaping, not just nonempty output (which could hide a
  // missing symbol or a .notdef box). Font/engine upgrades require visual review.
  it.each([
    [
      "Hello אבג",
      "507d2e0050c55115bfd40f36540f050cec126584167e3f72bbe764cef87f95ba",
    ],
    [
      "मूलाधार",
      "ae43899790627ec4222a2798c8020f8f8b5125c16aea6d31c9e7c396b65572bc",
    ],
    [
      "🜁🜂🜃🜄",
      "2aedd75512c8ce7dace858621f94f8ed4d1e0f8bc93b36f576fb7a10d5c919d0",
    ],
    [
      "☉☾☿♀♁♂♃♄",
      "3eacec02c87dd7ae5adfaedc95be3f21383d6d8359c720ef15628f9f06930d4b",
    ],
  ])(
    "outlines the existing non-Latin field glyphs: %s",
    async (text, expectedSha256) => {
      const filled = await outlineTreeImage(source(text), false);
      const blank = await outlineTreeImage(source(""), false);
      expect(filled.bytes.length).toBeGreaterThan(blank.bytes.length + 500);
      expect(hash(filled.bytes)).toBe(expectedSha256);
      expect(
        await createRitualSvgValidator().validate(
          filled.bytes,
          new AbortController().signal,
        ),
      ).toMatchObject({ status: "validated" });
    },
  );
  it("keeps Latin/Hebrew glyph outlines without font or link dependencies", async () => {
    const result = await outlineTreeImage(source("Hello אבג"), false);
    const blank = await outlineTreeImage(source(""), false);
    const text = result.bytes.toString();
    expect(text).not.toMatch(/<text|<style|href=|font-family|duplicate/);
    expect(text).toContain('width="100%"');
    expect(text).not.toContain('height="598"');
    expect(text).toContain('viewBox="-170.5 0 341 598"');
    expect(result.bytes.length).toBeGreaterThan(blank.bytes.length + 500);
    expect(
      await createRitualSvgValidator().validate(
        result.bytes,
        new AbortController().signal,
      ),
    ).toMatchObject({ status: "validated" });
  });

  it("is byte deterministic and returns independent output and identity copies", async () => {
    const input = source("אבג 123");
    const first = await outlineTreeImage(input, false);
    const second = await outlineTreeImage(input, false);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sourceSha256).toBe(hash(input));
    expect(first.identity.profile).toBe(TREE_IMAGE_PROFILE);
    first.bytes.fill(0);
    first.identity.fonts[0].sha256 = "changed";
    const third = await outlineTreeImage(input, false);
    expect(third).toEqual(second);
  });

  it("binds the actual installed wasm and exact bundled font bytes", async () => {
    const { identity } = await outlineTreeImage(source("a"), false);
    expect(identity.fonts.map((font) => font.file)).toEqual([
      "NotoSans-Regular.ttf",
      "NotoSansHebrew-Regular.ttf",
      "NotoSansDevanagari-Regular.ttf",
      "NotoSansSymbols-Regular.ttf",
      "NotoSansSymbols2-Regular.ttf",
    ]);
    const require = createRequire(import.meta.url);
    expect(identity.wasmSha256).toBe(
      hash(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
    );
    for (const font of identity.fonts) {
      expect(font.sha256).toBe(
        hash(
          await readFile(path.join(process.cwd(), "public/fonts", font.file)),
        ),
      );
    }
    expect(identity.defaultFontSize).toBe(16);
    expect(identity.resvg).toBe("2.6.2");
  });

  it("mirrors the entire image around the centered viewBox without CSS 3D transforms", async () => {
    const input = source("abc", "200");
    const ordinary = await outlineTreeImage(input, false);
    const flipped = await outlineTreeImage(input, true);
    expect(
      flipped.bytes
        .toString()
        .replace('<g transform="scale(-1 1)">', "")
        .replace(/<\/g><\/svg>\s*$/, "</svg>\n"),
    ).toBe(ordinary.bytes.toString());
    expect(
      await createRitualSvgValidator().validate(
        flipped.bytes,
        new AbortController().signal,
      ),
    ).toMatchObject({ status: "validated" });
  });

  it("rejects an unexpected component viewport instead of shifting shapes", async () => {
    await expect(
      outlineTreeImage(
        source("a").replace("-170.5 0 341 598", "0 0 341 598"),
        false,
      ),
    ).rejects.toThrow("Unexpected component viewport");
  });

  it("rejects output that introduces resource references", async () => {
    const input = source("a").replace(
      "</svg>",
      '<defs><linearGradient id="test"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="0" y="0" width="10" height="10" fill="url(#test)"/></svg>',
    );
    await expect(outlineTreeImage(input, false)).rejects.toThrow(
      "Unexpected component image dependency",
    );
  });

  it("keeps former curved-text carrier paths invisible in the closed SVG profile", async () => {
    const input = source("").replace(
      "</svg>",
      '<path id="arc" visibility="hidden" d="M -80,300 A80,80 0 0 1 80,300"/><text fill="black"><textPath href="#arc">אבג 123</textPath></text></svg>',
    );
    const result = await outlineTreeImage(input, false);
    expect(result.bytes.toString()).toContain('display="none"');
    expect(result.bytes.toString()).not.toContain("visibility=");
    expect(
      await createRitualSvgValidator().validate(
        result.bytes,
        new AbortController().signal,
      ),
    ).toMatchObject({ status: "validated" });
  });
});
