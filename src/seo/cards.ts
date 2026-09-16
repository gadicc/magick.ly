import type { ComponentImageSlug } from "@/render/contracts";
import type { SocialImage } from "./pages";

export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** Card art: a raster or SVG file from the repository, or a closed diagram. */
export type CardArt =
  | {
      kind: "file";
      file: string;
      fit: "cover" | "contain";
      /** Which part of a cropped image to keep; the centre by default. */
      position?: "left" | "right" | "top" | "bottom";
    }
  | { kind: "diagram"; slug: ComponentImageSlug; query?: string };

/** What a page's card shows; the route draws it at build time. */
export interface SocialCard {
  /** Catch-all segments of `/og/...`, ending in `.png`. */
  segments: string[];
  section: string;
  title: string;
  art: CardArt;
}

const file = (
  path: string,
  fit: "cover" | "contain" = "cover",
  position?: "left" | "right" | "top" | "bottom",
): CardArt => ({ kind: "file", file: path, fit, position });

const ART = {
  pentagram: file("public/pentagram.png", "contain"),
  astrology: file("src/app/img/astrology.jpeg"),
  planetaryHours: file("src/app/astrology/img/planetary-hours.webp"),
  // The Sun and the inner planets; a centre crop cuts a label in half.
  planets: file("public/pics/planets2013.jpg", "cover", "left"),
  chat: file("src/app/img/android-magician.png"),
  enochian: file("src/app/img/enochian-angel.webp"),
  enochianKey: file("src/app/enochian/img/enochianFirstKey.png"),
  goldenDawn: file("src/goldendawn-logo-squished.svg", "contain"),
  robes: file("public/pics/Anxfisa_Golden_Dawn_Robes.jpg"),
  geomancy: file("src/app/img/geomancy.webp"),
  geomancyReference: file("src/app/geomancy/img/reference.webp"),
  kabbalah: file("src/app/img/portae_lucis_upsampled.webp"),
  study: file("src/app/img/study.webp"),
  // The page's own defaults, which the Tree page links explicitly.
  tree: {
    kind: "diagram",
    slug: "tree-of-life",
    query: "field=name.roman&bottomText=name.en&fontSize=10",
  },
  tablet: { kind: "diagram", slug: "enochian-tablet" },
  candlestick: { kind: "diagram", slug: "seven-branched-candlestick" },
  shewbread: { kind: "diagram", slug: "table-of-shewbread" },
  // Page defaults only: shared readings and sigils never reach a card.
  geomancyChart: { kind: "diagram", slug: "astro-geomancy-chart" },
  sigil: { kind: "diagram", slug: "rose-sigil", query: "text=גדי" },
} satisfies Record<string, CardArt>;

/** Most specific prefix first; every path matches the final entry. */
const SECTIONS: [prefix: string, section: string, art: CardArt][] = [
  ["/astrology/planetary-hours", "Astrology", ART.planetaryHours],
  ["/astrology/planet", "Astrology", ART.planets],
  ["/astrology", "Astrology", ART.astrology],
  ["/chat", "MagickGPT", ART.chat],
  ["/enochian/keys", "Enochian Magick", ART.enochianKey],
  ["/enochian/tablets", "Enochian Magick", ART.tablet],
  ["/enochian", "Enochian Magick", ART.enochian],
  ["/doc", "Golden Dawn Rituals", ART.robes],
  ["/gd/rituals", "Golden Dawn", ART.robes],
  ["/gd/sigils", "Golden Dawn", ART.sigil],
  ["/gd/symbols/shewbread", "Golden Dawn", ART.shewbread],
  ["/gd/symbols/fylfot-cross", "Golden Dawn", ART.goldenDawn],
  ["/gd/symbols", "Golden Dawn", ART.candlestick],
  ["/gd", "Golden Dawn", ART.goldenDawn],
  ["/geomancy/reading", "Geomancy", ART.geomancyChart],
  ["/geomancy/reference", "Geomancy", ART.geomancyReference],
  ["/geomancy", "Geomancy", ART.geomancy],
  ["/kabbalah/tree", "Kabbalah", ART.tree],
  ["/kabbalah/sephirah", "Kabbalah", ART.tree],
  ["/kabbalah/path", "Kabbalah", ART.tree],
  ["/kabbalah", "Kabbalah", ART.kabbalah],
  ["/study", "Flashcards", ART.study],
  ["/", "Magick.ly", ART.pentagram],
];

function matches(path: string, prefix: string) {
  return prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
}

/** The card for an indexable path and its page title. */
export function socialCard(path: string, title: string): SocialCard {
  const [, section, art] = SECTIONS.find(([prefix]) =>
    matches(path, prefix),
  ) as (typeof SECTIONS)[number];
  const segments = path === "/" ? ["home"] : path.slice(1).split("/");
  segments.push(`${segments.pop()}.png`);
  return {
    segments,
    section,
    // The home page's title already names the site, which the card shows.
    title: path === "/" ? "Open Source Magick Reference and Tools" : title,
    art,
  };
}

/** The `og:image` entry for a page's card. */
export function socialCardImage(path: string, title: string): SocialImage {
  return {
    url: `/og/${socialCard(path, title).segments.join("/")}`,
    ...CARD_SIZE,
    alt: title,
  };
}
