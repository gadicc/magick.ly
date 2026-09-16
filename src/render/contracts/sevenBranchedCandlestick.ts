import {
  type ComponentImageContract,
  canonicalDimensions,
  type ImageDimensions,
  parseDimensions,
} from "./types";

export const CANDLESTICK_VIEWBOX = [-50, -50, 100, 100] as const;

export type SevenBranchedCandlestickProps = ImageDimensions;

/** Fixed artwork: the only variation is output format and size. */
export const sevenBranchedCandlestick: ComponentImageContract<SevenBranchedCandlestickProps> =
  {
    slug: "seven-branched-candlestick",
    viewBox: CANDLESTICK_VIEWBOX,
    rasterDefault: { width: 1024, height: 1024 },
    keys: [],
    personal: false,
    parse: (searchParams) => parseDimensions(searchParams, CANDLESTICK_VIEWBOX),
    canonicalize: (props) => canonicalDimensions(props),
    filename: () => "seven-branched-candlestick",
  };
