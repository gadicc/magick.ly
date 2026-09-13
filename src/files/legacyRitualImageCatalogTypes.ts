import type {
  StaticRitualRasterFacts,
  StaticRitualSvgFacts,
} from "./staticRitualImageCatalogTypes";

/** Captured historical public bytes only; no provider locations or archived source metadata. */
export type LegacyRitualImageEntry = Readonly<{
  fileId: string;
  sha256: string;
  sourceSha256: string;
  /** Binds the exact imported source identity and location without disclosing either. */
  provenanceSha256: string;
}> &
  (
    | (Readonly<{ kind: "available"; bytes: number }> &
        (StaticRitualRasterFacts | StaticRitualSvgFacts))
    | Readonly<{
        kind: "unresolved";
        reason:
          | "source-unavailable"
          | "source-mismatch"
          | "unsupported-type"
          | "too-large"
          | "invalid-image"
          | "invalid-svg"
          | "unsupported-svg"
          | "image-limit"
          | "svg-limit"
          | "validation-timeout";
      }>
  );

/** Immutable image evidence, not current authorization, a lease or a durable download manifest. */
export interface LegacyRitualImageCatalogMetadata {
  readonly profile: "magickli-legacy-image-catalog-v1";
  readonly validationSha256: string;
  readonly sha256: string;
  readonly entries: readonly LegacyRitualImageEntry[];
}
