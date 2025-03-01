"use client";
import React, { use } from "react";
import { useGongoSub, useGongoOne } from "gongo-client-react";

import { prepare } from "@/doc/prepare";
import DocRender from "./DocRender";

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

const docs = {
  neophyte: prepare(_neophyte),
  zelator: prepare(_zelator),
  theoricus: prepare(_theoricus),
  // neophyteM: prepare(_neophyteM),
  // healing: prepare(_healing),
  // "chesed-talisman": prepare(_chesedTalisman),
};

function DocLoader(props: { params: Promise<{ _id: string }> }) {
  const params = use(props.params);

  const { _id } = params;

  const builtinDoc = docs[_id];
  useGongoSub(!builtinDoc && "doc", { _id });
  const dbDoc = useGongoOne(
    (db) => !builtinDoc && db.collection("docs").find({ _id })
  );

  const doc = builtinDoc || (dbDoc && dbDoc.doc);

  if (!doc) return <div>Loading or not found...</div>;

  return <DocRender doc={doc} />;
}

//export default dynamic(Promise.resolve(Doc), { ssr: false });
export default DocLoader;
