"use client";

import { Container } from "@mui/material";
import React from "react";
import TableOfShewbread from "@/components/gd/TableOfShewbread";
import CopyPasteExport from "@/copyPasteExport";
import OpenSource from "@/OpenSource";

export default function CandleStickPage() {
  const ref = React.useRef(null);

  return (
    <Container sx={{ p: 2 }}>
      <TableOfShewbread ref={ref} />
      <CopyPasteExport ref={ref} filename="TableOfShewbread-magickly-export" />
      <OpenSource
        files={[
          "/src/app/gd/symbols/shewbread/page.tsx",
          "/src/components/gd/TableOfShewbread.tsx",
        ]}
      />
    </Container>
  );
}
