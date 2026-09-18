"use client";
import { Alert, Button, Snackbar } from "@mui/material";
import React from "react";
import {
  type AnyComponentImageLink,
  componentImagePath,
} from "@/render/componentImageUrl";
import { CONTRACTS } from "@/render/contracts";
import {
  copyPng,
  copySvg,
  copyText,
  downloadBlob,
  rasterizeSvg,
} from "./exportRuntime";
import { rasterSize, SvgExportError, serializeSvg } from "./svgExport";

const MESSAGES: Record<SvgExportError["code"], string> = {
  "no-target": "Nothing to export yet.",
  "no-viewport": "This image has no size to export.",
  "raster-too-large": "This image is too large to export as PNG.",
  "raster-failed": "Could not draw the PNG.",
  "clipboard-unavailable":
    "Clipboard access is not available here. Use Download instead.",
  "clipboard-denied": "The browser refused clipboard access.",
  "download-failed": "Could not start the download.",
};

interface Feedback {
  severity: "success" | "error";
  message: string;
}

export interface ExportControlsProps {
  /** The drawn SVG. Exports read the live element, so current interactive state is included. */
  target: React.RefObject<SVGSVGElement | null>;
  /** File name without extension. */
  filename: string;
  /**
   * Server-rendered image for a component with a validated contract. Only
   * registered slugs type-check, so wrapping alone never publishes anything.
   */
  link?: AnyComponentImageLink;
  /** Shown in place of the image links when the page has none for its current state. */
  linkNote?: string;
  /** Builds the interactive page URL that restores the current state. */
  share?: () => string;
}

/** Absolute form of a site-relative path for copying. */
function absolute(path: string): string {
  return new URL(path, window.location.origin).href;
}

/**
 * Download, clipboard and link controls for a live SVG. Each instance owns
 * its feedback, so several can share a page.
 */
export default function ExportControls({
  target,
  filename,
  link,
  linkNote,
  share,
}: ExportControlsProps) {
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  // Every action disables the controls until it settles; the PNG ones can
  // take a moment, and overlapping feedback would be misleading.
  const [pending, setPending] = React.useState(0);
  const busy = pending > 0;

  const element = () => {
    const svg = target.current;
    if (!svg) throw new SvgExportError("no-target");
    return svg;
  };
  // Serialise and start rasterising synchronously so clipboard writes keep
  // the user gesture; only the PNG bytes arrive later.
  const png = () => {
    const svg = element();
    const size = rasterSize(svg);
    return rasterizeSvg(serializeSvg(svg, size), size);
  };
  const run = async (operation: () => Promise<string>) => {
    setPending((count) => count + 1);
    try {
      setFeedback({ severity: "success", message: await operation() });
    } catch (error) {
      setFeedback({
        severity: "error",
        message:
          error instanceof SvgExportError
            ? MESSAGES[error.code]
            : "Export failed.",
      });
    } finally {
      setPending((count) => count - 1);
    }
  };

  const personal = link ? CONTRACTS[link.slug].personal : false;
  const svgPath = link && componentImagePath(link);
  const pngPath = link && componentImagePath(link, { format: "png" });
  const buttonSx = { minWidth: 0, px: 0.75, py: 0, fontSize: "inherit" };
  const linkSx = { px: 0.5 };
  return (
    <div style={{ textAlign: "center", fontSize: "90%" }}>
      <div>
        Download:
        <Button
          sx={buttonSx}
          aria-label="Download SVG"
          disabled={busy}
          onClick={() =>
            run(async () => {
              downloadBlob(
                new Blob([serializeSvg(element())], { type: "image/svg+xml" }),
                `${filename}.svg`,
              );
              return "Downloading SVG";
            })
          }
        >
          SVG
        </Button>
        |
        <Button
          sx={buttonSx}
          aria-label="Download PNG"
          disabled={busy}
          onClick={() =>
            run(async () => {
              downloadBlob(await png(), `${filename}.png`);
              return "Downloading PNG";
            })
          }
        >
          PNG
        </Button>
      </div>
      <div>
        Copy to clipboard:
        <Button
          sx={buttonSx}
          aria-label="Copy SVG to clipboard"
          disabled={busy}
          onClick={() =>
            run(async () =>
              (await copySvg(serializeSvg(element()))) === "image/svg+xml"
                ? "Copied SVG image to clipboard"
                : "Copied SVG text to clipboard",
            )
          }
        >
          SVG
        </Button>
        |
        <Button
          sx={buttonSx}
          aria-label="Copy PNG to clipboard"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await copyPng(png());
              return "Copied PNG to clipboard";
            })
          }
        >
          PNG
        </Button>
      </div>
      {svgPath && pngPath ? (
        <div>
          Image link:
          <Button
            sx={linkSx}
            component="a"
            href={svgPath}
            target="_blank"
            rel="noopener"
            aria-label="Open SVG image link"
          >
            SVG
          </Button>
          |
          <Button
            sx={linkSx}
            component="a"
            href={pngPath}
            target="_blank"
            rel="noopener"
            aria-label="Open PNG image link"
          >
            PNG
          </Button>
          |
          <Button
            sx={buttonSx}
            aria-label="Copy SVG image link"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await copyText(absolute(svgPath));
                return "Copied image link";
              })
            }
          >
            Copy link
          </Button>
        </div>
      ) : (
        linkNote && <div style={{ opacity: 0.7 }}>{linkNote}</div>
      )}
      {share && (
        <div>
          <Button
            sx={buttonSx}
            aria-label="Copy page link"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await copyText(absolute(share()));
                return "Copied page link";
              })
            }
          >
            Copy page link
          </Button>
        </div>
      )}
      {personal && (
        <div style={{ opacity: 0.7 }}>
          Links include what you entered here. Share them only when you mean to.
        </div>
      )}
      <Snackbar
        open={feedback !== null}
        autoHideDuration={2500}
        onClose={(_event, reason) =>
          reason !== "clickaway" && setFeedback(null)
        }
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {feedback ? (
          <Alert
            severity={feedback.severity}
            variant="filled"
            onClose={() => setFeedback(null)}
          >
            {feedback.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </div>
  );
}
