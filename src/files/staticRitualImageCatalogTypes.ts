/** Public metadata only: importing these types must not load filesystem or decoder code. */
export type StaticRasterMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

/** Exact served pathname and separately bound canonical byte identity; neither includes a query or fragment. */
export type StaticRitualImageEntry = Readonly<{
  pathname: string;
  canonicalPathname: string;
}> &
  (
    | Readonly<{
        kind: "available";
        sha256: string;
        bytes: number;
        mime: StaticRasterMime;
        width: number;
        frameHeight: number;
        frames: number;
        decodedPixels: number;
      }>
    | Readonly<{
        kind: "unresolved";
        reason:
          | "unsupported-svg"
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

/** Immutable byte/decode evidence, not a permission grant, download manifest or precache receipt. */
export interface StaticRitualImageCatalogMetadata {
  readonly profile: "magickli-static-raster-catalog-v1";
  readonly validationProfile: "magickli-static-raster-validation-v1";
  readonly validationSha256: string;
  readonly sha256: string;
  readonly entries: readonly StaticRitualImageEntry[];
  /** Only validated targets and their exact aliases qualify as inventory membership. */
  readonly availablePaths: readonly string[];
}
