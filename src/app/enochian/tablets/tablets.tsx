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
import ExportControls from "@/export/ExportControls";
import OpenSource from "@/OpenSource";
import { componentImageFilename } from "@/render/componentImageUrl";
import { TABLET_IDS } from "@/render/contracts/enochianTablet";
import useEnochianFont, { EnochianFont } from "../useEnochianFont";

export default function Tablets() {
  const [id, setId] = React.useState<(typeof TABLET_IDS)[number]>("earth");
  const { EnochianFontToggle, enochianFont } = useEnochianFont();
  const ref = React.useRef<SVGSVGElement>(null);
  const link = {
    slug: "enochian-tablet" as const,
    props: {
      id,
      font: enochianFont ? ("enochian" as const) : ("latin" as const),
    },
  };

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
          filename={componentImageFilename(link)}
          link={link}
        />
        <div style={{ textAlign: "center", fontSize: "90%" }}>
          Enochian Font:{" "}
          <a href="https://fonts2u.com/enochian-plain.font">enochian-plain</a>
        </div>
        <br />
        <OpenSource
          files={[
            "/src/app/enochian/tablets/tablets.tsx",
            "/src/components/enochian/Tablet.tsx",
            "/data/enochian/tablets.json5",
          ]}
        />
      </Container>
    </>
  );
}
