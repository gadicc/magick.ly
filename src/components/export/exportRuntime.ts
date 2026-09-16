/**
 * Browser side effects behind the export controls: rasterisation, downloads
 * and the async clipboard. Kept apart from the pure serialisation so the UI
 * can be tested with these mocked.
 */
import { type RasterSize, SvgExportError } from "./svgExport";

/** Draws standalone SVG text onto a canvas of the given size and encodes PNG. */
export async function rasterizeSvg(
  svgText: string,
  size: RasterSize,
): Promise<Blob> {
  const url = URL.createObjectURL(
    new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new SvgExportError("raster-failed"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new SvgExportError("raster-failed");
    // Explicit destination size: an SVG without intrinsic dimensions is drawn
    // at engine-specific default sizes otherwise.
    context.drawImage(image, 0, 0, size.width, size.height);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png) throw new SvgExportError("raster-failed");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Starts a browser download through a temporary anchor and releases the object URL later. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch {
    URL.revokeObjectURL(url);
    throw new SvgExportError("download-failed");
  }
  // Revoking synchronously can cancel an in-progress download in WebKit.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type ClipboardItemStatic = typeof ClipboardItem & {
  supports?: (type: string) => boolean;
};

/** Async clipboard write support for a MIME type; only PNG is assumed without `supports()`. */
export function clipboardWriteSupported(type: string): boolean {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    return false;
  const item = ClipboardItem as ClipboardItemStatic;
  return typeof item.supports === "function"
    ? item.supports(type)
    : type === "image/png";
}

async function guard<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof SvgExportError) throw error;
    throw new SvgExportError("clipboard-denied");
  }
}

/**
 * Copies a PNG that is still being produced. The ClipboardItem is created
 * synchronously inside the user gesture with a promise value, which Safari
 * requires; awaiting the blob first loses the gesture.
 */
export function copyPng(png: Promise<Blob>): Promise<void> {
  if (!clipboardWriteSupported("image/png")) {
    // Nobody else observes the raster once the clipboard is unavailable.
    png.catch(() => {});
    return Promise.reject(new SvgExportError("clipboard-unavailable"));
  }
  return guard(
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })]),
  );
}

/** Copies SVG as an image where the browser allows it, otherwise as text. */
export async function copySvg(
  svgText: string,
): Promise<"image/svg+xml" | "text/plain"> {
  if (clipboardWriteSupported("image/svg+xml")) {
    await guard(
      navigator.clipboard.write([
        new ClipboardItem({
          "image/svg+xml": new Blob([svgText], { type: "image/svg+xml" }),
          "text/plain": new Blob([svgText], { type: "text/plain" }),
        }),
      ]),
    );
    return "image/svg+xml";
  }
  if (!navigator.clipboard?.writeText)
    throw new SvgExportError("clipboard-unavailable");
  await guard(navigator.clipboard.writeText(svgText));
  return "text/plain";
}

/** Copies plain text such as a link. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText)
    throw new SvgExportError("clipboard-unavailable");
  await guard(navigator.clipboard.writeText(text));
}
