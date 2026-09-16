import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/render/componentImage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/render/componentImage")>();
  render.mockImplementation(actual.renderComponentImage);
  return { renderComponentImage: render };
});

import { CARD_ART_BOX, cardArtDataUrl, cardArtPng } from "./cardArt";

async function size(png: Buffer) {
  const { width, height, format } = await sharp(png).metadata();
  return { width, height, format };
}

async function alphaAt(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
}

describe("card art", () => {
  it("fills the box with a cropped photo", async () => {
    const png = await cardArtPng({
      kind: "file",
      file: "public/pics/planets2013.jpg",
      fit: "cover",
      position: "left",
    });
    expect(await size(png)).toEqual({ ...CARD_ART_BOX, format: "png" });
    expect(await alphaAt(png, 0, 0)).toBe(255);
  });

  it("keeps a transparent margin around contained SVG art", async () => {
    const png = await cardArtPng({
      kind: "file",
      file: "src/goldendawn-logo-squished.svg",
      fit: "contain",
    });
    expect(await size(png)).toEqual({ ...CARD_ART_BOX, format: "png" });
    expect(await alphaAt(png, CARD_ART_BOX.width / 2, 5)).toBe(0);
    expect(await alphaAt(png, CARD_ART_BOX.width / 2, 40)).toBe(255);
  });

  it("draws a diagram at twice the box height, once per art", async () => {
    const art = {
      kind: "diagram",
      slug: "seven-branched-candlestick",
    } as const;
    const [first, second] = await Promise.all([
      cardArtDataUrl(art),
      cardArtDataUrl({ ...art }),
    ]);
    expect(first).toMatch(/^data:image\/png;base64,/);
    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][1].toString()).toBe(
      `fmt=png&height=${CARD_ART_BOX.height * 2}`,
    );
  });

  it("does not keep a failed drawing", async () => {
    const art = {
      kind: "file",
      file: "public/missing.png",
      fit: "cover",
    } as const;
    await expect(cardArtPng(art)).rejects.toThrow();
    await expect(cardArtPng(art)).rejects.toThrow();
  });
});
