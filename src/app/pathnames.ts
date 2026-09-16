/**
 * A page title. Titles depend only on the path, so the app bar renders on
 * the server without the query.
 */
export type PathnameValue = string;

/** A section: its own title under "/", and its child paths. */
export interface Pathnames {
  "/": PathnameValue;
  [key: string]: PathnameValue | Pathnames;
}

const pathnames: Pathnames = {
  "/": "Magick.ly",
  about: "About",
  admin: "Admin",
  astrology: {
    "/": "Astrology",
    moon: "Moon Phases",
    "planetary-hours": "Planetary Hours",
    planets: "Planets",
    zodiac: "Zodiac",
  },
  chat: "Chat (MagickGPT)",
  enochian: {
    "/": "Enochian",
    dictionary: "Dictionary",
    keys: "Keys",
    oration: "Oration",
    tablets: "Tablets",
  },
  gd: {
    "/": "Golden Dawn",
    grades: "Grades",
    rituals: "Rituals",
    sigils: "Sigils",
    symbols: {
      "/": "Symbols",
      candlestick: "Seven-Branched Candlestick",
      "fylfot-cross": "Fylfot Cross",
      shewbread: "Table of Shewbread",
    },
  },
  geomancy: {
    "/": "Geomancy",
    reading: "Reading",
    reference: "Reference",
  },
  kabbalah: {
    "/": "Kabbalah",
    yhvh: {
      "/": "Shem HaMephorash",
      "72angels": "72 Angels",
    },
    tree: "Tree of Life",
  },
  study: "Study", // TODO, from pages router
  temples: {
    "/": "Temples",
    admin: "Admin",
  },
};

export default pathnames;
