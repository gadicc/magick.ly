import { SITE_DESCRIPTION, SITE_TITLE } from "./site";

/** A shared-link preview image; relative URLs resolve against the site. */
export interface SocialImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** Search and sharing copy for one indexable URL. */
export interface SeoPage {
  /** Title without the site suffix, which the root layout template adds. */
  title: string;
  /** Search result snippet, about 70 to 160 characters. */
  description: string;
  /** Use the title as-is instead of applying the site suffix. */
  absoluteTitle?: boolean;
  image?: SocialImage;
}

/**
 * Every indexable static route. The sitemap is built from these keys, and a
 * test requires each `page.tsx` to be listed here, be an entity route, or be
 * private.
 */
export const PUBLIC_PAGES = {
  "/": {
    title: SITE_TITLE,
    absoluteTitle: true,
    description: SITE_DESCRIPTION,
  },
  "/about": {
    title: "About",
    description:
      "About Magick.ly, an open source reference app for magickal study with " +
      "MIT-licensed data and components. A reference, not an instruction app.",
  },
  "/astrology": {
    title: "Astrology for Magicians",
    description:
      "Astrology tools for magical work: planetary hours for your location, " +
      "the planets with their Hebrew names, the zodiac signs and moon phases.",
  },
  "/astrology/moon": {
    title: "Moon Phases",
    description:
      "The current moon phase with the dates of the last and next new moon, " +
      "first quarter, full moon and third quarter in your local time.",
  },
  "/astrology/planetary-hours": {
    title: "Planetary Hours Calculator",
    description:
      "Planetary hours for the coming week at your location, with the " +
      "current hour marked and each planet's operations from the Key of Solomon.",
  },
  "/astrology/planets": {
    title: "The Planets: Symbols and Hebrew Names",
    description:
      "The classical planets and Kabbalistic heavens with their symbols and " +
      "English and Hebrew names, plus live Moon phase and Mercury retrograde widgets.",
  },
  "/astrology/zodiac": {
    title: "Zodiac Signs, Meanings and Rulers",
    description:
      "The twelve signs of the zodiac with their symbols, meanings, date " +
      "ranges and ruling planets.",
  },
  "/chat": {
    title: "MagickGPT: Ask an AI About Magick",
    description:
      "Ask MagickGPT, an AI assistant that answers from a library of magickal " +
      "texts and cites its sources. It can make mistakes, so check them.",
  },
  "/enochian": {
    title: "Enochian Magick",
    description:
      "Enochian magick of John Dee and Edward Kelley: the Keys, a dictionary, " +
      "the elemental tablets, Dee's Oration to God and letter flashcards.",
  },
  "/enochian/dictionary": {
    title: "Enochian Dictionary",
    description:
      "A searchable Enochian dictionary with pronunciations, meanings, " +
      "sources and gematria, showing every word in the Enochian script.",
  },
  "/enochian/keys": {
    title: "The Enochian Keys (Calls)",
    description:
      "The Enochian Keys, or Calls, in English, in Enochian or side by side, " +
      "with dictionary lookups for each word.",
  },
  "/enochian/oration": {
    title: "John Dee's Oration to God",
    description:
      "John Dee's Oration to God, to be spoken three times daily, from " +
      "Geoffrey James's The Enochian Magick of Dr. John Dee.",
  },
  "/enochian/tablets": {
    title: "Enochian Elemental Tablets",
    description:
      "The Enochian elemental tablets (Watchtowers) of earth and air, drawn " +
      "in Latin or Enochian letters and exportable as SVG or PNG.",
  },
  "/gd": {
    title: "Golden Dawn",
    description:
      "Hermetic Order of the Golden Dawn resources: the grades on the Tree of " +
      "Life, grade rituals, Rose Cross sigils and temple symbols.",
  },
  "/gd/grades": {
    title: "Golden Dawn Grades",
    description:
      "The grades of the Golden Dawn from Neophyte 0=0 to Ipsissimus 10=1, " +
      "with their places on the Tree of Life.",
  },
  "/gd/rituals": {
    title: "Golden Dawn Rituals",
    description:
      "Golden Dawn grade rituals from Regardie, laid out for phones and " +
      "tablets, plus the private temple rituals you can read when signed in.",
  },
  "/gd/sigils": {
    title: "Rose Cross Sigil Generator",
    description:
      "Trace a sigil for a Hebrew name on the Golden Dawn Rose Cross, " +
      "animated letter by letter and exportable as SVG or PNG.",
  },
  "/gd/symbols": {
    title: "Golden Dawn Temple Symbols",
    description:
      "Golden Dawn temple symbols drawn as vector images: the Fylfot Cross, " +
      "the Seven-Branched Candlestick and the Table of Shewbread.",
  },
  "/gd/symbols/candlestick": {
    title: "Seven-Branched Candlestick",
    description:
      "The Golden Dawn Seven-Branched Candlestick with its planets, their " +
      "angels and Hebrew names, as a downloadable vector image.",
  },
  "/gd/symbols/fylfot-cross": {
    title: "Fylfot Cross of the Elements and Zodiac",
    description:
      "The Golden Dawn Fylfot Cross of the four elements and twelve signs " +
      "around the Sun, with an exercise to place each symbol yourself.",
  },
  "/gd/symbols/shewbread": {
    title: "Table of Shewbread",
    description:
      "The Golden Dawn Table of Shewbread with the twelve signs, the " +
      "permutations of the Tetragrammaton and the tribes of Israel.",
  },
  "/doc/neophyte": {
    title: "Neophyte 0=0 Ritual",
    description:
      "The Golden Dawn Neophyte 0=0 grade ritual as published by Israel " +
      "Regardie, laid out for reading on phones with officer roles.",
  },
  "/doc/zelator": {
    title: "Zelator 1=10 Ritual",
    description:
      "The Golden Dawn Zelator 1=10 grade ritual as published by Israel " +
      "Regardie, laid out for reading on phones with officer roles.",
  },
  "/doc/theoricus": {
    title: "Theoricus 2=9 Ritual",
    description:
      "The Golden Dawn Theoricus 2=9 grade ritual as published by Israel " +
      "Regardie, laid out for reading on phones with officer roles.",
  },
  "/geomancy": {
    title: "Geomancy",
    description:
      "Golden Dawn geomancy: cast a reading with its astrological chart, and " +
      "look up the sixteen geomantic figures and their correspondences.",
  },
  "/geomancy/reading": {
    title: "Geomancy Reading",
    description:
      "Cast a geomantic reading: generate the four mothers, see the figures " +
      "on an astrological chart and read the interpretation for your question.",
  },
  "/geomancy/reference": {
    title: "The Sixteen Geomantic Figures",
    description:
      "The sixteen geomantic figures with their meanings and correspondences, " +
      "sortable by pairs, name or binary value.",
  },
  "/kabbalah": {
    title: "Kabbalah",
    description:
      "Hermetic Kabbalah resources: an interactive Tree of Life with its " +
      "Sephiroth and paths, and the 72 angels of the Shem HaMephorash.",
  },
  "/kabbalah/tree": {
    title: "Kabbalistic Tree of Life",
    description:
      "An interactive Tree of Life: choose the names, colour scale and letter " +
      "attributions shown on each Sephirah and path, then export the diagram.",
    image: {
      url: "/feature/kabbalah/tree.webp?v=2",
      width: 1200,
      height: 630,
      alt: "The Kabbalistic Tree of Life",
    },
  },
  "/kabbalah/yhvh": {
    title: "Shem HaMephorash",
    description:
      "The Shem HaMephorash, the 72-fold name of God drawn from Exodus " +
      "14:19–21, and the 72 angels named after it.",
  },
  "/kabbalah/yhvh/72angels": {
    title: "The 72 Angels of the Shem HaMephorash",
    description:
      "The 72 angels of the Shem HaMephorash with their Hebrew names, dates " +
      "and attributes, from Lazare Lenain's The Science of the Kabbalah.",
  },
  "/study": {
    title: "Magick Flashcards",
    description:
      "Spaced-repetition flashcards for Golden Dawn study: Hebrew letters, " +
      "planetary and zodiac signs, alchemy, Enochian and more.",
  },
} as const satisfies Record<string, SeoPage>;

export type PublicPath = keyof typeof PUBLIC_PAGES;
