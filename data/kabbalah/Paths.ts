import { HebrewLetter, HebrewLetterId } from "../HebrewLetters";
import _paths from "./paths.json5" with { type: "json" };

// TODO
type PathId = string;

interface Path {
  id: PathId;
  hermetic: {
    hebrewLetter?: HebrewLetter;
    hebrewLetterId: HebrewLetterId;
    pathNo: number;
    tarotId: string; // TODO
  };
  hebrew: {
    hebrewLetter?: HebrewLetter;
    hebrewLetterId: HebrewLetterId;
  };
}

type Paths = Record<PathId, Path>;

const paths: Paths = _paths as Paths;

export type { Path, PathId, Paths };
export default paths;
