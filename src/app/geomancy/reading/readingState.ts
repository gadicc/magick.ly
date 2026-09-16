import type { PlanetId } from "@/../data/astrology/Planets";
import data from "@/../data/data";
import {
  DEFAULT_MOTHERS,
  mothersFromString,
  mothersToString,
} from "@/render/contracts/astroGeomancyChart";

export interface GeomancyReadingState {
  mothers: (1 | 2)[][];
  /** House number as the select's string value, 1 to 12. */
  house: string;
  planetId: PlanetId;
}

const DEFAULT_HOUSE = "1";
const DEFAULT_PLANET: PlanetId = "luna";
const planetsWithSpirits = new Set(
  Object.values(data.planet)
    .filter((planet) => planet.spiritId)
    .map((planet) => planet.id as PlanetId),
);

/**
 * Restores a shared reading. Anything malformed falls back to the page's
 * defaults rather than casting a new reading, so a link always shows either
 * the shared figures or the untouched starting state.
 */
export function readingFromSearchParams(
  searchParams: URLSearchParams | null,
): GeomancyReadingState {
  let mothers = mothersFromString(DEFAULT_MOTHERS);
  try {
    mothers = mothersFromString(searchParams?.get("m") ?? DEFAULT_MOTHERS);
  } catch {
    // Keep the default reading.
  }
  const house = searchParams?.get("house") ?? DEFAULT_HOUSE;
  const planet = searchParams?.get("planet") ?? DEFAULT_PLANET;
  return {
    mothers,
    house: /^([1-9]|1[0-2])$/.test(house) ? house : DEFAULT_HOUSE,
    planetId: planetsWithSpirits.has(planet as PlanetId)
      ? (planet as PlanetId)
      : DEFAULT_PLANET,
  };
}

/** Query for a share link: the mothers always, house and planet when changed. */
export function readingSearchParams(
  state: GeomancyReadingState,
): URLSearchParams {
  const params = new URLSearchParams({ m: mothersToString(state.mothers) });
  if (state.house !== DEFAULT_HOUSE) params.set("house", state.house);
  if (state.planetId !== DEFAULT_PLANET) params.set("planet", state.planetId);
  return params;
}
