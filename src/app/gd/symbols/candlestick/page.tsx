"use client";

import { Container } from "@mui/material";
import React from "react";
import ExportControls from "@/components/export/ExportControls";
import SevenBranchedCandleStick from "@/components/gd/SevenBranchedCandleStick";
import OpenSource from "@/OpenSource";

export default function CandleStickPage() {
  const ref = React.useRef<SVGSVGElement>(null);

  return (
    <Container sx={{ p: 2 }}>
      <SevenBranchedCandleStick ref={ref} />
      <ExportControls
        target={ref}
        filename="SevenBranchedCandleStick-magickly-export"
        link={{ slug: "seven-branched-candlestick", props: {} }}
      />
      <OpenSource
        files={[
          "/src/app/gd/symbols/candlestick/page.tsx",
          "/src/components/gd/SevenBranchedCandleStick.tsx",
        ]}
      />
    </Container>
  );
}
