import { ElementId } from "../alchemy/Elements";
import { PlanetId } from "../astrology/Planets";
import { ZodiacId } from "../astrology/Zodiac";
import _tetragrams from "./tetragrams.json5" with { type: "json" };

type TetragramID =
  | "acquisitio"
  | "amissio"
  | "albus"
  | "rubeus"
  | "puella"
  | "puer"
  | "laetitia"
  | "tristitia"
  | "caput_draconis"
  | "cauda_draconis"
  | "populus"
  | "via"
  | "conjunctio"
  | "carcer"
  | "fortuna_minor"
  | "fortuna_major";

type LangObject = { en: string };

interface Tetragram {
  id: TetragramID;
  rows: (1 | 2)[];
  title: LangObject;
  translation: LangObject;
  meaning: LangObject;
  meanings: LangObject[];
  zodiacId: ZodiacId | null;
  elementId: ElementId;
  rulerId: string | string[]; // TODO
  planetId: PlanetId | PlanetId[];
}

type Tetragrams = {
  [key in TetragramID]: Tetragram;
};

const tetragrams: Tetragrams = _tetragrams as Tetragrams;

export type { Tetragram, TetragramID, Tetragrams };
export default tetragrams;
