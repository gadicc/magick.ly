import type { Element, ElementId } from "../alchemy/Elements";
import type { Zodiac, ZodiacId } from "../astrology/Zodiac";
import _kerubim from "./kerubim.json5" with { type: "json" };

type KerubId = "earth" | "air" | "water" | "fire";

interface Kerub {
  id: KerubId;
  title: { en: string };
  face: { en: string; he: string; roman: string };
  zodiacId: ZodiacId;
  zodiac?: Zodiac;
  elementId: ElementId;
  element?: Element;
}

type Kerubim = Record<KerubId, Kerub>;

const kerubim: Kerubim = _kerubim as Kerubim;

export type { Kerub, KerubId, Kerubim };
export default kerubim;
