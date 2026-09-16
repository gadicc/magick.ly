import { Box, Typography } from "@mui/material";
import { Suspense } from "react";
import DocLoader from "./[_id]/DocLoader";

/**
 * Display variables are applied in the client, keeping bundled HTML
 * anonymous: the prerendered fallback is the ritual with its defaults.
 * The heading matches the one public SQL rituals show.
 */
export default function DocPageShell({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  return (
    <Box>
      <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Suspense fallback={<DocLoader id={id} prerender />}>
        <DocLoader id={id} />
      </Suspense>
    </Box>
  );
}
