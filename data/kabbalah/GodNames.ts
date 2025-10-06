import _godNames from "./godNames.json5" with { type: "json" };

type GodNameId =
  | "ehiyeh"
  | "yah"
  | "yhvh-elohim"
  | "el"
  | "elohim-gibor"
  | "yhvh-eloha-vedaat"
  | "yhvh-tzvaot"
  | "elohim-tzvaot"
  | "shadai-el-chai"
  | "adonai-haaretz";

type LangObject = { en: string; he: string; roman: string };

interface GodName {
  id: GodNameId;
  name: LangObject;
}

type GodNames = Record<GodNameId, GodName>;

const godNames: GodNames = _godNames as GodNames;

export type { GodName, GodNameId, GodNames };
export default godNames;
