import { ReadonlyURLSearchParams } from "next/navigation";

export type PathnameValue =
  | string
  | (({
      pathname,
      searchParams,
    }: {
      pathname: string;
      searchParams: ReadonlyURLSearchParams | null;
    }) => string);

const pathnames: {
  [key: string]: PathnameValue | typeof pathnames;
} = {
  "/": "Magick.ly",
  about: "About",
  admin: "Admin",
  astrology: {
    "/": "Astrology",
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
    symbols: "Symbols",
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
