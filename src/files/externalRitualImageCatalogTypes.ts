import type { StaticRitualRasterFacts } from "./staticRitualImageCatalogTypes";

/** Exact-reference fingerprints avoid retaining raw remote URLs or unrelated ritual data. */
export type ExternalRitualImageEntry = Readonly<{ referenceSha256: string }> &
  (
    | (Readonly<{
        kind: "available";
        acquisitionReferenceSha256: string;
        representation: "original" | "same-file-standard-thumbnail";
        sha256: string;
        bytes: number;
      }> &
        StaticRitualRasterFacts)
    | Readonly<{
        kind: "unresolved";
        reason:
          | "unapproved-reference"
          | "source-unavailable"
          | "source-mismatch"
          | "unsafe-address"
          | "invalid-image"
          | "image-limit"
          | "validation-timeout";
      }>
  );

/** Acquisition evidence only; no permission, durable manifest, future availability or original-byte parity promise. */
export interface ExternalRitualImageCatalogMetadata {
  readonly profile: "magickli-external-image-catalog-v1";
  readonly policySha256: string;
  readonly validationSha256: string;
  readonly sha256: string;
  readonly entries: readonly ExternalRitualImageEntry[];
}
