/**
 * Client-safe URL and file-name helpers for the component image routes. Only
 * the pure contracts are imported, so this can ship in page bundles.
 */
import {
  CONTRACTS,
  type ComponentImageProps,
  type ComponentImageSlug,
} from "./contracts";

export interface ComponentImageLink<S extends ComponentImageSlug> {
  slug: S;
  props: ComponentImageProps<S>;
}

/** Any registered slug with matching props; the wrapper accepts exactly this. */
export type AnyComponentImageLink = {
  [S in ComponentImageSlug]: ComponentImageLink<S>;
}[ComponentImageSlug];

export interface ComponentImageUrlOptions {
  format?: "svg" | "png";
  /** Ask the route for an attachment response. */
  download?: boolean;
}

/** Canonical query: contract order, defaults omitted, `fmt` only for PNG. */
export function componentImageQuery<S extends ComponentImageSlug>(
  link: ComponentImageLink<S>,
  options: ComponentImageUrlOptions = {},
): URLSearchParams {
  const contract = CONTRACTS[link.slug];
  const pairs = (
    contract.canonicalize as (
      props: ComponentImageProps<S>,
    ) => [string, string][]
  )(link.props);
  const params = new URLSearchParams();
  if (options.format === "png") params.set("fmt", "png");
  for (const [key, value] of pairs) params.set(key, value);
  if (options.download) params.set("download", "1");
  return params;
}

/** Site-relative image URL, stable for identical props. */
export function componentImagePath<S extends ComponentImageSlug>(
  link: ComponentImageLink<S>,
  options: ComponentImageUrlOptions = {},
): string {
  const query = componentImageQuery(link, options).toString();
  return `/api/render/${link.slug}${query ? `?${query}` : ""}`;
}

/** Download file name for a request, without extension. */
export function componentImageFilename<S extends ComponentImageSlug>(
  link: ComponentImageLink<S>,
): string {
  const contract = CONTRACTS[link.slug];
  return (contract.filename as (props: ComponentImageProps<S>) => string)(
    link.props,
  );
}

/**
 * RFC 6266 disposition with an ASCII fallback and an RFC 8187 UTF-8 form when
 * the name has other characters, such as Hebrew sigil text.
 */
export function contentDisposition(
  type: "inline" | "attachment",
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  let header = `${type}; filename="${ascii}"`;
  if (ascii !== filename)
    header += `; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return header;
}
