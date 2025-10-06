import _fourWorlds from "./fourWorlds.json5" with { type: "json" };

type FourWorldId = "atzilut" | "briah" | "yetzirah" | "assiah";

interface FourWorld {
  id: FourWorldId;
  name: { en: string; he: string; roman: string };
  desc: { en: string };
  residentsTitle: { en: string };
}

type FourWorlds = Record<FourWorldId, FourWorld>;

const fourWorlds: FourWorlds = _fourWorlds as FourWorlds;

export type { FourWorld, FourWorldId, FourWorlds };
export default fourWorlds;
