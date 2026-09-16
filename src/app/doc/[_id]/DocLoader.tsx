"use client";

// import neophyte from "../../src/doc/neophyte.yaml";
// @ts-expect-error: ok
import _neophyte from "!!raw-loader!@/doc/0=0.jade";
// import _neophyteM from "!!raw-loader!../../src/doc/0=0m.jade";
// @ts-expect-error: ok
import _zelator from "!!raw-loader!@/doc/1=10.jade";
// import _healing from "!!raw-loader!../../src/doc/healing.jade";
// import _chesedTalisman from "!!raw-loader!../../src/doc/chesed-talisman.jade";
// @ts-expect-error: ok
import _theoricus from "!!raw-loader!@/doc/2=9.jade";
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
