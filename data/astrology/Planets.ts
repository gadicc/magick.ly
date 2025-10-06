import { HebrewLetter, HebrewLetterId } from "../HebrewLetters";
import { Archangel, ArchangelId } from "../kabbalah/Archangels";
import { GodNameId } from "../kabbalah/GodNames";
import _planets from "./planets.json5" with { type: "json" };

type PlanetId =
  | "sol"
  | "mercury"
  | "venus"
  | "earth"
  | "luna"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "rahu"
  | "ketu";

type LangObject = { en?: string; roman?: string; he?: string };

interface Planet {
  id: PlanetId;
  symbol: string;
  hebrewLetterId: HebrewLetterId;
  hebrewLetter?: HebrewLetter;
  name: {
    en: LangObject;
    he: LangObject;
  };
  godNameId: GodNameId;
  archangelId: ArchangelId;
  archangel?: Archangel;
  intelligenceId?: string;
  spiritId?: string;
  magickTypes?: {
    en: string;
  };
}

type Planets = {
  [key in PlanetId]: Planet;
};

const planets: Planets = _planets as Planets;

export type { Planet, PlanetId, Planets };
export default planets;
