import "server-only";

import {
  type LegacyPublicFile,
  sameLegacyPublicFile,
} from "./legacyPublicFiles";
import type { LegacyPublicObjectStorage } from "./legacyPublicR2";

type Reader = (sha256: string) => Promise<LegacyPublicFile | null>;

function error(status: number, message: string) {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function disposition(value: string) {
  const fallback = value.replaceAll(/[^\x20-\x7e]|["\\]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(value)}`;
}

function responseHeaders(file: LegacyPublicFile) {
  const result = new Headers({
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": file.byteSize.toString(),
    "content-security-policy":
      "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    "content-type": file.contentType,
    "cross-origin-resource-policy": "same-origin",
    etag: `"${file.sha256}"`,
    "x-content-type-options": "nosniff",
  });
  if (file.originalFilename)
    result.set("content-disposition", disposition(file.originalFilename));
  return result;
}

function close(body: BodyInit) {
  if (body instanceof ReadableStream) void body.cancel().catch(() => {});
}

export function createLegacyPublicFileGet(options: {
  read: Reader;
  storage: LegacyPublicObjectStorage;
}) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];
    const sha256 = url.searchParams.get("sha256") ?? "";
    if (
      keys.length !== 1 ||
      keys[0] !== "sha256" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      return error(400, "Invalid file reference");
    let opened: BodyInit | undefined;
    try {
      const file = await options.read(sha256);
      if (!file) return error(404, "Not found");
      const headers = responseHeaders(file);
      const etag = headers.get("etag");
      const match = request.headers.get("if-none-match");
      if (
        match === "*" ||
        match?.split(",").some((value) => value.trim() === etag)
      )
        return new Response(null, { status: 304, headers });
      const object = await options.storage.read(file, request.signal);
      if (!object) return error(404, "Not found");
      opened = object.body;
      if (object.byteSize !== undefined && object.byteSize !== file.byteSize) {
        close(object.body);
        opened = undefined;
        return error(503, "File temporarily unavailable");
      }
      const current = await options.read(sha256);
      if (!current || !sameLegacyPublicFile(file, current)) {
        close(object.body);
        opened = undefined;
        return error(404, "Not found");
      }
      const response = new Response(object.body, { status: 200, headers });
      opened = undefined;
      return response;
    } catch {
      if (opened) close(opened);
      return error(503, "File temporarily unavailable");
    }
  };
}
