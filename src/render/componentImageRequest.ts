import {
  CONTRACTS,
  type ComponentImageProps,
  type ComponentImageSlug,
  InvalidComponentImageRequest,
  isComponentImageSlug,
} from "./contracts";
import { choice, invalid } from "./contracts/types";

export {
  TREE_IMAGE_FIELDS,
  type TreeImageProps,
} from "./contracts/treeOfLife";
export { InvalidComponentImageRequest };

const COMMON_KEYS = ["fmt", "width", "height"] as const;
/** Bytes of query string accepted before any parsing. */
export const MAX_QUERY_LENGTH = 4096;

/** Closed registry request, shared by URL rendering and offline acquisition. */
export type ComponentImageRequest<
  S extends ComponentImageSlug = ComponentImageSlug,
> = {
  [K in S]: { slug: K; format: "svg" | "png"; props: ComponentImageProps<K> };
}[S];

/**
 * Parse before loading fonts, rendering JSX or allocating raster output. Only
 * registered slugs and their declared keys are accepted; unknown or repeated
 * keys fail closed.
 */
export function parseComponentImageRequest<S extends ComponentImageSlug>(
  slug: S,
  searchParams: URLSearchParams,
): ComponentImageRequest<S>;
export function parseComponentImageRequest(
  slug: string,
  searchParams: URLSearchParams,
): ComponentImageRequest;
export function parseComponentImageRequest(
  slug: string,
  searchParams: URLSearchParams,
): ComponentImageRequest {
  if (
    !isComponentImageSlug(slug) ||
    searchParams.toString().length > MAX_QUERY_LENGTH
  )
    invalid();
  const contract = CONTRACTS[slug];
  const keys = new Set<string>([...COMMON_KEYS, ...contract.keys]);
  const seen = new Set<string>();
  for (const [key] of searchParams) {
    if (!keys.has(key) || seen.has(key)) invalid();
    seen.add(key);
  }
  const format = choice(searchParams.get("fmt") || "svg", ["svg", "png"]);
  return {
    slug,
    format,
    props: contract.parse(searchParams),
  } as ComponentImageRequest;
}
