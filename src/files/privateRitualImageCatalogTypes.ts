import type { RitualImageType } from "./ritualUploadProtocol";

export type PrivateRitualImageEntry =
  | Readonly<{
      kind: "available";
      referenceSha256: string;
      ritualId: string;
      attachmentId: string;
      fileId: string;
      sourceSha256: string;
      sha256: string;
      bytes: number;
      validationKind: "raster";
      mime: RitualImageType;
      width: number;
      frameHeight: number;
      frames: number;
      decodedPixels: number;
    }>
  | Readonly<{
      kind: "unresolved";
      referenceSha256: string;
      reason: "unavailable";
    }>;

export interface PrivateRitualImageCatalogMetadata {
  readonly profile: "magickli-private-ritual-image-catalog-v1";
  readonly sha256: string;
  readonly validationSha256: string;
  readonly entries: readonly PrivateRitualImageEntry[];
}

/** Authorized captured bytes; neither metadata nor a locator grants access. */
export interface PrivateRitualImageCatalog {
  readonly metadata: PrivateRitualImageCatalogMetadata;
  copyBytes(referenceSha256: string): Uint8Array | null;
  dispose(): void;
}
