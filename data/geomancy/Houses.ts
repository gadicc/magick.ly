import _houses from "./houses.json5" with { type: "json" };

type LangObject = { en: string };

interface House {
  id: number;
  meaning: LangObject;
}

type Houses = House[];

const houses: Houses = _houses as Houses;

export type { House, Houses };
export default houses;
