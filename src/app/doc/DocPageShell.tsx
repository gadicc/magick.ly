import { Suspense } from "react";
import DocLoader from "./[_id]/DocLoader";

/** Display variables are applied in the client, keeping bundled HTML anonymous. */
export default function DocPageShell({ id }: { id: string }) {
  return (
    <Suspense fallback={<div>Loading ritual...</div>}>
      <DocLoader id={id} />
    </Suspense>
  );
}
