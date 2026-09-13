import { Suspense } from "react";
import OfflineRitualEntry from "./OfflineRitualEntry";

/** Build-bound anonymous fallback and guarded index for verified downloads. */
export default function OfflineRitualShell() {
  return (
    <Suspense fallback={<div>Loading ritual...</div>}>
      <OfflineRitualEntry />
    </Suspense>
  );
}
