import "server-only";
import { renderComponentImage } from "./componentImage";
import { InvalidComponentImageRequest } from "./componentImageRequest";
import {
  componentImageFilename,
  contentDisposition,
} from "./componentImageUrl";
import { CONTRACTS } from "./contracts";

/**
 * Bytes only change with a deployment, which purges the edge cache, so the
 * CDN may hold them for a day while browsers revalidate through the ETag.
 */
export const COMPONENT_IMAGE_CACHE_CONTROL =
  "public, max-age=0, must-revalidate, s-maxage=86400, stale-while-revalidate=604800";

function badRequest() {
  return new Response("Unsupported component image request", {
    status: 400,
    headers: { "Cache-Control": "no-store" },
  });
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === "*" || value === etag);
}

/** Public built-in diagram response, shared by canonical and legacy URL paths. */
export async function componentImageResponse(slug: string, request: Request) {
  const searchParams = new URL(request.url).searchParams;
  // `download` only changes the response disposition; it is not part of the
  // rendering request or the identities the offline catalogs record.
  const download = searchParams.get("download");
  if (download !== null) {
    if (download !== "1" || searchParams.getAll("download").length > 1)
      return badRequest();
    searchParams.delete("download");
  }
  try {
    const image = await renderComponentImage(slug, searchParams);
    const contract = CONTRACTS[image.request.slug];
    const etag = `"${image.sha256}"`;
    const filename = `${componentImageFilename(image.request)}.${image.request.format}`;
    const headers: Record<string, string> = {
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": COMPONENT_IMAGE_CACHE_CONTROL,
      ETag: etag,
      "Content-Disposition": contentDisposition(
        download ? "attachment" : "inline",
        filename,
      ),
    };
    if (contract.personal) headers["X-Robots-Tag"] = "noindex";
    if (matchesEtag(request.headers.get("if-none-match"), etag))
      return new Response(null, { status: 304, headers });
    return new Response(image.bytes, {
      headers: { ...headers, "Content-Length": String(image.bytes.length) },
    });
  } catch (error) {
    if (error instanceof InvalidComponentImageRequest) return badRequest();
    throw error;
  }
}
