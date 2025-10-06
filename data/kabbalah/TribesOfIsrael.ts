import _tribesOfIsrael from "./tribesOfIsrael.json5" with { type: "json" };

type TribeOfIsraelId =
  | "reuben"
  | "simeon"
  | "levi"
  | "judah"
  | "dan"
  | "naphtali"
  | "gad"
  | "asher"
  | "issachar"
  | "zabulon"
  | "joseph"
  | "benjamin";

type LangObject = { he: string; en: string };

interface TribeOfIsrael {
  id: TribeOfIsraelId;
  name: LangObject;
}

type TribesOfIsrael = Record<TribeOfIsraelId, TribeOfIsrael>;

const tribesOfIsrael: TribesOfIsrael = _tribesOfIsrael as TribesOfIsrael;

export type { TribeOfIsrael, TribeOfIsraelId, TribesOfIsrael };
export default tribesOfIsrael;
