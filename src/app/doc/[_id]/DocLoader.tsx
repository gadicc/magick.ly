"use client";

// Built-in ritual sources ship in the client bundle so they work offline.
// Turbopack reads `type: "text"` itself; next.config.ts gives webpack a rule.
// import neophyte from "../../src/doc/neophyte.yaml";
import _neophyte from "@/doc/0=0.jade" with { type: "text" };
// import _neophyteM from "@/doc/0=0m.jade" with { type: "text" };
import _zelator from "@/doc/1=10.jade" with { type: "text" };
// import _healing from "@/doc/healing.jade" with { type: "text" };
// import _chesedTalisman from "@/doc/chesed-talisman.jade" with { type: "text" };
import _theoricus from "@/doc/2=9.jade" with { type: "text" };
import { prepare } from "@/doc/prepare";
import type { DocNode } from "@/schemas";
import DocRender, { DocView } from "./DocRender";

function prepareBuiltin(source: string): DocNode {
  // The established compiler emits a type-less document root and may retain
  // type-less grouping nodes. JRT has always accepted that shape, while the
  // newer shared DocNode interface requires `type`; bridge the types without
  // rewriting or rejecting the compiled tree.
  return prepare(source) as unknown as DocNode;
}

const docs = {
  neophyte: prepareBuiltin(_neophyte),
  zelator: prepareBuiltin(_zelator),
  theoricus: prepareBuiltin(_theoricus),
  // neophyteM: prepare(_neophyteM),
  // healing: prepare(_healing),
  // "chesed-talisman": prepare(_chesedTalisman),
} satisfies Record<string, DocNode>;

/**
 * A bundled ritual. `prerender` draws it with the default display variables
 * and no query, for the static page's Suspense fallback.
 */
function DocLoader({ id, prerender }: { id: string; prerender?: boolean }) {
  const doc = Object.hasOwn(docs, id)
    ? docs[id as keyof typeof docs]
    : undefined;
  if (!doc) return <div>Ritual not found.</div>;

  return prerender ? (
    <DocView doc={doc} searchParams={null} />
  ) : (
    <DocRender doc={doc} />
  );
}

//export default dynamic(Promise.resolve(Doc), { ssr: false });
export default DocLoader;
