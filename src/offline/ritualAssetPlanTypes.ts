import type {
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "../files/staticRitualImageCatalogTypes";

/** Server resolution evidence only; this is neither an authorization grant nor a download manifest. */
export interface RitualAssetPlanMetadata {
  readonly profile: "magickli-ritual-asset-plan-v2";
  readonly sha256: string;
  readonly contentSha256: string;
  readonly inventoryProfile: "magickli-jrt-assets-v1";
  readonly staticCatalogSha256: string;
  /** Null means no legacy capability was supplied; either way the exact identity is part of the plan hash. */
  readonly legacyCatalogSha256: string | null;
  readonly validationSha256: string;
  readonly limits: Readonly<{
    capturedBytes: number;
    inlineImages: number;
    inlinePixels: number;
    timeoutMs: number;
  }>;
  readonly resolutionComplete: boolean;
  readonly assets: readonly RitualResolvedAsset[];
  readonly occurrences: readonly Readonly<{
    /** Child indices in the original tree, not a rendered DOM index. */
    path: readonly number[];
    src: string;
    displayFragment: string;
    /** Index into this plan only; persistent bundle/file IDs are assigned separately. */
    assetIndex: number | null;
  }>[];
  /** Safe structural diagnostics; no unrelated source text or remote error messages. */
  readonly issues: readonly Readonly<{
    code: string;
    path: readonly number[];
    field?: string;
  }>[];
}

/** Exact network reference retains query spelling/order; fragments remain with occurrences. */
export type RitualResolvedAsset = Readonly<{
  networkReference: string;
  sha256: string;
  bytes: number;
  provenance:
    | Readonly<{
        kind: "static";
        pathname: string;
        canonicalPathname: string;
      }>
    | Readonly<{ kind: "inline" }>
    | Readonly<{
        kind: "legacy-public";
        fileId: string;
        sourceSha256: string;
        provenanceSha256: string;
      }>;
}> &
  (StaticRitualRasterFacts | StaticRitualSvgFacts);
