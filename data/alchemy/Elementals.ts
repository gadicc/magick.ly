import type { Element, ElementId } from "./Elements";
import _elementals from "./elementals.json5" with { type: "json" };

type ElementalId = "gnome" | "sylph" | "undine" | "salamander";

type LangObject = { en: string };

interface Elemental {
  id: ElementalId;
  name: LangObject;
  namePlural: LangObject;
  title: LangObject;
  elementId: ElementId;
  element?: Element;
}

type Elementals = {
  [key in ElementalId]: Elemental;
};

const elementals: Elementals = _elementals as Elementals;

export type { Elemental, ElementalId, Elementals };
export default elementals;
