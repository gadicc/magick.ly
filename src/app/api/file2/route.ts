// NB: user authentication!!  only let logged in users upload.

import { NextRequest, NextResponse } from "next/server";
import {
  AWS,
  AWS_S3_BUCKET,
  createFileFromBuffer,
  Files,
} from "./createFileFromBuffer";

// shadowlang 2024-02-01
async function POST(req: NextRequest) {
  const formData = await req.formData();
  console.log(formData);

  const sha256 = formData.get("sha256") as string;
  const file = formData.get("file") as File | null;

  if (sha256 && typeof sha256 !== "string") {
    return NextResponse.json({ $error: { code: "INVALID_SHA256" } });
  }
  if (!file) return NextResponse.json({ $error: { code: "ENOENT" } });

  const entry = await createFileFromBuffer(
    Buffer.from(await file.arrayBuffer()),
    {
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      sha256,
    },
  );

  console.log(entry);
  return NextResponse.json(entry);
}
async function GET(req: NextRequest) {
  const sha256 = req.nextUrl.searchParams.get("sha256");
  const returnType = req.nextUrl.searchParams.get("return");

  if (!sha256) return NextResponse.json({ $error: { code: "INVALID_SHA256" } });

  const entry = await Files.findOne({ sha256 });
  if (!entry) {
    return returnType === "meta"
      ? NextResponse.json({ $error: { code: "ENOENT" } })
      : new Response("Not Found", { status: 404 });
  }

  // TODO, cache?
  if (returnType === "meta") return NextResponse.json(entry);

  /*
  if (entry.sha256 === req.headers.get("if-none-match")) {
    // TODO caching
    // Note that the server generating a 304 response MUST generate any of
    // the following header fields that would have been sent in a 200 (OK)
    // response to the same request: Cache-Control, Content-Location, Date,
    // ETag, Expires, and Vary.
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
    resHeaders(res, file);
    res.status(304).end();
  }
  */

  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: entry.sha256,
  };

  const result = await new AWS.S3().getObject(params).promise();
  console.log({ result });

  // TODO consider access control, ability to remove files, etc.
  const headers = new Headers({
    "Cache-Control": "public,max-age=31536000,immutable",
    ETag: "entry.sha256",
  });
  if (entry.mimeType) headers.set("Content-Type", entry.mimeType);
  if (entry.size) headers.set("Content-Length", entry.size.toString());
  if (entry.filename) {
    headers.set("Content-Disposition", `inline; filename="${entry.filename}"`);
  }

  return new Response(result.Body as Buffer, { status: 200, headers });
}

export { GET, POST };
