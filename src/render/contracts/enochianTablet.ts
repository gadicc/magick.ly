import {
  type ComponentImageContract,
  canonicalDimensions,
  choice,
  type ImageDimensions,
  parseDimensions,
} from "./types";

/** Only the tablets with drawn sigils and grid data. */
export const TABLET_IDS = ["earth", "air"] as const;
export const TABLET_VIEWBOX = [-105, 0, 210, 297] as const;

export interface EnochianTabletProps extends ImageDimensions {
  id: (typeof TABLET_IDS)[number];
}

/**
 * Latin transliteration only. The Enochian glyph font is a page asset without
 * a bundled TTF or recorded licence, so it is not part of the server contract
 * until that is resolved; a server render must not silently fall back.
 */
export const enochianTablet: ComponentImageContract<EnochianTabletProps> = {
  slug: "enochian-tablet",
  viewBox: TABLET_VIEWBOX,
  rasterDefault: { width: 840, height: 1188 },
  keys: ["id"],
  personal: false,
  parse(searchParams) {
    return {
      id: choice(searchParams.get("id") || "earth", TABLET_IDS),
      ...parseDimensions(searchParams, TABLET_VIEWBOX),
    };
  },
  canonicalize(props) {
    const pairs: Array<[string, string]> = [];
    if (props.id !== "earth") pairs.push(["id", props.id]);
    return [...pairs, ...canonicalDimensions(props)];
  },
  filename: (props) => `enochian-${props.id}-tablet`,
};
