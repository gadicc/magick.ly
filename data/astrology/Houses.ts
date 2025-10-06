import _houses from "./houses.json5" with { type: "json" };
import { Zodiac, ZodiacId } from "./Zodiac";

interface House {
  index: number;
  zodiacId: ZodiacId;
  zodiac?: Zodiac;
}

type Houses = House[];

const houses: Houses = _houses as Houses;

export type { House, Houses };
export default houses;
