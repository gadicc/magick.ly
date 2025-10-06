"use client";

import { Container } from "@mui/material";
import React from "react";
import SevenBranchedCandleStick from "@/components/gd/SevenBranchedCandleStick";
import CopyPasteExport from "@/copyPasteExport";
import OpenSource from "@/OpenSource";

export default function CandleStickPage() {
  const ref = React.useRef(null);

  return (
    <Container sx={{ p: 2 }}>
      <SevenBranchedCandleStick ref={ref} />
      <CopyPasteExport
        ref={ref}
        filename="SevenBranchedCandleStick-magickly-export"
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
