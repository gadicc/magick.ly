import type { Element, ElementId } from "../alchemy/Elements";
import type {
  TribeOfIsrael,
  TribeOfIsraelId,
} from "../kabbalah/TribesOfIsrael";
import type { Planet, PlanetId } from "./Planets";
import _zodiacs from "./zodiac.json5" with { type: "json" };

type ZodiacId =
  | "aries"
  | "taurus"
  | "gemini"
  | "cancer"
  | "leo"
  | "virgo"
  | "libra"
  | "scorpio"
  | "sagittarius"
  | "capricorn"
  | "aquarius"
  | "pisces";

/*
    no: 1,
    symbol: "♈",
    name: {       en: "Aries",     },
    meaning: {       en: "Ram",     },
    rulesFrom: [        [3, 21],       [4, 19],     ],
    planetId: "mars",
    elementId: "fire",
    quadruplicity: "cardinal",
  },
  */

interface Zodiac {
  id: ZodiacId;
  symbol: string;
  name: { en: string };
  meaning: { en: string };
  rulesFrom: [[number, number], [number, number]];
  planetId: PlanetId;
  planet?: Planet;
  elementId: ElementId;
  element?: Element;
  quadruplicity: "cardinal" | "kerubic" | "mutable";
  tribeOfIsraelId: TribeOfIsraelId;
  tribeOfIsrael?: TribeOfIsrael;
  tetragrammatonPermutation: string;
}

type Zodiacs = {
  [key in ZodiacId]: Zodiac;
};

const zodiacs: Zodiacs = _zodiacs as Zodiacs;

export type { Zodiac, ZodiacId, Zodiacs };
export default zodiacs;
