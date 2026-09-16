/**
 * Pure rendering contracts shared by the client link builder and the server
 * renderer. Nothing here may import React components, fonts or native code:
 * the modules ship in client bundles.
 */

export class InvalidComponentImageRequest extends Error {
  constructor() {
    super("Unsupported component image request");
    this.name = "InvalidComponentImageRequest";
  }
}

export function invalid(): never {
  throw new InvalidComponentImageRequest();
}

export function choice<T extends string>(
  value: string,
  allowed: readonly T[],
): T {
  return allowed.includes(value as T) ? (value as T) : invalid();
}

/** Positive integer pixels, at most 4,096 per axis and 4,194,304 in total. */
export const DIMENSION_LIMITS = Object.freeze({
  axis: 4096,
  pixels: 4_194_304,
});

export interface ImageDimensions {
  width?: number;
  height?: number;
}

function dimension(value: string): number {
  if (!/^[1-9]\d{0,3}$/.test(value)) invalid();
  const number = Number(value);
  return number <= DIMENSION_LIMITS.axis ? number : invalid();
}

/**
 * Optional raster dimensions. A single axis scales the other by the viewBox
 * aspect ratio; the derived pair must stay inside the pixel limits. Keys are
 * only present when requested, so request identities stay minimal.
 */
export function parseDimensions(
  searchParams: URLSearchParams,
  viewBox: readonly [number, number, number, number],
): ImageDimensions {
  const dimensions: ImageDimensions = {};
  for (const key of ["width", "height"] as const) {
    const value = searchParams.get(key);
    if (value !== null) dimensions[key] = dimension(value);
  }
  const [, , boxWidth, boxHeight] = viewBox;
  const width =
    dimensions.width ??
    (dimensions.height
      ? Math.ceil((dimensions.height * boxWidth) / boxHeight)
      : boxWidth);
  const height =
    dimensions.height ??
    (dimensions.width
      ? Math.ceil((dimensions.width * boxHeight) / boxWidth)
      : boxHeight);
  if (
    width > DIMENSION_LIMITS.axis ||
    height > DIMENSION_LIMITS.axis ||
    width * height > DIMENSION_LIMITS.pixels
  )
    invalid();
  return dimensions;
}

/** Canonical query pairs for dimensions, after the component's own props. */
export function canonicalDimensions(
  dimensions: ImageDimensions,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (dimensions.width !== undefined)
    pairs.push(["width", String(dimensions.width)]);
  if (dimensions.height !== undefined)
    pairs.push(["height", String(dimensions.height)]);
  return pairs;
}

/**
 * One component's public image contract. `parse` must reject anything the
 * component cannot render deterministically; `canonicalize` must round-trip
 * through `parse` to an identical props object.
 */
export interface ComponentImageContract<Props extends ImageDimensions> {
  /** Stable URL slug: `/api/render/<slug>`. */
  readonly slug: string;
  /** Root `viewBox` the component always renders, checked after outlining. */
  readonly viewBox: readonly [number, number, number, number];
  /**
   * PNG size when the request names neither axis. `null` keeps the viewBox
   * size, which existing saved Tree references depend on.
   */
  readonly rasterDefault: { width: number; height: number } | null;
  /** Query keys the component accepts, besides `fmt`, `width` and `height`. */
  readonly keys: readonly string[];
  /** Carries user-authored state; links need explicit consent and responses are not indexed. */
  readonly personal: boolean;
  parse(searchParams: URLSearchParams): Props;
  /** Ordered query pairs with defaults omitted, except empties that differ from the default. */
  canonicalize(props: Props): Array<[string, string]>;
  /** Download file name without extension. */
  filename(props: Props): string;
}
