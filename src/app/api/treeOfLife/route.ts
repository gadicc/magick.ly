import React from "react";
// import { renderToString } from "react-dom/server";
import beautify from "xml-beautifier";
import sharp from "sharp";

import TreeOfLife from "@/components/kabbalah/TreeOfLife";

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
console.log(__dirname);
console.log(path.resolve("."));
console.log(path.resolve("./public"));
console.log(path.resolve("./public/fonts.conf"));

const fontsDir = path.resolve("public", "fonts.conf");
process.env.FONTCONFIG_FILE = "/var/task/public/fonts.conf";
console.log(fs.readFileSync(fontsDir).toString());

// Helper function to convert Node.js stream to Web API ReadableStream
function nodeReadableStreamToWebReadableStream(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        controller.enqueue(chunk);
      });

      nodeStream.on("end", () => {
        controller.close();
      });

      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = Object.fromEntries(searchParams.entries());

  // https://github.com/vercel/next.js/discussions/69244
  // https://stackoverflow.com/questions/77978991/rendertostring-youre-importing-a-component-that-imports-react-dom-server
  const { renderToString } = await import("react-dom/server");

  let svgText =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderToString(React.createElement(TreeOfLife, query as any));

  // since React doesn't support namespace tags
  svgText = svgText.replace(
    'xmlns="http://www.w3.org/2000/svg"',
    'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
  );

  const fmt = searchParams.get("fmt");
  if (!fmt || fmt === "svg") {
    return new Response(beautify(svgText), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
      },
    });
  } else {
    /*
    svgText = svgText.replace(
      /url('\/fonts\//g,
      "url('https://magick.ly/fonts/",
    );
    */

    const s = sharp(Buffer.from(svgText));

    const width = searchParams.get("width");
    const height = searchParams.get("height");

    if (width && height) s.resize(Number(width), Number(height));

    // s.toFormat("png").pipe(res);
    const buffer = await s.toFormat("png").toBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": buffer.length.toString(),
      },
    });
  }
}
