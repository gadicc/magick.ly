import React from "react";
import { ToastContainer, toast } from "react-toastify";
import beautify from "xml-beautifier";
import "react-toastify/dist/ReactToastify.css";

function getSvgText(element) {
  const text = element.outerHTML;

  if (!text.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/))
    throw new Error("No XMLNS attribute found on SVG element, it won't work.");

  return (text
    .replace(
      // since React doesn't support namespace tags
      'xmlns="http://www.w3.org/2000/svg"',
      'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    )
    // assume this is only used for path annimations
    .replace(/stroke-dasharray: [\d\\.]+;? ?/g, "")
    .replace(/stroke-dashoffset: [\d\\.]+;? ?/g, ""));
}

function downloadSVG(event, element, filename) {
  // No event.preventDefault() since we want to download the new URL.

  const svgText = getSvgText(element);
  const pretty = beautify(svgText);
  const data = encodeURIComponent(pretty);

  const download = document.getElementById("downloadSVG");
  if (download) {
    download.setAttribute("download", filename + ".svg");
    download.setAttribute("href-lang", "image/svg+xml");
    download.setAttribute("href", "data:image/svg+xml;charset=utf-8," + data);
  } else {
    alert("No element with id `downloadSVG` found.");
  }
}

async function downloadPNG(event, element, filename) {
  // No event.preventDefault() since we want to download the new URL.

  let canvas;
  try {
    canvas = await drawnCanvas(element);
  } catch (error) {
    toast("❌ Could not draw canvas");
    return;
  }
  if (!canvas) return;

  const pngBlob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png", 0.9)
  );
  if (!pngBlob) return alert("Error creating PNG blob.");

  const url = URL.createObjectURL(pngBlob);
  const download = document.getElementById("downloadPNG");

  if (download) {
    download.setAttribute("download", filename + ".png");
    download.setAttribute("href-lang", "image/png");
    download.setAttribute("href", url);
  } else {
    alert("No element with id `downloadSVG` found.");
  }
}

async function copySVG(event, ref) {
  event.preventDefault();

  const svgText = getSvgText(ref);
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const item = new ClipboardItem({ "image/svg+xml": blob });

  try {
    await navigator.clipboard.write([item]);
  } catch (err) {
    if (
      err.message === "Type image/svg+xml not supported on write." ||
      err.message.match(/is not defined/)
    ) {
      // Fallback (and actually only way possible at time of writing)
      const textarea = document.createElement("textarea");
      textarea.value = svgText;
      document.body.appendChild(textarea);
      textarea.select();
      const result = document.execCommand("copy");
      document.body.removeChild(textarea);
      //if (result === "unsuccessful") {
      if (!result) {
        return toast("❌ Failed to Copy to Clipboard :(");
      }
    } else {
      throw err;
    }
  }

  toast("✅ Copied to clipboard as SVG");
}

async function drawnCanvas(element) {
  const svgText = getSvgText(element);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });

  const svgImage = new Image();
  const svgUrl = URL.createObjectURL(svgBlob);
  await new Promise((resolve, reject) => {
    svgImage.onload = resolve;
    svgImage.onerror = reject;
    svgImage.src = svgUrl;
  });
  URL.revokeObjectURL(svgUrl);

  const canvas = document.createElement("canvas");
  canvas.height = 1080;
  canvas.width = svgImage.width * (1080 / svgImage.height);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast("canvas.getContext('2d') failed :(");
    return null;
  }

  ctx.drawImage(svgImage, 0, 0);

  return canvas;
}

async function copyPNG(event, element) {
  event.preventDefault();

  let canvas;
  try {
    canvas = await drawnCanvas(element);
  } catch (error) {
    toast("❌ Could not draw canvas");
    return;
  }
  if (!canvas) return alert("No Canvas");

  const pngBlob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png", 0.9)
  );
  if (!pngBlob) return alert("Error creating PNG blob.");

  const item = new ClipboardItem({ "image/png": pngBlob });
  await navigator.clipboard.write([item]);
  toast("✅ PNG copied to clipboard");
}

const CopyPasteExport = React.forwardRef(function CopyPasteExport(
  { filename }: { filename: string },
  ref: React.RefObject<SVGSVGElement | null>
) {
  return (
    <div style={{ textAlign: "center", fontSize: "90%" }}>
      Download:{" "}
      <a
        href="#"
        id="downloadSVG"
        onClick={(e) => downloadSVG(e, ref?.current, filename)}
      >
        SVG
      </a>
      {" | "}
      <a
        href="#"
        id="downloadPNG"
        onClick={(e) => downloadPNG(e, ref?.current, filename)}
      >
        PNG
      </a>
      <br />
      Copy to Clipboard:{" "}
      <a href="#" id="copySVG" onClick={(e) => copySVG(e, ref?.current)}>
        SVG
      </a>
      {" | "}
      <a href="#" id="copyPNG" onClick={(e) => copyPNG(e, ref?.current)}>
        PNG
      </a>
      <br />
      {/*
      Hebrew Font:{" "}
      <a href="https://magick.ly/fonts/NotoSansHebrew-Regular.ttf">
        NotoSansHebrew-Regular.ttf
      </a>
      */}
    </div>
  );
});

export default CopyPasteExport;
export { ToastContainer };
