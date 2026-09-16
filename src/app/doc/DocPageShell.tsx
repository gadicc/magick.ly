import { Suspense } from "react";
import DocLoader from "./[_id]/DocLoader";

/**
 * Display variables are applied in the client, keeping bundled HTML
 * anonymous: the prerendered fallback is the ritual with its defaults.
 */
export default function DocPageShell({ id }: { id: string }) {
  return (
    <Suspense fallback={<DocLoader id={id} prerender />}>
      <DocLoader id={id} />
    </Suspense>
  );
}
