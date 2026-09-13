import "server-only";
import { createHash } from "node:crypto";
import React from "react";
import sharp from "sharp";
import TreeOfLife from "@/components/kabbalah/TreeOfLife";
import { parseComponentImageRequest } from "./componentImageRequest";
import { outlineTreeImage } from "./outlineTreeImage";

/** Render only the closed registry; callers cannot provide JSX, URLs or SVG. */
export async function renderComponentImage(
  slug: string,
  searchParams: URLSearchParams,
) {
  const request = parseComponentImageRequest(slug, searchParams);
  // Dynamic import keeps React's document serializer out of Next's static RSC
  // import check, as in the previous image route.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const svg = renderToStaticMarkup(
    <TreeOfLife {...request.props} flip={false} />,
  ).replace(
    'xmlns="http://www.w3.org/2000/svg"',
    'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
  );
  const outlined = await outlineTreeImage(svg, request.props.flip);
  let bytes = outlined.bytes;
  if (request.format === "png") {
    const { width, height } = request.props;
    const image = sharp(bytes, { limitInputPixels: 4_194_304 });
    if (width || height) image.resize(width, height);
    bytes = await image.png().toBuffer();
  }
  return {
    ...outlined,
    request,
    bytes,
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType:
      request.format === "svg"
        ? ("image/svg+xml" as const)
        : ("image/png" as const),
  };
}
