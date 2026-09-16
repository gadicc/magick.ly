import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { socialCards } from "@/seo/cardList";
import { GET, generateStaticParams } from "./route";

function get(segments: string[]) {
  return GET(new Request("https://magick.ly/og"), {
    params: Promise.resolve({ card: segments }),
  });
}

describe("/og/[...card]", () => {
  it("prerenders exactly the listed cards", () => {
    expect(generateStaticParams()).toEqual(
      socialCards().map((card) => ({ card: card.segments })),
    );
  });

  // Short, medium and long titles take different type sizes.
  it.each([
    [["gd", "grade", "1=10.png"]],
    [["kabbalah", "sephirah", "keter.png"]],
    [["kabbalah", "sephirah", "binah.png"]],
  ])("draws %j as a 1200×630 PNG", async (segments) => {
    const response = await get(segments);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await response.arrayBuffer());
    expect(await sharp(png).metadata()).toMatchObject({
      format: "png",
      width: 1200,
      height: 630,
    });
    // IHDR colour type 3: the palette-quantised output, not next/og's RGBA.
    expect(png[25]).toBe(3);
  });

  it("answers 404 for anything else", async () => {
    expect((await get(["gd", "components.png"])).status).toBe(404);
    expect((await get(["doc", "0198f3f0.png"])).status).toBe(404);
  });
});
