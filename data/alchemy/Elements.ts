import type { Elemental, ElementalId } from "./Elementals";
import _elements from "./elements.json5" with { type: "json" };

type ElementId = "earth" | "air" | "fire" | "water";

type LangObject = { en: string };

interface Element {
  id: ElementId;
  name: LangObject;
  symbol: string;
  elementalId: ElementalId;
  elemental?: Elemental;
}

type Elements = {
  [key in ElementId]: Element;
};

const elements: Elements = _elements as Elements;

export type { Element, ElementId, Elements };
export default elements;
