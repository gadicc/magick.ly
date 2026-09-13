/** Fields exposed by the interactive tree and the existing ritual/grade callers. */
export const TREE_IMAGE_FIELDS = [
  "index",
  "angelicOrder.name.en",
  "angelicOrder.name.he",
  "angelicOrder.name.roman",
  "archangel.name.roman",
  "archangel.name.he",
  "body",
  "bodyPos",
  "chakra.name.en",
  "chakra.name.sa",
  "chakra.name.roman",
  "godName.name.en",
  "godName.name.he",
  "godName.name.roman",
  "gdGrade.id",
  "gdGrade.name",
  "gdGrade.element.symbol",
  "gdGrade.orderId",
  "gdGrade.planet.symbol",
  "name.en",
  "name.he",
  "name.roman",
  "planet.name.en.en",
  "planet.name.he.he",
  "planet.name.he.roman",
  "scent",
  "stone",
  "soul.name.en",
  "soul.name.he",
  "soul.name.roman",
] as const;

const SEPHIROT = [
  "keter",
  "chochmah",
  "binah",
  "hesed",
  "gevurah",
  "tiferet",
  "netzach",
  "hod",
  "yesod",
  "malchut",
  "daat",
];
const COMMON_PATHS = [
  "4_5",
  "2_3",
  "7_8",
  "1_2",
  "1_3",
  "1_6",
  "2_4",
  "2_6",
  "3_5",
  "3_6",
  "4_6",
  "4_7",
  "5_6",
  "5_8",
  "6_7",
  "6_8",
  "6_9",
  "7_9",
  "8_9",
  "9_10",
];
const KEYS = new Set([
  "fmt",
  "width",
  "height",
  "field",
  "topText",
  "bottomText",
  "colorScale",
  "letterAttr",
  "flip",
  "showDaat",
  "fontSize",
  "active",
  "activePath",
]);
const FIELDS: ReadonlySet<string> = new Set(TREE_IMAGE_FIELDS);

/** HTTP image props deliberately exclude component callbacks and arbitrary labels. */
export interface TreeImageProps {
  width?: number;
  height?: number;
  field: string;
  topText: string;
  bottomText: string;
  colorScale: "queen" | "king";
  letterAttr: "hermetic" | "hebrew";
  flip: boolean;
  showDaat: boolean;
  fontSize?: number;
  active?: string;
  activePath?: string;
}

/** Closed registry request, shared by URL rendering and offline acquisition. */
export interface ComponentImageRequest {
  slug: "tree-of-life";
  format: "svg" | "png";
  props: TreeImageProps;
}

export class InvalidComponentImageRequest extends Error {
  constructor() {
    super("Unsupported component image request");
    this.name = "InvalidComponentImageRequest";
  }
}

function invalid(): never {
  throw new InvalidComponentImageRequest();
}

function choice<T extends string>(value: string, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? (value as T) : invalid();
}

function fields(value: string, empty: boolean): string {
  if (empty && value === "") return value;
  const parts = value.split(",");
  if (parts.length > 4 || parts.some((part) => !FIELDS.has(part))) invalid();
  return value;
}

function dimension(value: string): number {
  if (!/^[1-9]\d{0,3}$/.test(value)) invalid();
  const number = Number(value);
  return number <= 4096 ? number : invalid();
}

/** Parse before loading fonts, rendering JSX or allocating raster output. */
export function parseComponentImageRequest(
  slug: string,
  searchParams: URLSearchParams,
): ComponentImageRequest {
  if (slug !== "tree-of-life" || searchParams.toString().length > 4096)
    invalid();
  const seen = new Set<string>();
  for (const [key] of searchParams) {
    if (!KEYS.has(key) || seen.has(key)) invalid();
    seen.add(key);
  }
  const format = choice(searchParams.get("fmt") || "svg", ["svg", "png"]);
  const props: TreeImageProps = {
    field: fields(searchParams.get("field") || "index", false),
    topText: fields(searchParams.get("topText") ?? "index", true),
    bottomText: fields(searchParams.get("bottomText") ?? "", true),
    colorScale: choice(searchParams.get("colorScale") || "queen", [
      "queen",
      "king",
    ]),
    letterAttr: choice(searchParams.get("letterAttr") || "hermetic", [
      "hermetic",
      "hebrew",
    ]),
    flip:
      choice(searchParams.get("flip") ?? "false", ["true", "false"]) === "true",
    showDaat:
      choice(searchParams.get("showDaat") ?? "false", ["true", "false"]) ===
      "true",
  };
  // The source data defines Da'at only in the queen scale.
  if (props.showDaat && props.colorScale === "king") invalid();
  for (const key of ["width", "height"] as const) {
    const value = searchParams.get(key);
    if (value !== null) props[key] = dimension(value);
  }
  // A single dimension scales the viewBox's aspect ratio in raster output.
  const width =
    props.width ?? (props.height ? Math.ceil((props.height * 341) / 598) : 341);
  const height =
    props.height ?? (props.width ? Math.ceil((props.width * 598) / 341) : 598);
  if (width > 4096 || height > 4096 || width * height > 4_194_304) invalid();

  const fontSize = searchParams.get("fontSize");
  if (fontSize !== null) {
    if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(fontSize)) invalid();
    props.fontSize = Number(fontSize);
    if (props.fontSize < 1 || props.fontSize > 128) invalid();
  }
  const active = searchParams.get("active");
  if (active) props.active = choice(active, SEPHIROT);
  const activePath = searchParams.get("activePath");
  if (activePath) {
    props.activePath = choice(activePath, [
      ...COMMON_PATHS,
      "7_10",
      "8_10",
      "2_5",
      "3_4",
    ]);
  }
  return { slug: "tree-of-life", format, props };
}
