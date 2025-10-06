import _tablets from "./tablets.json5" with { type: "json" };

type EnochianTabletID = "earth" | "air" | "water" | "fire";

type EnochianTablets = {
  [key in EnochianTabletID]: EnochianTablet;
};

interface EnochianTablet {
  id: EnochianTabletID;
  grid: string[][]; // 12x13 grid of letters
}

const tablets: EnochianTablets = _tablets as EnochianTablets;

export default tablets;
export type { EnochianTablet, EnochianTabletID, EnochianTablets };
