import {
  type ComponentImageContract,
  canonicalDimensions,
  type ImageDimensions,
  invalid,
  parseDimensions,
} from "./types";

/** The reading page's initial mothers, first mother first, head row first. */
export const DEFAULT_MOTHERS = "1211111221111212";
export const GEOMANCY_VIEWBOX = [-65, -65, 130, 130] as const;

export interface AstroGeomancyChartProps extends ImageDimensions {
  /** Sixteen characters of 1 (one point) or 2 (two points): four mothers, four rows each. */
  mothers: string;
}

/** Decodes the compact form into the reading page's row arrays. */
export function mothersFromString(mothers: string): (1 | 2)[][] {
  if (!/^[12]{16}$/.test(mothers)) invalid();
  return [0, 1, 2, 3].map((tetragram) =>
    [0, 1, 2, 3].map(
      (row) => (mothers[tetragram * 4 + row] === "2" ? 2 : 1) as 1 | 2,
    ),
  );
}

export function mothersToString(mothers: readonly (readonly (1 | 2)[])[]) {
  return mothers.map((rows) => rows.join("")).join("");
}

/**
 * The chart only depends on the four mothers; every other figure is derived.
 * A link reproduces a reading exactly and never casts a new one.
 */
export const astroGeomancyChart: ComponentImageContract<AstroGeomancyChartProps> =
  {
    slug: "astro-geomancy-chart",
    viewBox: GEOMANCY_VIEWBOX,
    rasterDefault: { width: 1024, height: 1024 },
    keys: ["m"],
    personal: true,
    parse(searchParams) {
      const mothers = searchParams.get("m") ?? DEFAULT_MOTHERS;
      mothersFromString(mothers);
      return { mothers, ...parseDimensions(searchParams, GEOMANCY_VIEWBOX) };
    },
    canonicalize(props) {
      const pairs: Array<[string, string]> = [];
      if (props.mothers !== DEFAULT_MOTHERS) pairs.push(["m", props.mothers]);
      return [...pairs, ...canonicalDimensions(props)];
    },
    filename: (props) => `astro-geomancy-chart-${props.mothers}`,
  };
