// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExportControls, { type ExportControlsProps } from "./ExportControls";
import { SvgExportError } from "./svgExport";

const runtime = vi.hoisted(() => ({
  rasterizeSvg: vi.fn(),
  downloadBlob: vi.fn(),
  copySvg: vi.fn(),
  copyPng: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("./exportRuntime", () => runtime);

function Page({
  filename,
  viewBox,
  ...rest
}: { filename: string; viewBox?: string } & Partial<ExportControlsProps>) {
  const ref = React.useRef<SVGSVGElement>(null);
  return (
    <section aria-label={filename}>
      <svg ref={ref} viewBox={viewBox} id="shared">
        <title>{filename}</title>
        <circle r="1" id="shared" />
      </svg>
      <ExportControls target={ref} filename={filename} {...rest} />
    </section>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExportControls", () => {
  it("exports each instance's own SVG with unique ids and confirms", async () => {
    runtime.copySvg.mockResolvedValue("image/svg+xml");
    render(
      <>
        <Page filename="one" viewBox="0 0 10 10" />
        <Page filename="two" viewBox="0 0 20 10" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Copy SVG to clipboard");
    fireEvent.click(second);
    expect(
      await screen.findByText("Copied SVG image to clipboard"),
    ).toBeTruthy();
    expect(runtime.copySvg).toHaveBeenCalledTimes(1);
    const text = runtime.copySvg.mock.calls[0][0] as string;
    expect(text).toContain("<title>two</title>");
    expect(text).not.toContain("one");
    expect(text.match(/id="shared"/g)).toHaveLength(1);
    expect(text).toContain('id="shared-2"');

    runtime.copySvg.mockResolvedValue("text/plain");
    fireEvent.click(first);
    expect(
      await screen.findByText("Copied SVG text to clipboard"),
    ).toBeTruthy();
    expect(runtime.copySvg.mock.calls[1][0]).toContain("<title>one</title>");
  });

  it("downloads SVG synchronously and PNG after rasterising at the computed size", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    runtime.rasterizeSvg.mockResolvedValue(png);
    render(<Page filename="tree" viewBox="-170.5 0 341 598" />);
    fireEvent.click(screen.getByLabelText("Download SVG"));
    expect(runtime.downloadBlob).toHaveBeenCalledTimes(1);
    const [svgBlob, svgName] = runtime.downloadBlob.mock.calls[0] as [
      Blob,
      string,
    ];
    expect(svgName).toBe("tree.svg");
    expect(svgBlob.type).toBe("image/svg+xml");
    expect(await svgBlob.text()).toContain('viewBox="-170.5 0 341 598"');
    expect(await screen.findByText("Downloading SVG")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Download PNG"));
    expect(runtime.rasterizeSvg).toHaveBeenCalledWith(
      expect.stringContaining('width="1168"'),
      { width: 1168, height: 2048 },
    );
    expect(await screen.findByText("Downloading PNG")).toBeTruthy();
    expect(runtime.downloadBlob).toHaveBeenLastCalledWith(png, "tree.png");
  });

  it("hands the pending PNG promise to the clipboard inside the click", async () => {
    let resolve!: (blob: Blob) => void;
    runtime.rasterizeSvg.mockReturnValue(
      new Promise<Blob>((r) => {
        resolve = r;
      }),
    );
    runtime.copyPng.mockImplementation(async (pending: Promise<Blob>) => {
      await pending;
    });
    render(<Page filename="x" viewBox="0 0 10 10" />);
    const copy = screen.getByLabelText("Copy PNG to clipboard");
    fireEvent.click(copy);
    expect(runtime.copyPng).toHaveBeenCalledTimes(1);
    expect(runtime.copyPng.mock.calls[0][0]).toBeInstanceOf(Promise);
    for (const label of [
      "Copy PNG to clipboard",
      "Download PNG",
      "Download SVG",
      "Copy SVG to clipboard",
    ])
      expect((screen.getByLabelText(label) as HTMLButtonElement).disabled).toBe(
        true,
      );
    resolve(new Blob());
    expect(await screen.findByText("Copied PNG to clipboard")).toBeTruthy();
    expect((copy as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains failures instead of throwing", async () => {
    runtime.copyPng.mockRejectedValue(
      new SvgExportError("clipboard-unavailable"),
    );
    runtime.rasterizeSvg.mockResolvedValue(new Blob());
    runtime.copySvg.mockRejectedValue(new Error("boom"));
    render(<Page filename="x" viewBox="0 0 10 10" />);
    fireEvent.click(screen.getByLabelText("Copy PNG to clipboard"));
    expect(
      await screen.findByText(
        "Clipboard access is not available here. Use Download instead.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Copy SVG to clipboard"));
    expect(await screen.findByText("Export failed.")).toBeTruthy();
  });

  it("refuses PNG for an image without a viewport and copes with a missing target", async () => {
    render(<Page filename="x" />);
    fireEvent.click(screen.getByLabelText("Download PNG"));
    expect(
      await screen.findByText("This image has no size to export."),
    ).toBeTruthy();
    expect(runtime.rasterizeSvg).not.toHaveBeenCalled();

    function Detached() {
      const ref = React.useRef<SVGSVGElement>(null);
      return <ExportControls target={ref} filename="none" />;
    }
    render(<Detached />);
    fireEvent.click(screen.getAllByLabelText("Download SVG")[1]);
    expect(await screen.findByText("Nothing to export yet.")).toBeTruthy();
    expect(runtime.downloadBlob).not.toHaveBeenCalled();
  });

  it("offers canonical image links only for registered contracts", async () => {
    runtime.copyText.mockResolvedValue(undefined);
    render(
      <Page
        filename="tree"
        viewBox="-170.5 0 341 598"
        link={{
          slug: "tree-of-life",
          props: {
            field: "name.roman",
            topText: "index",
            bottomText: "",
            colorScale: "queen",
            letterAttr: "hermetic",
            flip: false,
            showDaat: false,
            fontSize: 10,
          },
        }}
        share={() => "/kabbalah/tree?field=name.roman"}
      />,
    );
    const svg = screen.getByLabelText(
      "Open SVG image link",
    ) as HTMLAnchorElement;
    const png = screen.getByLabelText(
      "Open PNG image link",
    ) as HTMLAnchorElement;
    expect(svg.getAttribute("href")).toBe(
      "/api/render/tree-of-life?field=name.roman&fontSize=10",
    );
    expect(png.getAttribute("href")).toBe(
      "/api/render/tree-of-life?fmt=png&field=name.roman&fontSize=10",
    );
    expect(svg.target).toBe("_blank");
    expect(screen.queryByText(/Links include/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Copy SVG image link"));
    expect(await screen.findByText("Copied image link")).toBeTruthy();
    expect(runtime.copyText).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/render/tree-of-life?field=name.roman&fontSize=10`,
    );
    fireEvent.click(screen.getByLabelText("Copy page link"));
    expect(await screen.findByText("Copied page link")).toBeTruthy();
    expect(runtime.copyText).toHaveBeenLastCalledWith(
      `${window.location.origin}/kabbalah/tree?field=name.roman`,
    );
  });

  it("keeps two linked instances independent and never warns for a share-only page", async () => {
    runtime.copyText.mockResolvedValue(undefined);
    render(
      <>
        <Page
          filename="a"
          viewBox="0 0 1 1"
          link={{ slug: "seven-branched-candlestick", props: {} }}
        />
        <Page
          filename="b"
          viewBox="0 0 1 1"
          link={{
            slug: "enochian-tablet",
            props: { id: "air", font: "latin" },
          }}
          share={() => "/enochian/tablets"}
        />
      </>,
    );
    const [first, second] = screen.getAllByLabelText(
      "Open SVG image link",
    ) as HTMLAnchorElement[];
    expect(first.getAttribute("href")).toBe(
      "/api/render/seven-branched-candlestick",
    );
    expect(second.getAttribute("href")).toBe(
      "/api/render/enochian-tablet?id=air",
    );
    fireEvent.click(screen.getAllByLabelText("Copy SVG image link")[1]);
    expect(await screen.findByText("Copied image link")).toBeTruthy();
    expect(runtime.copyText).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/render/enochian-tablet?id=air`,
    );
    expect(screen.queryByText(/Links include/)).toBeNull();
    expect(screen.getAllByLabelText("Copy page link")).toHaveLength(1);
  });

  it("explains a missing link instead of hiding it silently", () => {
    render(
      <Page
        filename="tree"
        viewBox="-170.5 0 341 598"
        linkNote="No image link for this combination."
        share={() => "/kabbalah/tree?showDaat=true&colorScale=king"}
      />,
    );
    expect(
      screen.getByText("No image link for this combination."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Open SVG image link")).toBeNull();
    expect(screen.queryByText(/Links include/)).toBeNull();
    expect(screen.getByLabelText("Copy page link")).toBeTruthy();
  });

  it("warns that links carry personal state for personal contracts", () => {
    render(
      <Page
        filename="sigil"
        viewBox="-50 -50 100 100"
        link={{ slug: "rose-sigil", props: { text: "גדי", rose: true } }}
      />,
    );
    expect(screen.getByText(/Links include what you entered/)).toBeTruthy();
    expect(
      (
        screen.getByLabelText("Open PNG image link") as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/api/render/rose-sigil?fmt=png&text=%D7%92%D7%93%D7%99");
    cleanup();
    render(<Page filename="plain" viewBox="0 0 1 1" />);
    expect(screen.queryByText(/Image link/)).toBeNull();
    expect(screen.queryByLabelText("Copy page link")).toBeNull();
  });
});
