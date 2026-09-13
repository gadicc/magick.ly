/** Public metadata only: importing these types must not load filesystem or decoder code. */
export type StaticRasterMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

/** Actual complete-frame raster decoding; the existing raster metadata fields retain their meaning. */
export interface StaticRitualRasterFacts {
  readonly validationKind: "raster";
  readonly mime: StaticRasterMime;
  readonly width: number;
  readonly frameHeight: number;
  readonly frames: number;
  readonly decodedPixels: number;
}

/** SVG dependency compatibility only; this does not describe SVG render dimensions or pixel cost. */
export interface StaticRitualSvgFacts {
  readonly validationKind: "svg";
  readonly mime: "image/svg+xml";
  readonly svgProfile: "magickli-svg-image-compatibility-v1";
  readonly elements: number;
  readonly localReferences: number;
  readonly expandedElements: number;
  /** These pixel facts apply to embedded rasters, never to the outer SVG geometry/filter graph. */
  readonly embeddedRasters: readonly Readonly<{
    contentType: StaticRasterMime;
    sha256: string;
    byteSize: number;
    width: number;
    frameHeight: number;
    frames: number;
    decodedPixels: number;
  }>[];
}

/** Exact served pathname and separately bound canonical byte identity; neither includes a query or fragment. */
export type StaticRitualImageEntry = Readonly<{
  pathname: string;
  canonicalPathname: string;
}> &
  (
    | (Readonly<{
        kind: "available";
        sha256: string;
        bytes: number;
      }> &
        (StaticRitualRasterFacts | StaticRitualSvgFacts))
    | Readonly<{
        kind: "unresolved";
        reason:
          | "unsupported-svg"
          | "invalid-svg"
          | "svg-limit"
          | "unsupported-type"
          | "source-unavailable"
          | "unsafe-file"
          | "source-changed"
          | "too-large"
          | "invalid-image"
          | "image-limit"
          | "validation-timeout";
      }>
  );

/** Immutable byte/validation evidence, not a permission grant, download manifest or precache receipt. */
export interface StaticRitualImageCatalogMetadata {
  readonly profile: "magickli-static-image-catalog-v2";
  readonly validationProfile: "magickli-static-image-validation-v2";
  readonly validationSha256: string;
  readonly sha256: string;
  readonly entries: readonly StaticRitualImageEntry[];
  /** Only validated targets and their exact aliases qualify as inventory membership. */
  readonly availablePaths: readonly string[];
}
