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

/**
 * Fonts every registry component may use; the Tree's identity lists exactly
 * these. They live under public/ because the interactive Tree's SVG refers to
 * them by URL.
 */
const BASE_FONT_FILES = [
  "NotoSans-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansSymbols-Regular.ttf",
  "NotoSansSymbols2-Regular.ttf",
] as const;
/**
 * Server-only fonts for specific components. They stay outside public/ so the
 * service worker never precaches them and no URL serves them.
 */
export const SERVER_FONT_FILES = [
  "EnochianPlain.ttf",
  "NotoEmoji-Variable.ttf",
] as const;
export type ServerFontFile = (typeof SERVER_FONT_FILES)[number];
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Only names from the two bundled lists resolve; nothing else becomes a path. */
function fontPath(name: string): string {
  if ((BASE_FONT_FILES as readonly string[]).includes(name))
    return path.join(process.cwd(), "public/fonts", name);
  if ((SERVER_FONT_FILES as readonly string[]).includes(name))
    return path.join(process.cwd(), "assets/fonts", name);
  throw new Error(`Unknown bundled font ${name}`);
}

// Each resource caches its own promise and evicts itself on failure, so a
// missing font never discards the WASM instance or other fonts, and
// concurrent first requests share one initialisation.
let wasm: Promise<{ sha256: string }> | undefined;
const fonts = new Map<string, Promise<{ bytes: Buffer; sha256: string }>>();

function loadWasm() {
  wasm ??= (async () => {
    // Treat WASM as a traced server file, not a webpack WASM module. Resolving
    // it from import.meta.url can also retain the build machine's absolute path.
    const bytes = await readFile(
      path.join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
    );
    try {
      await initWasm(bytes);
    } catch (error) {
      // The package is a server external, so its WASM instance outlives this
      // module when Next reloads it in development; the bytes are the same.
      if (!/Already initialized/.test(String(error))) throw error;
    }
    return { sha256: sha256(bytes) };
  })().catch((error) => {
    wasm = undefined;
    throw error;
  });
  return wasm;
}

function loadFont(name: string) {
  let font = fonts.get(name);
  if (!font) {
    font = readFile(fontPath(name))
      .then((bytes) => ({ bytes, sha256: sha256(bytes) }))
      .catch((error) => {
        fonts.delete(name);
        throw error;
      });
    fonts.set(name, font);
  }
  return font;
}

async function loadResources(files: readonly string[]) {
  const [{ sha256: wasmSha256 }, loaded] = await Promise.all([
    loadWasm(),
    Promise.all(files.map(loadFont)),
  ]);
  return {
    fonts: loaded.map((font) => font.bytes),
    fontIdentity: files.map((file, index) => ({
      file,
      sha256: loaded[index].sha256,
    })),
    wasmSha256,
  };
}

export interface OutlineOptions {
  profile: string;
  /** The root viewBox the component must have rendered. */
  viewBox: readonly [number, number, number, number];
  /** Mirror horizontally after outlining, around the centred coordinates. */
  flip?: boolean;
  /**
   * Extra bundled font files after the base set, loaded only for components
   * that need them so other components' glyph fallback never changes.
   */
  fonts?: readonly ServerFontFile[];
}

/**
 * Outline trusted registry JSX output only. Never pass uploaded/arbitrary SVG.
 * All font input is bundled; WASM has no filesystem/network font fallback.
 */
export async function outlineComponentImage(
  svg: string,
  options: OutlineOptions,
) {
  const files = [...BASE_FONT_FILES, ...(options.fonts ?? [])];
  const { fonts, fontIdentity, wasmSha256 } = await loadResources(files);
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
      identity: {
        profile: options.profile,
        resvg: "2.6.2",
        wasmSha256,
        fonts: structuredClone(fontIdentity),
        defaultFontSize: 16,
      },
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
