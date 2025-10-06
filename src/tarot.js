// @ts-expect-error: no types
import tarotDeck from "tarot-deck";

function RWSPath(rank) {
  const card = tarotDeck.getByRank(rank);
  const name = card.name.replace(/^The /, "");
  return (
    "/tarot/rws/RWS_Tarot_" +
    String(rank).padStart(2, "0") +
    "_" +
    name +
    ".jpg"
  );
}

export { RWSPath, tarotDeck };
