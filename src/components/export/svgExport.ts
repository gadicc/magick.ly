/**
 * Pure DOM helpers behind the export controls. They read a live SVG element
 * and produce a standalone document; nothing here touches the clipboard,
 * canvas or downloads, so the module is testable under jsdom.
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Pixel bounds for live-DOM rasterisation. Safari refuses canvases above 16,777,216 pixels. */
export const RASTER_LIMITS = Object.freeze({
  longSide: 2048,
  maxArea: 16_777_216,
});

export interface RasterSize {
  width: number;
  height: number;
}

export class SvgExportError extends Error {
  constructor(
    readonly code:
      | "no-target"
      | "no-viewport"
      | "raster-too-large"
      | "raster-failed"
      | "clipboard-unavailable"
      | "clipboard-denied"
      | "download-failed",
  ) {
    super(code);
    this.name = "SvgExportError";
  }
}

/** Width divided by height, from viewBox first and explicit pixel attributes second. */
export function svgAspect(svg: SVGSVGElement): number | null {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0)
      return parts[2] / parts[3];
  }
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  if (width > 0 && height > 0) return width / height;
  return null;
}

/** Pixel size for PNG output: the long side is fixed and the area stays inside canvas limits. */
export function rasterSize(
  svg: SVGSVGElement,
  limits: { longSide?: number; maxArea?: number } = {},
): RasterSize {
  const aspect = svgAspect(svg);
  if (!aspect) throw new SvgExportError("no-viewport");
  const longSide = limits.longSide ?? RASTER_LIMITS.longSide;
  const maxArea = limits.maxArea ?? RASTER_LIMITS.maxArea;
  const size =
    aspect >= 1
      ? { width: longSide, height: Math.round(longSide / aspect) }
      : { width: Math.round(longSide * aspect), height: longSide };
  if (size.width < 1 || size.height < 1 || size.width * size.height > maxArea)
    throw new SvgExportError("raster-too-large");
  return size;
}

/**
 * Inline stroke-dash declarations only exist on our drawn-on path animations,
 * where the end state is the fully drawn path. Attribute dash arrays (dashed
 * circles, debug rings) are intentional artwork and stay.
 */
function finishAnimations(root: Element) {
  for (const element of root.querySelectorAll<SVGElement>("[style]")) {
    element.style.removeProperty("stroke-dasharray");
    element.style.removeProperty("stroke-dashoffset");
    if (!element.getAttribute("style")) element.removeAttribute("style");
  }
}

/**
 * Browsers resolve a repeated id to its first element, so renaming later
 * duplicates keeps rendering identical while the file becomes valid XML.
 */
function renameDuplicateIds(root: Element) {
  const seen = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("[id]")]) {
    const id = element.getAttribute("id");
    if (!id) continue;
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    let n = 2;
    while (seen.has(`${id}-${n}`)) n++;
    element.setAttribute("id", `${id}-${n}`);
    seen.add(`${id}-${n}`);
  }
}

/**
 * XML serialisers derive namespace declarations from node namespaces. A
 * literal attribute named `xmlns` (React writes one) would be emitted twice,
 * and xlink attributes get a generated prefix unless a declaration is in
 * scope, so declare xlink explicitly whenever it is used.
 */
function normalizeNamespaces(root: Element) {
  for (const attribute of [...root.attributes]) {
    if (
      attribute.namespaceURI === null &&
      (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:"))
    )
      root.removeAttribute(attribute.name);
  }
  const usesXlink = [root, ...root.querySelectorAll("*")].some((element) =>
    [...element.attributes].some(
      (attribute) => attribute.namespaceURI === XLINK_NAMESPACE,
    ),
  );
  if (usesXlink)
    root.setAttributeNS(XMLNS_NAMESPACE, "xmlns:xlink", XLINK_NAMESPACE);
}

/** A detached copy of the drawn image with animations finished and ids unique. */
export function prepareSvgClone(
  svg: SVGSVGElement,
  size?: RasterSize,
): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  normalizeNamespaces(clone);
  finishAnimations(clone);
  renameDuplicateIds(clone);
  if (size) {
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));
  }
  return clone;
}

/**
 * Standalone SVG text. XMLSerializer emits namespace declarations (including
 * xlink) itself, so no string patching is needed. `size` pins pixel dimensions
 * for rasterisation; file and clipboard output keep the element's own sizing.
 */
export function serializeSvg(svg: SVGSVGElement, size?: RasterSize): string {
  const clone = prepareSvgClone(svg, size);
  const body = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}
