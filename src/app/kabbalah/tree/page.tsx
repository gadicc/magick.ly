import React from "react";
import { pageMetadata } from "@/seo/metadata";
import TreeOfLife, { TreeOfLifeView } from "./tree";
import { DEFAULT_TREE_SETTINGS } from "./treeSettings";

export const metadata = pageMetadata("/kabbalah/tree");

/**
 * Prerendered with the default settings, which is what the canonical URL
 * shows. A shared link briefly shows them too, until hydration reads its query.
 */
export default function TreeOfLifePage() {
  return (
    <React.Suspense
      fallback={<TreeOfLifeView settings={DEFAULT_TREE_SETTINGS} />}
    >
      <TreeOfLife />
    </React.Suspense>
  );
}
