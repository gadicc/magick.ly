import _retrogrades from "./retrograde.json5" with { type: "json" };

type RetrogradeId = "mercury";

type RetrogradeList = [[number, number, number], [number, number, number]];

type Retrogrades = {
  [key in RetrogradeId]: RetrogradeList;
};

const retrogrades: Retrogrades = _retrogrades as Retrogrades;

export type { RetrogradeId, RetrogradeList, Retrogrades };
export default retrogrades;
