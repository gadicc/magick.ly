"use client";
import React from "react";
import dynamic from "next/dynamic";

const DocEditNoSSR = dynamic(() => import("./DocEdit"), { ssr: false });

export default function DocEdit(props: { params: Promise<{ _id: string }> }) {
  const params = React.use(props.params);

  const { _id } = params;

  return <DocEditNoSSR params={{ _id }} />;
}
