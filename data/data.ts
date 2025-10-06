// biome-ignore assist/source/organizeImports: organized by hand
import planet from "./astrology/Planets";
import zodiac from "./astrology/Zodiac";
import house from "./astrology/Houses";

import chakra from "./chakras.json5" with { type: "json" };
import enochianLetter from "./enochian/Letters";

import gdGrade from "./gd/Grades";

import tetragram from "./geomancy/Tetragrams";
import geomanicHouse from "./geomancy/Houses";

import angelicOrder from "./kabbalah/AngelicOrders";
import archangel from "./kabbalah/Archangels";
import fourWorlds from "./kabbalah/FourWorlds";
import godName from "./kabbalah/GodNames";
import kerub from "./kabbalah/Kerubim";
import tolPath from "./kabbalah/Paths";
import sephirah from "./kabbalah/Sephirot";
import soul from "./kabbalah/souls.json5" with { type: "json" };

import alchemySymbol from "./alchemy/Symbols";
import alchemyTerm from "./alchemy/Terms";
import element from "./alchemy/Elements";
import elemental from "./alchemy/Elementals";

import hebrewLetter from "./HebrewLetters";

const allData = {
  // ASTROLOGY
  planet,
  zodiac,
  house,

  hebrewLetter,

  // ENOCHIAN
  enochianLetter,

  // GEOMANCY
  tetragram,
  geomanicHouse,

  gdGrade,

  // KABBALAH
  archangel,
  angelicOrder,
  fourWorlds,
  godName,
  kerub,
  sephirah,
  tolPath,
  soul,

  chakra,

  // ALCHEMY
  alchemySymbol,
  alchemyTerm,
  element,
  elemental,
};

function insertRefs(row) {
  Object.keys(row).forEach((key) => {
    if (key.substr(key.length - 2) == "Id") {
      const name = key.substr(0, key.length - 2);
      const value = row[key];
      if (allData[name] && allData[name][value]) {
        row[name] = allData[name][value];

        // move to end
        //let tmp = sephirah[key];
        //delete sephirah[key];
        //sephirah[key] = tmp;
      }
    } else if (
      typeof row[key + "Id"] === "undefined" &&
      typeof row[key] === "object"
    ) {
      insertRefs(row[key]);
    }
  });
}

console.log(allData);

for (const [set, data] of Object.entries(allData)) {
  if (Array.isArray(data)) continue;
  if (data) {
    for (const row of Object.values(data)) {
      insertRefs(row);
    }
  } else {
    console.warn("No data for", set);
  }
}

// @ts-expect-error: ok
if (typeof window !== "undefined") window.magickData = allData;

// module.exports = allData;
export default allData;

export { geomanicHouse, tetragram };
