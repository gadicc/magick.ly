import React from "react";
import { pageMetadata } from "@/seo/metadata";
import TreeOfLife from "./tree";

export const metadata = pageMetadata("/kabbalah/tree");

export default function TreeOfLifePage() {
  return (
    <React.Suspense>
      <TreeOfLife />
    </React.Suspense>
  );
}
