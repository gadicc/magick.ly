import _letters from "./letters.json5" with { type: "json" };

type LetterId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "V"
  | "X"
  | "Z";

type EnochianLetters = {
  [key in LetterId]: EnochianLetter;
};

interface EnochianLetter {
  id: LetterId;
  grid: string[][]; // 12x13 grid of letters
}

const letters: EnochianLetters = _letters as EnochianLetters;

export default letters;
export type { EnochianLetter, EnochianLetters, LetterId };
