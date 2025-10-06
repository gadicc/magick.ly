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
import CopyPasteExport, { ToastContainer } from "@/copyPasteExport";
import OpenSource from "@/OpenSource";
import useEnochianFont from "../useEnochianFont";

export default function Tablets() {
  const [elementId, setElementId] = React.useState<string>("earth");
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
            value={elementId}
            label="Tablet"
            onChange={(e) => setElementId(e.target.value)}
          >
            <MenuItem value="earth">Earth</MenuItem>
            <MenuItem value="air">Air</MenuItem>
          </Select>
        </FormControl>
        <EnochianFontToggle />
        <br />
        <br />

        <Tablet id={elementId} enochianFont={enochianFont} ref={ref} />
        <CopyPasteExport ref={ref} filename={`enochian-${elementId}-tablet`} />
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
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={false}
        pauseOnHover
      />
    </>
  );
}
