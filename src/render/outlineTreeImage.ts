import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { TREE_VIEWBOX } from "./contracts/treeOfLife";

/** Identity of existing generated Tree of Life assets; bytes must not change under it. */
export const TREE_IMAGE_PROFILE = "magickli-tree-image-outlines-v1";
/** The other registered components share the same fonts and normalisation. */
export const COMPONENT_IMAGE_PROFILE = "magickli-component-image-outlines-v1";

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
  try {
    await initWasm(wasm);
  } catch (error) {
    // The package is a server external, so its WASM instance outlives this
    // module when Next reloads it in development; the bytes are the same.
    if (!/Already initialized/.test(String(error))) throw error;
  }
  return {
    fonts,
    identity: {
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

export interface OutlineOptions {
  profile: string;
  /** The root viewBox the component must have rendered. */
  viewBox: readonly [number, number, number, number];
  /** Mirror horizontally after outlining, around the centred coordinates. */
  flip?: boolean;
}

/**
 * Outline trusted registry JSX output only. Never pass uploaded/arbitrary SVG.
 * All font input is bundled; WASM has no filesystem/network font fallback.
 */
export async function outlineComponentImage(
  svg: string,
  options: OutlineOptions,
) {
  let loaded: Awaited<ReturnType<typeof loadResources>>;
  try {
    loaded = await (resources ??= loadResources());
  } catch (error) {
    // A transient read failure must not disable the route until restart.
    resources = undefined;
    throw error;
  }
  const { fonts, identity } = loaded;
  const image = new Resvg(svg, {
    font: {
      fontBuffers: fonts,
      defaultFontFamily: "Noto Sans",
      defaultFontSize: 16,
    },
  });
  try {
    const result = image.toString();
    const originalRoot = svg.match(/<svg\b[^>]*>/)?.[0];
    const outlinedRoot = result.match(/^<svg\b[^>]*>/)?.[0];
    const viewBox = `viewBox="${options.viewBox.join(" ")}"`;
    // usvg preserves this coordinate system but changes implicit image
    // sizing. Retain the original outer attributes without moving the geometry.
    if (
      !originalRoot ||
      !outlinedRoot ||
      !originalRoot.includes(viewBox) ||
      !outlinedRoot.includes(viewBox)
    ) {
      throw new Error("Unexpected component viewport");
    }
    let body = result.slice(outlinedRoot.length);
    // Components repeat link IDs. Outlined images have no link targets;
    // remove those inert IDs instead of weakening the shared SVG validator.
    if (/href=|url\(|<(?:text|style|image)\b/.test(body)) {
      throw new Error("Unexpected component image dependency");
    }
    body = body.replace(/ id="[^"]*"/g, "");
    // usvg leaves invisible textPath carrier geometry after outlining. Nothing
    // references it now; display:none preserves its non-rendering behavior in
    // the existing closed SVG profile, which does not admit visibility.
    body = body.replace(/ visibility="hidden"/g, ' display="none"');
    if (options.flip)
      body = `<g transform="scale(-1 1)">${body.replace(/<\/svg>\s*$/, "</g></svg>")}`;
    const bytes = Buffer.from(originalRoot + body);
    return {
      bytes,
      identity: { profile: options.profile, ...structuredClone(identity) },
      sourceSha256: sha256(Buffer.from(svg)),
    };
  } finally {
    image.free();
  }
}

/** The Tree's existing outline contract, unchanged for saved ritual references. */
export function outlineTreeImage(svg: string, flip: boolean) {
  return outlineComponentImage(svg, {
    profile: TREE_IMAGE_PROFILE,
    viewBox: TREE_VIEWBOX,
    flip,
  });
}
