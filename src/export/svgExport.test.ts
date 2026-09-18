// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  prepareSvgClone,
  rasterSize,
  SvgExportError,
  serializeSvg,
  svgAspect,
} from "./svgExport";

function svg(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.append(host);
  return host.querySelector("svg") as SVGSVGElement;
}

describe("svg export serialisation", () => {
  it("derives the aspect from viewBox before pixel attributes", () => {
    expect(
      svgAspect(svg('<svg viewBox="-170.5 0 341 598" width="100%"></svg>')),
    ).toBeCloseTo(341 / 598);
    expect(svgAspect(svg('<svg width="200" height="100"></svg>'))).toBe(2);
    expect(svgAspect(svg("<svg></svg>"))).toBeNull();
    expect(svgAspect(svg('<svg viewBox="0 0 0 10"></svg>'))).toBeNull();
  });

  it("sizes rasters by the long side inside the canvas area limit", () => {
    expect(rasterSize(svg('<svg viewBox="-50 -50 100 100"></svg>'))).toEqual({
      width: 2048,
      height: 2048,
    });
    expect(rasterSize(svg('<svg viewBox="-170.5 0 341 598"></svg>'))).toEqual({
      width: 1168,
      height: 2048,
    });
    expect(
      rasterSize(svg('<svg viewBox="0 0 400 100"></svg>'), { longSide: 400 }),
    ).toEqual({ width: 400, height: 100 });
    expect(() =>
      rasterSize(svg('<svg viewBox="0 0 1 1"></svg>'), { maxArea: 1000 }),
    ).toThrow(new SvgExportError("raster-too-large"));
    expect(() => rasterSize(svg("<svg></svg>"))).toThrow(
      new SvgExportError("no-viewport"),
    );
  });

  it("produces standalone XML with namespaces and leaves the live element alone", () => {
    const element = svg(
      '<svg viewBox="0 0 10 10" width="100%"><a xlink:href="/x"><circle r="1"/></a></svg>',
    );
    const text = serializeSvg(element);
    expect(
      text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg'),
    ).toBe(true);
    expect(
      text.match(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g),
    ).toHaveLength(1);
    expect(text).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(text).toContain('xlink:href="/x"');
    expect(serializeSvg(svg('<svg viewBox="0 0 1 1"/>'))).not.toContain(
      "xlink",
    );
    expect(text).toContain('width="100%"');
    expect(text).not.toContain("height=");
    expect(element.outerHTML).not.toContain("xmlns:xlink");
    const sized = serializeSvg(element, { width: 300, height: 300 });
    expect(sized).toContain('width="300"');
    expect(sized).toContain('height="300"');
    expect(element.getAttribute("width")).toBe("100%");
  });

  it("drops the literal xmlns attribute React writes so the declaration is not doubled", () => {
    // React sets `xmlns` with setAttribute (null namespace) and xlink
    // attributes with setAttributeNS; innerHTML fixtures do not reproduce that.
    const element = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    element.setAttribute("viewBox", "0 0 4 4");
    const anchor = document.createElementNS("http://www.w3.org/2000/svg", "a");
    anchor.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "/k");
    element.append(anchor);
    document.body.append(element);
    const text = serializeSvg(element);
    expect(text.match(/xmlns="/g)).toHaveLength(1);
    expect(text).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(text).toContain('xlink:href="/k"');
    expect(element.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("finishes drawn-on animations without touching attribute dashes", () => {
    const element = svg(
      '<svg viewBox="0 0 10 10"><path style="stroke-dasharray: 58.4974; stroke-dashoffset: 58.4974;" d="M0 0L1 1"/><circle style="fill: red; stroke-dasharray: 2" r="1"/><circle stroke-dasharray="0.2" r="2"/></svg>',
    );
    const clone = prepareSvgClone(element);
    const [path, styled, dashed] = [
      clone.querySelector("path"),
      clone.querySelectorAll("circle")[0],
      clone.querySelectorAll("circle")[1],
    ];
    expect(path?.hasAttribute("style")).toBe(false);
    expect(styled?.getAttribute("style")).toBe("fill: red;");
    expect(dashed?.getAttribute("stroke-dasharray")).toBe("0.2");
    expect(element.querySelector("path")?.getAttribute("style")).toContain(
      "stroke-dashoffset",
    );
  });

  it("renames later duplicate ids so the first keeps its references", () => {
    const element = svg(
      '<svg viewBox="0 0 10 10" id="TreeOfLife"><a id="path1_2"><path d="M0 0"/></a><a id="path1_2"><text>א</text></a><a id="path1_2"><text>ב</text></a><use href="#path1_2"/></svg>',
    );
    const text = serializeSvg(element);
    expect(text.match(/ id="path1_2"/g)).toHaveLength(1);
    expect(text).toContain('id="path1_2-2"');
    expect(text).toContain('id="path1_2-3"');
    expect(text).toContain('href="#path1_2"');
    const ids = [...element.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.filter((id) => id === "path1_2")).toHaveLength(3);
  });
});
