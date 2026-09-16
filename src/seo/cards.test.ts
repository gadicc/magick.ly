import { describe, expect, it } from "vitest";
import { sigilFromSearchParams } from "@/app/gd/sigils/sigilState";
import { socialCards } from "./cardList";
import { socialCard, socialCardImage } from "./cards";
import { entityPages } from "./entities";
import { pageMetadata, seoMetadata } from "./metadata";
import { PUBLIC_PAGES, type PublicPath } from "./pages";

const cardUrls = new Set(
  socialCards().map((card) => `/og/${card.segments.join("/")}`),
);

function imageUrl(metadata: ReturnType<typeof pageMetadata>) {
  const images = metadata.openGraph?.images;
  return (Array.isArray(images) ? images[0] : images) as { url: string };
}

describe("social cards", () => {
  it("names the home card after the site's purpose", () => {
    expect(socialCard("/", "Magick.ly: anything")).toEqual({
      segments: ["home.png"],
      section: "Magick.ly",
      title: "Open Source Magick Reference and Tools",
      art: { kind: "file", file: "public/pentagram.png", fit: "contain" },
    });
  });

  it("mirrors the page path and picks the most specific section", () => {
    expect(socialCard("/gd/grade/0=0", "Neophyte 0=0 Grade")).toMatchObject({
      segments: ["gd", "grade", "0=0.png"],
      section: "Golden Dawn",
      art: { kind: "file", file: "src/goldendawn-logo-squished.svg" },
    });
    expect(socialCard("/gd/symbols/shewbread", "x").art).toEqual({
      kind: "diagram",
      slug: "table-of-shewbread",
    });
    expect(socialCard("/astrology/planet/sol", "x")).toMatchObject({
      section: "Astrology",
      art: { file: "public/pics/planets2013.jpg", position: "left" },
    });
    expect(socialCard("/about", "About").section).toBe("Magick.ly");
    // A prefix only matches whole segments.
    expect(socialCard("/gdx", "x").section).toBe("Magick.ly");
  });

  it("describes the card as a 1200×630 image", () => {
    expect(socialCardImage("/kabbalah/tree", "Tree")).toEqual({
      url: "/og/kabbalah/tree.png",
      width: 1200,
      height: 630,
      alt: "Tree",
    });
  });

  it("draws a card for every image the metadata links", () => {
    for (const path of Object.keys(PUBLIC_PAGES) as PublicPath[])
      expect(cardUrls, path).toContain(imageUrl(pageMetadata(path)).url);
    for (const page of entityPages())
      expect(cardUrls, page.path).toContain(
        imageUrl(seoMetadata(page.path, page)).url,
      );
    // Stored public rituals borrow the rituals list's card.
    expect(cardUrls).toContain("/og/gd/rituals.png");
    expect(cardUrls.size).toBe(socialCards().length);
  });

  it("keeps shared state out of the art", () => {
    const sigil = socialCard("/gd/sigils", "x").art;
    expect(sigil).toEqual({
      kind: "diagram",
      slug: "rose-sigil",
      query: `text=${sigilFromSearchParams(new URLSearchParams()).text}`,
    });
    expect(socialCard("/geomancy/reading", "x").art).toEqual({
      kind: "diagram",
      slug: "astro-geomancy-chart",
    });
  });
});
