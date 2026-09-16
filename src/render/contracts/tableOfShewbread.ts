import {
  type ComponentImageContract,
  canonicalDimensions,
  type ImageDimensions,
  parseDimensions,
} from "./types";

export const SHEWBREAD_VIEWBOX = [-50, -50, 100, 100] as const;

export type TableOfShewbreadProps = ImageDimensions;

/** Fixed artwork; its four emoji need the bundled monochrome Noto Emoji font. */
export const tableOfShewbread: ComponentImageContract<TableOfShewbreadProps> = {
  slug: "table-of-shewbread",
  viewBox: SHEWBREAD_VIEWBOX,
  rasterDefault: { width: 1024, height: 1024 },
  keys: [],
  personal: false,
  parse: (searchParams) => parseDimensions(searchParams, SHEWBREAD_VIEWBOX),
  canonicalize: (props) => canonicalDimensions(props),
  filename: () => "table-of-shewbread",
};
