import { Planet, PlanetId } from "../astrology/Planets";
import { AngelicOrder, AngelicOrderId } from "./AngelicOrders";
import { Archangel, ArchangelId } from "./Archangels";
import { GodName, GodNameId } from "./GodNames";
import _sephirot from "./sephirot.json5" with { type: "json" };

type SephirahId =
  | "keter"
  | "chochmah"
  | "binah"
  | "hesed"
  | "gevurah"
  | "tiferet"
  | "netzach"
  | "hod"
  | "yesod"
  | "malchut";

interface Sephirah {
  id: SephirahId;
  index: number;
  name: { en: string; he: string; roman: string };
  color: {
    king: string;
    kingWeb: string;
    kingWebText?: string;
    queen: string;
    queenWeb: string;
    queenWebText: string;
  };
  chakraId: string; // TODO, ChakraId
  godNameId: GodNameId;
  godName?: GodName;
  scent: string;
  body: string;
  bodyPos: string;
  planetId: PlanetId;
  planet?: Planet;
  tenHeavens: { en: string; he: string; roman: string };
  stone: string;
  archangelId: ArchangelId;
  archangel?: Archangel;
  soulId: string;
  angelicOrderId: AngelicOrderId;
  angelicOrder?: AngelicOrder;
  gdGradeId: string;
  next?: SephirahId;
  prev?: SephirahId;
}

type Sephirot = Record<SephirahId, Sephirah>;

const sephirot: Sephirot = _sephirot as Sephirot;

export type { Sephirah, SephirahId, Sephirot };
export default sephirot;
