import Data from "@/../data/data";
import { tarotDeck } from "@/tarot";
import type { SeoPage } from "./pages";

/** An indexable page generated from one row of the data set. */
export interface EntityPage extends SeoPage {
  path: string;
}

const MAX_DESCRIPTION = 160;

interface Named {
  name?: { en?: string; he?: string; roman?: string };
}

/**
 * Joins as many correspondences as fit a search snippet, in order, so rows
 * with long names lose their least important fields rather than get cut.
 */
function correspondences(lead: string, fields: (string | false | undefined)[]) {
  let text = `${lead}.`;
  const kept: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    const next = `${lead}: ${[...kept, field].join(", ")}.`;
    if (next.length > MAX_DESCRIPTION) break;
    kept.push(field);
    text = next;
  }
  return text;
}

function own<T>(record: Record<string, T>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/** `/astrology/planet/<id>`, including the Kabbalistic heavens. */
export function planetPage(id: string): EntityPage | null {
  const planet = own(
    Data.planet as Record<
      string,
      (typeof Data.planet)[keyof typeof Data.planet] & {
        godName?: Named;
      }
    >,
    id,
  );
  if (!planet) return null;
  const name = planet.name.en.en ?? id;
  const hebrew = planet.name.he?.he
    ? ` (Hebrew ${planet.name.he.he}, ${planet.name.he.roman})`
    : "";
  return {
    path: `/astrology/planet/${id}`,
    title: `${name}${planet.symbol ? ` ${planet.symbol}` : ""} Correspondences`,
    description: correspondences(`Correspondences of ${name}${hebrew}`, [
      planet.symbol && `symbol ${planet.symbol}`,
      planet.hebrewLetter && `letter ${planet.hebrewLetter.letter.name}`,
      planet.godName?.name?.roman && `god name ${planet.godName.name.roman}`,
      planet.archangel && `archangel ${planet.archangel.name.roman}`,
      planet.intelligenceId &&
        `intelligence ${capitalize(planet.intelligenceId)}`,
      planet.spiritId && `spirit ${capitalize(planet.spiritId)}`,
    ]),
  };
}

/** `/gd/grade/<id>`; the id keeps its `=`, as the sitemap always listed it. */
export function gradePage(id: string): EntityPage | null {
  const grade = own(Data.gdGrade as Record<string, GradeRow>, id);
  if (!grade) return null;
  const numbered = /=/.test(grade.id) ? ` ${grade.id}` : "";
  const place = grade.sephirah
    ? `, attributed to ${grade.sephirah.name.roman} on the Tree of Life`
    : "";
  const element = grade.element?.name?.en
    ? ` and the element of ${grade.element.name.en}`
    : "";
  return {
    path: `/gd/grade/${grade.id}`,
    title: `${grade.name}${numbered} Grade`,
    description: `The ${grade.name}${numbered} grade of the Golden Dawn${place}${element}, with its correspondences.`,
  };
}

type GradeRow = (typeof Data.gdGrade)[keyof typeof Data.gdGrade] & {
  element?: Named;
};

/** `/kabbalah/sephirah/<id>`, including Da'at. */
export function sephirahPage(id: string): EntityPage | null {
  const sephirah = own(
    Data.sephirah as Record<
      string,
      (typeof Data.sephirah)[keyof typeof Data.sephirah] & {
        godName?: Named;
        angelicOrder?: Named;
      }
    >,
    id,
  );
  if (!sephirah) return null;
  const { en, he, roman } = sephirah.name;
  const position = sephirah.index
    ? `Sephirah ${sephirah.index} of the Tree of Life`
    : "a Sephirah of the Tree of Life";
  return {
    path: `/kabbalah/sephirah/${id}`,
    title: `${roman} (${en}) on the Tree of Life`,
    description: correspondences(`${roman} (${he}), "${en}", is ${position}`, [
      sephirah.godName?.name?.roman &&
        `god name ${sephirah.godName.name.roman}`,
      sephirah.archangel?.name.roman &&
        `archangel ${sephirah.archangel.name.roman}`,
      sephirah.angelicOrder?.name?.roman &&
        `angelic host ${sephirah.angelicOrder.name.roman}`,
      sephirah.color && "King and Queen scale colours",
    ]),
  };
}

/** `/kabbalah/path/<from>_<to>`; two paths exist only on the Hebrew tree. */
export function pathPage(id: string): EntityPage | null {
  const path = own(Data.tolPath, id);
  if (!path) return null;
  const [from, to] = path.id
    .split("_")
    .map(Number)
    .map(
      (index) =>
        Object.values(Data.sephirah).find((s) => s.index === index)?.name.roman,
    );
  const joins = `${from}–${to}`;
  const hebrewLetter = path.hebrew?.hebrewLetter?.letter.name;
  const pathNo = path.hermetic?.pathNo;
  if (!pathNo)
    return {
      path: `/kabbalah/path/${id}`,
      title: `Tree of Life Path ${joins}`,
      description: `The path joining ${from} and ${to} exists only on the Hebrew Tree of Life, where it carries the letter ${hebrewLetter}; the Hermetic tree omits it.`,
    };
  const card = tarotDeck.getByRank(Number(path.hermetic.tarotId));
  const hebrew = hebrewLetter ? `; Hebrew attribution: ${hebrewLetter}` : "";
  return {
    path: `/kabbalah/path/${id}`,
    title: `Tree of Life Path ${pathNo}: ${joins}`,
    description: `Path ${pathNo} of the Tree of Life joins ${from} and ${to}. Hermetic attribution: the letter ${path.hermetic.hebrewLetter?.letter.name} and ${card.name}${hebrew}.`,
  };
}

function capitalize(text: string) {
  return text[0].toUpperCase() + text.slice(1);
}

/** Every entity page, in data order, for the sitemap. */
export function entityPages(): EntityPage[] {
  return [
    ...Object.keys(Data.planet).map(planetPage),
    ...Object.keys(Data.gdGrade).map(gradePage),
    ...Object.keys(Data.sephirah).map(sephirahPage),
    ...Object.keys(Data.tolPath).map(pathPage),
  ].filter((page): page is EntityPage => page !== null);
}

/** Static params for a dynamic entity route. */
export function entityIds(
  kind: "planet" | "gdGrade" | "sephirah" | "tolPath",
): { id: string }[] {
  return Object.keys(Data[kind]).map((id) => ({ id }));
}
