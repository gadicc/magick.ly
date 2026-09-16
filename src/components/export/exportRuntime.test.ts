// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clipboardWriteSupported,
  copyPng,
  copySvg,
  copyText,
  downloadBlob,
  rasterizeSvg,
} from "./exportRuntime";
import { SvgExportError } from "./svgExport";

class FakeClipboardItem {
  static supported = new Set<string>();
  static supports(type: string) {
    return FakeClipboardItem.supported.has(type);
  }
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

function installClipboard(options: {
  item?: typeof FakeClipboardItem | undefined;
  write?: ReturnType<typeof vi.fn>;
  writeText?: ReturnType<typeof vi.fn>;
}) {
  vi.stubGlobal("ClipboardItem", options.item);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      ...(options.write ? { write: options.write } : {}),
      ...(options.writeText ? { writeText: options.writeText } : {}),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeClipboardItem.supported.clear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("clipboard writes", () => {
  it("reports support from ClipboardItem.supports and assumes PNG only without it", () => {
    installClipboard({ item: FakeClipboardItem, write: vi.fn() });
    FakeClipboardItem.supported.add("image/svg+xml");
    expect(clipboardWriteSupported("image/svg+xml")).toBe(true);
    expect(clipboardWriteSupported("image/png")).toBe(false);
    class Bare {}
    installClipboard({ item: Bare as never, write: vi.fn() });
    expect(clipboardWriteSupported("image/png")).toBe(true);
    expect(clipboardWriteSupported("image/svg+xml")).toBe(false);
    installClipboard({ item: undefined, write: vi.fn() });
    expect(clipboardWriteSupported("image/png")).toBe(false);
  });

  it("copies PNG through a promise-valued item created before the bytes exist", async () => {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => {});
    installClipboard({ item: FakeClipboardItem, write });
    FakeClipboardItem.supported.add("image/png");
    let resolve!: (blob: Blob) => void;
    const png = new Promise<Blob>((r) => {
      resolve = r;
    });
    const pending = copyPng(png);
    expect(write).toHaveBeenCalledTimes(1);
    const [item] = write.mock.calls[0][0];
    expect(item.items["image/png"]).toBe(png);
    resolve(new Blob(["png"]));
    await expect(pending).resolves.toBeUndefined();
  });

  it("maps clipboard rejections and missing APIs to export errors", async () => {
    installClipboard({
      item: FakeClipboardItem,
      write: vi.fn(async (_items: FakeClipboardItem[]) => {
        throw new DOMException("denied", "NotAllowedError");
      }),
    });
    FakeClipboardItem.supported.add("image/png");
    await expect(copyPng(Promise.resolve(new Blob()))).rejects.toEqual(
      new SvgExportError("clipboard-denied"),
    );
    installClipboard({
      item: FakeClipboardItem,
      write: vi.fn(async (_items: FakeClipboardItem[]) => {
        throw new SvgExportError("raster-too-large");
      }),
    });
    await expect(copyPng(Promise.resolve(new Blob()))).rejects.toEqual(
      new SvgExportError("raster-too-large"),
    );
    installClipboard({ item: undefined });
    // A raster that fails after the clipboard was refused must not surface as
    // an unhandled rejection; vitest would fail the run if it did.
    const failing = Promise.reject(new SvgExportError("raster-failed"));
    await expect(copyPng(failing)).rejects.toEqual(
      new SvgExportError("clipboard-unavailable"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(copySvg("<svg/>")).rejects.toEqual(
      new SvgExportError("clipboard-unavailable"),
    );
    await expect(copyText("x")).rejects.toEqual(
      new SvgExportError("clipboard-unavailable"),
    );
  });

  it("copies SVG as an image where supported and as text elsewhere", async () => {
    const write = vi.fn(async (_items: FakeClipboardItem[]) => {});
    const writeText = vi.fn(async () => {});
    installClipboard({ item: FakeClipboardItem, write, writeText });
    FakeClipboardItem.supported.add("image/svg+xml");
    await expect(copySvg("<svg/>")).resolves.toBe("image/svg+xml");
    const [item] = write.mock.calls[0][0];
    expect(Object.keys(item.items)).toEqual(["image/svg+xml", "text/plain"]);
    expect(writeText).not.toHaveBeenCalled();

    FakeClipboardItem.supported.clear();
    await expect(copySvg("<svg/>")).resolves.toBe("text/plain");
    expect(writeText).toHaveBeenCalledWith("<svg/>");
    await copyText("link");
    expect(writeText).toHaveBeenLastCalledWith("link");
  });
});

describe("downloads and rasterisation", () => {
  it("clicks a temporary anchor and revokes the object URL later", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("tree.svg");
        expect(this.href).toBe("blob:test");
        expect(this.isConnected).toBe(true);
      });
    downloadBlob(new Blob(["<svg/>"]), "tree.svg");
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });

  it("revokes immediately and reports when the download cannot start", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:test",
      revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => downloadBlob(new Blob(), "x.png")).toThrow(
      new SvgExportError("download-failed"),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });

  it("draws at the explicit size, encodes PNG and releases the source URL", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:svg",
      revokeObjectURL,
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        expect(value).toBe("blob:svg");
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (this: HTMLCanvasElement, callback, type) {
        expect([this.width, this.height]).toEqual([300, 150]);
        expect(type).toBe("image/png");
        callback(new Blob(["png"], { type: "image/png" }));
      });
    const png = await rasterizeSvg("<svg/>", { width: 300, height: 150 });
    expect(png.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalledWith(
      expect.any(FakeImage),
      0,
      0,
      300,
      150,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:svg");

    toBlob.mockImplementation((callback) => callback(null));
    await expect(
      rasterizeSvg("<svg/>", { width: 1, height: 1 }),
    ).rejects.toEqual(new SvgExportError("raster-failed"));
    getContext.mockReturnValue(null);
    await expect(
      rasterizeSvg("<svg/>", { width: 1, height: 1 }),
    ).rejects.toEqual(new SvgExportError("raster-failed"));
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    await expect(
      rasterizeSvg("<svg/>", { width: 1, height: 1 }),
    ).rejects.toEqual(new SvgExportError("raster-failed"));
    expect(revokeObjectURL).toHaveBeenCalledTimes(4);
    getContext.mockRestore();
    toBlob.mockRestore();
  });
});
