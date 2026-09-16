import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  type ComponentImageRequest,
  parseComponentImageRequest,
} from "./componentImageRequest";
import { CONTRACTS, type ComponentImageSlug } from "./contracts";
import { outlineComponentImage } from "./outlineTreeImage";
import { COMPONENT_IMAGE_REGISTRY } from "./registry";

type Outlined = Awaited<ReturnType<typeof outlineComponentImage>>;

export interface RenderedComponentImage<
  S extends ComponentImageSlug = ComponentImageSlug,
> extends Omit<Outlined, "bytes"> {
  request: ComponentImageRequest<S>;
  bytes: Buffer<ArrayBuffer>;
  byteSize: number;
  sha256: string;
  contentType: "image/svg+xml" | "image/png";
}

/** Render only the closed registry; callers cannot provide JSX, URLs or SVG. */
export function renderComponentImage<S extends ComponentImageSlug>(
  slug: S,
  searchParams: URLSearchParams,
): Promise<RenderedComponentImage<S>>;
export function renderComponentImage(
  slug: string,
  searchParams: URLSearchParams,
): Promise<RenderedComponentImage>;
export async function renderComponentImage(
  slug: string,
  searchParams: URLSearchParams,
): Promise<RenderedComponentImage> {
  const request = parseComponentImageRequest(slug, searchParams);
  const contract = CONTRACTS[request.slug];
  const registration = COMPONENT_IMAGE_REGISTRY[request.slug];
  // Dynamic import keeps React's document serializer out of Next's static RSC
  // import check, as in the previous image route.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const element = await registration.render(request.props as never);
  // This exact replacement is part of the recorded source digest.
  const svg = renderToStaticMarkup(element).replace(
    'xmlns="http://www.w3.org/2000/svg"',
    'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
  );
  const outlined = await outlineComponentImage(svg, {
    profile: registration.profile,
    viewBox: contract.viewBox,
    flip: registration.flip?.(request.props as never) ?? false,
    fonts: registration.fonts,
  });
  let bytes: Buffer<ArrayBuffer> = outlined.bytes;
  if (request.format === "png") {
    const { width, height } = request.props;
    const image = sharp(bytes, { limitInputPixels: 4_194_304 });
    if (width || height) image.resize(width, height);
    else if (contract.rasterDefault)
      image.resize(contract.rasterDefault.width, contract.rasterDefault.height);
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
