import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

export const TREE_IMAGE_PROFILE = "magickli-tree-image-outlines-v1";

const FONT_FILES = [
  "NotoSans-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansSymbols-Regular.ttf",
  "NotoSansSymbols2-Regular.ttf",
];
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
let resources: ReturnType<typeof loadResources> | undefined;

async function loadResources() {
  const [wasm, ...fonts] = await Promise.all([
    // Treat WASM as a traced server file, not a webpack WASM module. Resolving it
    // from import.meta.url can also retain the build machine's absolute path.
    readFile(
      path.join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
    ),
    ...FONT_FILES.map((name) =>
      readFile(path.join(process.cwd(), "public/fonts", name)),
    ),
  ]);
  await initWasm(wasm);
  return {
    fonts,
    identity: {
      profile: TREE_IMAGE_PROFILE,
      resvg: "2.6.2",
      wasmSha256: sha256(wasm),
      fonts: fonts.map((font, index) => ({
        file: FONT_FILES[index],
        sha256: sha256(font),
      })),
      defaultFontSize: 16,
    },
  };
}

/**
 * Outline trusted TreeOfLife JSX output only. Never pass uploaded/arbitrary SVG.
 * All font input is bundled; WASM has no filesystem/network font fallback.
 */
export async function outlineTreeImage(svg: string, flip: boolean) {
  const { fonts, identity } = await (resources ??= loadResources());
  const tree = new Resvg(svg, {
    font: {
      fontBuffers: fonts,
      defaultFontFamily: "Noto Sans",
      defaultFontSize: 16,
    },
  });
  try {
    const result = tree.toString();
    const originalRoot = svg.match(/<svg\b[^>]*>/)?.[0];
    const outlinedRoot = result.match(/^<svg\b[^>]*>/)?.[0];
    // usvg preserves this centered coordinate system but changes implicit image
    // sizing. Retain the original outer attributes without moving the geometry.
    if (
      !originalRoot ||
      !outlinedRoot ||
      !originalRoot.includes('viewBox="-170.5 0 341 598"') ||
      !outlinedRoot.includes('viewBox="-170.5 0 341 598"')
    ) {
      throw new Error("Unexpected Tree of Life viewport");
    }
    let body = result.slice(outlinedRoot.length);
    // The component repeats link IDs. Outlined images have no link targets;
    // remove those inert IDs instead of weakening the shared SVG validator.
    if (/href=|url\(|<(?:text|style|image)\b/.test(body)) {
      throw new Error("Unexpected Tree of Life image dependency");
    }
    body = body.replace(/ id="[^"]*"/g, "");
    // usvg leaves invisible textPath carrier geometry after outlining. Nothing
    // references it now; display:none preserves its non-rendering behavior in
    // the existing closed SVG profile, which does not admit visibility.
    body = body.replace(/ visibility="hidden"/g, ' display="none"');
    if (flip)
      body = `<g transform="scale(-1 1)">${body.replace(/<\/svg>\s*$/, "</g></svg>")}`;
    const bytes = Buffer.from(originalRoot + body);
    return {
      bytes,
      identity: structuredClone(identity),
      sourceSha256: sha256(Buffer.from(svg)),
    };
  } finally {
    tree.free();
  }
}
