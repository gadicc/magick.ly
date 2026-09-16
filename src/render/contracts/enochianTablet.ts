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

export const TABLET_FONTS = ["latin", "enochian"] as const;

export interface EnochianTabletProps extends ImageDimensions {
  id: (typeof TABLET_IDS)[number];
  /** Latin transliteration, or the bundled Enochian Plain glyphs. */
  font: (typeof TABLET_FONTS)[number];
}

/** The grid letters are transliterations; the Enochian font maps them to glyphs. */
export const enochianTablet: ComponentImageContract<EnochianTabletProps> = {
  slug: "enochian-tablet",
  viewBox: TABLET_VIEWBOX,
  rasterDefault: { width: 840, height: 1188 },
  keys: ["id", "font"],
  personal: false,
  parse(searchParams) {
    return {
      id: choice(searchParams.get("id") || "earth", TABLET_IDS),
      font: choice(searchParams.get("font") || "latin", TABLET_FONTS),
      ...parseDimensions(searchParams, TABLET_VIEWBOX),
    };
  },
  canonicalize(props) {
    const pairs: Array<[string, string]> = [];
    if (props.id !== "earth") pairs.push(["id", props.id]);
    if (props.font !== "latin") pairs.push(["font", props.font]);
    return [...pairs, ...canonicalDimensions(props)];
  },
  filename: (props) =>
    `enochian-${props.id}-tablet${props.font === "enochian" ? "-glyphs" : ""}`,
};
