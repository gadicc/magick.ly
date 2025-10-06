import _alchemyTerms from "./terms.json5" with { type: "json" };

type AlchemyTermID =
  | "sol-philosophorum"
  | "luna-philosophorum"
  | "green-lion"
  | "black-dragon"
  | "king"
  | "queen";

type LangObject = { en: string };
type LangObjectArray = { en: string[] };

interface AlchemyTerm {
  id: AlchemyTermID;
  name: LangObject;
  terms: LangObjectArray;
  gdGrade?: number; // 1,
}

type AlchemyTerms = {
  [key in AlchemyTermID]: AlchemyTerm;
};

const alchemyTerms: AlchemyTerms = _alchemyTerms as AlchemyTerms;

export type { AlchemyTerm, AlchemyTermID, AlchemyTerms };
export default alchemyTerms;
