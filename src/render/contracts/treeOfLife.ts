import {
  type ComponentImageContract,
  canonicalDimensions,
  choice,
  type ImageDimensions,
  invalid,
  parseDimensions,
} from "./types";

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

export const TREE_SEPHIROT = [
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
] as const;
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
export const TREE_PATHS = [...COMMON_PATHS, "7_10", "8_10", "2_5", "3_4"];
const FIELDS: ReadonlySet<string> = new Set(TREE_IMAGE_FIELDS);
export const TREE_VIEWBOX = [-170.5, 0, 341, 598] as const;

/** HTTP image props deliberately exclude component callbacks and arbitrary labels. */
export interface TreeImageProps extends ImageDimensions {
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

function fields(value: string, empty: boolean): string {
  if (empty && value === "") return value;
  const parts = value.split(",");
  if (parts.length > 4 || parts.some((part) => !FIELDS.has(part))) invalid();
  return value;
}

/**
 * The saved ritual and grade URLs predate the interactive page, so the API
 * defaults (`index` labels, empty bottom text, field-based font size) differ
 * from the page's defaults and must never change.
 */
export const treeOfLife: ComponentImageContract<TreeImageProps> = {
  slug: "tree-of-life",
  viewBox: TREE_VIEWBOX,
  rasterDefault: null,
  keys: [
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
  ],
  personal: false,
  parse(searchParams) {
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
        choice(searchParams.get("flip") ?? "false", ["true", "false"]) ===
        "true",
      showDaat:
        choice(searchParams.get("showDaat") ?? "false", ["true", "false"]) ===
        "true",
    };
    // The source data defines Da'at only in the queen scale.
    if (props.showDaat && props.colorScale === "king") invalid();
    // Key order matters: generated-catalog identities hash the normalised request.
    Object.assign(props, parseDimensions(searchParams, TREE_VIEWBOX));
    const fontSize = searchParams.get("fontSize");
    if (fontSize !== null) {
      if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(fontSize)) invalid();
      props.fontSize = Number(fontSize);
      if (props.fontSize < 1 || props.fontSize > 128) invalid();
    }
    const active = searchParams.get("active");
    if (active) props.active = choice(active, TREE_SEPHIROT);
    const activePath = searchParams.get("activePath");
    if (activePath) props.activePath = choice(activePath, TREE_PATHS);
    return props;
  },
  canonicalize(props) {
    const pairs: Array<[string, string]> = [];
    if (props.field !== "index") pairs.push(["field", props.field]);
    if (props.topText !== "index") pairs.push(["topText", props.topText]);
    if (props.bottomText !== "") pairs.push(["bottomText", props.bottomText]);
    if (props.colorScale !== "queen")
      pairs.push(["colorScale", props.colorScale]);
    if (props.letterAttr !== "hermetic")
      pairs.push(["letterAttr", props.letterAttr]);
    if (props.flip) pairs.push(["flip", "true"]);
    if (props.showDaat) pairs.push(["showDaat", "true"]);
    if (props.fontSize !== undefined)
      pairs.push(["fontSize", String(props.fontSize)]);
    if (props.active !== undefined) pairs.push(["active", props.active]);
    if (props.activePath !== undefined)
      pairs.push(["activePath", props.activePath]);
    return [...pairs, ...canonicalDimensions(props)];
  },
  filename: () => "tree-of-life",
};
