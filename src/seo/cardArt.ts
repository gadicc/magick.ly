import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { renderComponentImage } from "@/render/componentImage";
import type { CardArt } from "./cards";

/** The framed art area on the right of a card, in card pixels. */
export const CARD_ART_BOX = { width: 440, height: 510 } as const;

const CONTAIN_MARGIN = 28;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const drawn = new Map<string, Promise<Buffer>>();

/**
 * PNG bytes sized to the art box. Files are read from the repository and
 * diagrams drawn by the closed renderer with their page defaults; nothing
 * depends on a request. Many cards share art (every Sephirah and path shows
 * the Tree), so each distinct art is drawn once per build worker.
 */
export function cardArtPng(art: CardArt): Promise<Buffer> {
  const key = JSON.stringify(art);
  let png = drawn.get(key);
  if (!png) {
    png = drawArt(art);
    // A failure fails this card's build; do not keep it for the next card.
    png.catch(() => drawn.delete(key));
    drawn.set(key, png);
  }
  return png;
}

async function drawArt(art: CardArt): Promise<Buffer> {
  let source: Buffer;
  let fit: "cover" | "contain" = "contain";
  let position: string | undefined;
  if (art.kind === "file") {
    // Read only while the cards prerender; see the OG route's `readAsset`.
    source = await readFile(
      path.join(/*turbopackIgnore: true*/ process.cwd(), art.file),
    );
    fit = art.fit;
    position = art.position;
  } else {
    const params = new URLSearchParams(art.query);
    params.set("fmt", "png");
    params.set("height", String(CARD_ART_BOX.height * 2));
    source = (await renderComponentImage(art.slug, params)).bytes;
  }
  // Contained art keeps a margin inside the frame's rounded corners.
  const margin = fit === "contain" ? CONTAIN_MARGIN : 0;
  // SVG files rasterise at 72 DPI by default; render them large enough to shrink.
  return sharp(source, { density: 288 })
    .resize({
      width: CARD_ART_BOX.width - 2 * margin,
      height: CARD_ART_BOX.height - 2 * margin,
      fit,
      position,
      background: transparent,
    })
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: transparent,
    })
    .png()
    .toBuffer();
}

/** The art as a data URL for `next/og`. */
export async function cardArtDataUrl(art: CardArt): Promise<string> {
  return `data:image/png;base64,${(await cardArtPng(art)).toString("base64")}`;
}
