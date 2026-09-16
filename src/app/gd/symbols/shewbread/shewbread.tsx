"use client";

import { Container } from "@mui/material";
import React from "react";
import ExportControls from "@/components/export/ExportControls";
import TableOfShewbread from "@/components/gd/TableOfShewbread";
import OpenSource from "@/OpenSource";

export default function CandleStickPage() {
  const ref = React.useRef<SVGSVGElement>(null);

  return (
    <Container sx={{ p: 2 }}>
      <TableOfShewbread ref={ref} />
      <ExportControls
        target={ref}
        filename="TableOfShewbread-magickly-export"
        link={{ slug: "table-of-shewbread", props: {} }}
      />
      <OpenSource
        files={[
          "/src/app/gd/symbols/shewbread/shewbread.tsx",
          "/src/components/gd/TableOfShewbread.tsx",
        ]}
      />
    </Container>
  );
}
