"use client";

import {
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from "@mui/material";
import React from "react";
import Tablet from "@/components/enochian/Tablet";
import ExportControls from "@/components/export/ExportControls";
import OpenSource from "@/OpenSource";
import { TABLET_IDS } from "@/render/contracts/enochianTablet";
import useEnochianFont, { EnochianFont } from "../useEnochianFont";

export default function Tablets() {
  const [id, setId] = React.useState<(typeof TABLET_IDS)[number]>("earth");
  const { EnochianFontToggle, enochianFont } = useEnochianFont();
  const ref = React.useRef<SVGSVGElement>(null);

  return (
    <>
      <Container sx={{ p: 2 }}>
        <FormControl>
          <InputLabel id="demo-simple-select-label">Tablet</InputLabel>
          <Select
            labelId="demo-simple-select-label"
            id="demo-simple-select"
            value={id}
            label="Tablet"
            onChange={(e) =>
              setId(e.target.value as (typeof TABLET_IDS)[number])
            }
          >
            <MenuItem value="earth">Earth</MenuItem>
            <MenuItem value="air">Air</MenuItem>
          </Select>
        </FormControl>
        <EnochianFontToggle />
        <br />
        <br />

        <Tablet
          id={id}
          enochianStyle={enochianFont ? EnochianFont.style : undefined}
          ref={ref}
        />
        <ExportControls
          target={ref}
          filename={`enochian-${id}-tablet`}
          // The server renders the Latin grid only until the Enochian glyph
          // font is bundled with a recorded licence.
          link={
            enochianFont
              ? undefined
              : { slug: "enochian-tablet", props: { id } }
          }
        />
        <div style={{ textAlign: "center", fontSize: "90%" }}>
          Enochian Font:{" "}
          <a href="https://fonts2u.com/enochian-plain.font">enochian-plain</a>
        </div>
        <br />
        <OpenSource
          files={[
            "/src/app/enochian/tablets/page.tsx",
            "/src/components/enochian/Tablet.tsx",
            "/data/enochian/tablets.json5",
          ]}
        />
      </Container>
    </>
  );
}
