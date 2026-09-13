"use client";

import { CircularProgress } from "@mui/material";
import React from "react";
import { ritualRouteIdFromPath } from "@/doc/ritualRouteIdentity";
import PrivateRitualReader from "../../doc/[_id]/PrivateRitualReader";
import OfflineRitualCatalog from "./OfflineRitualCatalog";

/** A cached shell keeps its router tree, so inspect the live navigation URL after mount. */
export default function OfflineRitualEntry() {
  const [ritualRoute, setRitualRoute] = React.useState<
    string | null | undefined
  >(undefined);
  React.useEffect(() => {
    setRitualRoute(ritualRouteIdFromPath(window.location.pathname));
  }, []);
  if (ritualRoute === undefined)
    return <CircularProgress aria-label="Loading offline rituals" />;
  return ritualRoute ? <PrivateRitualReader /> : <OfflineRitualCatalog />;
}
