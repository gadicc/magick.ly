// import type { AngelicOrder } from "./AngelicOrders";

// type LangObject = { he: string; roman: string };

import _hebrewLetters from "./hebrewLetters.json5" with { type: "json" };

type HebrewLetterId =
  | "aleph"
  | "beth"
  | "gimel"
  | "daleth"
  | "he"
  | "vau"
  | "zayin"
  | "heth"
  | "teth"
  | "yod"
  | "kaph"
  | "lamed"
  | "mem"
  | "nun"
  | "samekh"
  | "ayin"
  | "pe"
  | "tsade"
  | "qoph"
  | "resh"
  | "shin"
  | "tav";

interface HebrewLetter {
  id: HebrewLetterId;
  letter: {
    he: string;
    name: string;
    latin: string;
  };
  index: number;
  value: number;
  meaning: {
    en: string;
  };
}

type HebrewLetters = Record<HebrewLetterId, HebrewLetter>;

const hebrewLetters: HebrewLetters = _hebrewLetters as HebrewLetters;

export type { HebrewLetter, HebrewLetterId, HebrewLetters };
export default hebrewLetters;
