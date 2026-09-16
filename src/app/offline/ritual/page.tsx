import { Suspense } from "react";
import { privateMetadata } from "@/seo/metadata";
import OfflineRitualEntry from "./OfflineRitualEntry";

export const metadata = privateMetadata("Downloaded Rituals");

/** Build-bound anonymous fallback and guarded index for verified downloads. */
export default function OfflineRitualShell() {
  return (
    <Suspense fallback={<div>Loading ritual...</div>}>
      <OfflineRitualEntry />
    </Suspense>
  );
}
