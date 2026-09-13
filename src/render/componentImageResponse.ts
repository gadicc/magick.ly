import "server-only";
import { renderComponentImage } from "./componentImage";
import { InvalidComponentImageRequest } from "./componentImageRequest";

/** Public built-in diagram response, shared by canonical and legacy URL paths. */
export async function componentImageResponse(slug: string, request: Request) {
  try {
    const image = await renderComponentImage(
      slug,
      new URL(request.url).searchParams,
    );
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    if (error instanceof InvalidComponentImageRequest) {
      return new Response("Unsupported component image request", {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw error;
  }
}
