import "server-only";
import type { ReactElement } from "react";
import AstroGeomancyChart from "@/app/geomancy/reading/AstroGeomancyChart";
import { figuresFromMothers } from "@/app/geomancy/tetragrams";
import Tablet from "@/components/enochian/Tablet";
import { RoseSigilImage } from "@/components/gd/RoseSigil";
import {
  optimizeSigilPoints,
  sigilPoints,
} from "@/components/gd/roseSigilGeometry";
import SevenBranchedCandleStick from "@/components/gd/SevenBranchedCandleStick";
import TableOfShewbread from "@/components/gd/TableOfShewbread";
import TreeOfLife from "@/components/kabbalah/TreeOfLife";
import type { ComponentImageProps, ComponentImageSlug } from "./contracts";
import { mothersFromString } from "./contracts/astroGeomancyChart";
import {
  COMPONENT_IMAGE_PROFILE,
  type ServerFontFile,
  TREE_IMAGE_PROFILE,
} from "./outlineTreeImage";

export interface ComponentImageRegistration<S extends ComponentImageSlug> {
  /** Trusted JSX for validated props; never caller-supplied markup. */
  render(props: ComponentImageProps<S>): ReactElement | Promise<ReactElement>;
  /** Outline identity profile the output is published under. */
  profile: string;
  /** Mirror after outlining instead of relying on the component's CSS transform. */
  flip?(props: ComponentImageProps<S>): boolean;
  /** Server-only bundled fonts beyond the shared base set (see assets/fonts). */
  fonts?: readonly ServerFontFile[];
}

/**
 * The only components the image route can render. Each entry pairs a pure
 * contract with server-only rendering; slugs are object keys, never paths.
 */
export const COMPONENT_IMAGE_REGISTRY: {
  [S in ComponentImageSlug]: ComponentImageRegistration<S>;
} = {
  "tree-of-life": {
    render: (props) => <TreeOfLife {...props} flip={false} />,
    flip: (props) => props.flip,
    profile: TREE_IMAGE_PROFILE,
  },
  "astro-geomancy-chart": {
    render: (props) => (
      <AstroGeomancyChart
        tetragrams={figuresFromMothers(mothersFromString(props.mothers))}
      />
    ),
    profile: COMPONENT_IMAGE_PROFILE,
  },
  "enochian-tablet": {
    // "Enochian" is the bundled TTF's family name; the page uses next/font's
    // generated family for the same glyphs.
    render: (props) => (
      <Tablet
        id={props.id}
        frame={false}
        enochianStyle={
          props.font === "enochian" ? { fontFamily: "Enochian" } : undefined
        }
      />
    ),
    profile: COMPONENT_IMAGE_PROFILE,
    fonts: ["EnochianPlain.ttf"],
  },
  "seven-branched-candlestick": {
    render: () => <SevenBranchedCandleStick />,
    profile: COMPONENT_IMAGE_PROFILE,
  },
  "table-of-shewbread": {
    render: () => <TableOfShewbread />,
    profile: COMPONENT_IMAGE_PROFILE,
    fonts: ["NotoEmoji-Variable.ttf"],
  },
  "rose-sigil": {
    // The same bounded optimiser as the page, so the link reproduces the drawn sigil.
    render: async (props) => (
      <RoseSigilImage
        sigilText={props.text}
        showRose={props.rose}
        debug={false}
        points={await optimizeSigilPoints(sigilPoints(props.text))}
      />
    ),
    profile: COMPONENT_IMAGE_PROFILE,
  },
};
