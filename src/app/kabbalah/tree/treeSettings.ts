import { parseComponentImageRequest } from "@/render/componentImageRequest";
import type { ComponentImageLink } from "@/render/componentImageUrl";

/** The Tree page's display state, as its query string carries it. */
export interface TreeSettings {
  field: string;
  topText: string;
  bottomText: string;
  colorScale: string;
  letterAttr: string;
  flip: boolean;
  showDaat: boolean;
  /** The page's own 10, or the query's text verbatim. */
  fontSize: string | number;
}

type QueryKey = Exclude<keyof TreeSettings, "flip" | "showDaat">;

const TEXT_DEFAULTS = {
  field: "name.roman",
  topText: "index",
  bottomText: "name.en",
  colorScale: "queen",
  letterAttr: "hermetic",
  fontSize: 10,
} satisfies Pick<TreeSettings, QueryKey>;

/** What the page shows without a query; the prerendered HTML uses these. */
export const DEFAULT_TREE_SETTINGS: TreeSettings = treeSettings(null);

/**
 * Reads the page state from a query. Empty values fall back to the defaults,
 * and Da'at is only drawn in the Queen scale, the only one that colours it.
 */
export function treeSettings(
  searchParams: Pick<URLSearchParams, "get"> | null,
): TreeSettings {
  const text = (key: QueryKey) => searchParams?.get(key) || TEXT_DEFAULTS[key];
  const colorScale = String(text("colorScale"));
  return {
    field: String(text("field")),
    topText: String(text("topText")),
    bottomText: String(text("bottomText")),
    colorScale,
    letterAttr: String(text("letterAttr")),
    flip: searchParams?.get("flip") === "true",
    showDaat: searchParams?.get("showDaat") === "true" && colorScale !== "king",
    fontSize: text("fontSize"),
  };
}

/**
 * The image link for these settings. The server contract validates and
 * canonicalises them; the page always sends fontSize, which the API would
 * otherwise derive from the field. Unsupported settings have no link.
 */
export function treeImageLink(
  settings: TreeSettings,
): ComponentImageLink<"tree-of-life"> | undefined {
  try {
    const params = new URLSearchParams({
      field: settings.field,
      topText: settings.topText,
      bottomText: settings.bottomText,
      colorScale: settings.colorScale,
      letterAttr: settings.letterAttr,
      flip: String(settings.flip),
      showDaat: String(settings.showDaat),
      fontSize: String(settings.fontSize),
    });
    return {
      slug: "tree-of-life",
      props: parseComponentImageRequest("tree-of-life", params).props,
    };
  } catch {
    return undefined;
  }
}
