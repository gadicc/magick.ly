import { astroGeomancyChart } from "./astroGeomancyChart";
import { enochianTablet } from "./enochianTablet";
import { roseSigil } from "./roseSigil";
import { sevenBranchedCandlestick } from "./sevenBranchedCandlestick";
import { tableOfShewbread } from "./tableOfShewbread";
import { treeOfLife } from "./treeOfLife";

/**
 * Every publicly renderable component, keyed by its URL slug. Adding an entry
 * here is a deliberate publication decision: it needs a matching server
 * registry entry with bundled fonts and the contract round-trip tests.
 */
export const CONTRACTS = {
  "tree-of-life": treeOfLife,
  "astro-geomancy-chart": astroGeomancyChart,
  "enochian-tablet": enochianTablet,
  "seven-branched-candlestick": sevenBranchedCandlestick,
  "table-of-shewbread": tableOfShewbread,
  "rose-sigil": roseSigil,
} as const;

export type ComponentImageSlug = keyof typeof CONTRACTS;
export type ComponentImageProps<S extends ComponentImageSlug> = ReturnType<
  (typeof CONTRACTS)[S]["parse"]
>;

export const COMPONENT_IMAGE_SLUGS = Object.freeze(
  Object.keys(CONTRACTS) as ComponentImageSlug[],
);

export function isComponentImageSlug(
  value: string,
): value is ComponentImageSlug {
  return Object.hasOwn(CONTRACTS, value);
}

export {
  type ComponentImageContract,
  InvalidComponentImageRequest,
} from "./types";
