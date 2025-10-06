import { PlanetId } from "../astrology/Planets";
import _alchemySymbols from "./symbols.json5" with { type: "json" };

type AlchemySymbolID =
  | "sulphur"
  | "mercury"
  | "salt"
  | "lead"
  | "tin"
  | "iron"
  | "gold"
  | "copper"
  | "quicksilver"
  | "silver";

interface AlchemySymbol {
  id: AlchemySymbolID;
  symbol: string; // "🜩",
  altSymbol: string; // "♃",
  name: {
    en: string;
  };
  category: "planets" | "principles";
  planetId?: PlanetId;
  gdGrade?: number; // 1,
}

type AlchemySymbols = {
  [key in AlchemySymbolID]: AlchemySymbol;
};

const alchemySymbols: AlchemySymbols = _alchemySymbols as AlchemySymbols;

export type { AlchemySymbol, AlchemySymbolID, AlchemySymbols };
export default alchemySymbols;
