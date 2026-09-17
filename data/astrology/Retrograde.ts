import _retrogrades from "./retrograde.json5" with { type: "json" };

type RetrogradeId = "mercury";

/** Start and end dates as [year, month (1-12), day]. */
type RetrogradeList = [[number, number, number], [number, number, number]][];

type Retrogrades = {
  [key in RetrogradeId]: RetrogradeList;
};

const retrogrades: Retrogrades = _retrogrades as Retrogrades;

export type { RetrogradeId, RetrogradeList, Retrogrades };
export default retrogrades;
