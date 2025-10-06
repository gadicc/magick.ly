import type { Planet, PlanetId } from "../astrology/Planets";
import _archangels from "./archangels.json5" with { type: "json" };

type ArchangelId =
  | "kassiel"
  | "sachiel"
  | "zamael"
  | "michael"
  | "anael"
  | "raphael"
  | "gabriel"
  | "uriel";

type LangObject = { he: string; roman: string };

interface Archangel {
  id: ArchangelId;
  name: LangObject;
  planetId: PlanetId;
  planet?: Planet;
  sephirahId?: string;
}

type Archangels = Record<ArchangelId, Archangel>;

const archangels: Archangels = _archangels as Archangels;

export type { Archangel, ArchangelId, Archangels };
export default archangels;
