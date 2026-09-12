import * as tarotDeck from "tarot-deck";

// These bundled filenames differ from the package's display names.
const rwsImageNames = {
  2: "High_Priestess",
  5: "Hierophant",
  10: "Wheel_of_Fortune",
  12: "Hanged_Man",
};

/** Returns the local Rider-Waite image URL for a major-arcana rank. */
function RWSPath(rank) {
  const card = tarotDeck.getByRank(rank);
  const name = rwsImageNames[card.rank] ?? card.name.replace(/^The /, "");
  return (
    "/tarot/rws/RWS_Tarot_" +
    String(rank).padStart(2, "0") +
    "_" +
    name +
    ".jpg"
  );
}

export { RWSPath, tarotDeck };
