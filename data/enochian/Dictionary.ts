import _dictionary from "./dictionary.json5" with { type: "json" };

interface EnochianDictionary {
  [key: string]: {
    gematria: number[];
    meanings: {
      meaning: string;
      source: string;
      source2?: string;
      note?: string;
    }[];
    pronounciations: {
      pronounciation: string;
      source: string;
    }[];
  };
}

const dictionary: EnochianDictionary = _dictionary as EnochianDictionary;

export default dictionary;
