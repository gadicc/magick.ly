import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPdfPages } from "./pdfPages";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => {}),
}));

vi.mock("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js", () => ({
  default: { version: "1.10.100", getDocument: mocks.getDocument },
}));

const item = (str: string, y: number) => ({
  str,
  transform: [1, 0, 0, 1, 0, y],
});
function document(pages: { items: { str?: string; transform: number[] }[] }[]) {
  return {
    numPages: pages.length,
    getMetadata: async () => ({ info: { Title: "Reference" }, metadata: null }),
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => pages[pageNumber - 1],
    }),
  };
}

describe("bundled pdf.js page loading", () => {
  beforeEach(() => mocks.destroy.mockClear());

  it("joins text runs per baseline, skips empty pages and releases the document", async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve(
        document([
          {
            items: [
              item("A ritual", 700),
              item(" reference.", 700),
              item("Next line", 680),
            ],
          },
          { items: [] },
          { items: [{ transform: [1, 0, 0, 1, 0, 1] }, item("Third", 1)] },
        ]),
      ),
      destroy: mocks.destroy,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const pages = await loadPdfPages(bytes);
    expect(pages).toEqual([
      {
        pageContent: "A ritual reference.\nNext line",
        metadata: {
          source: "blob",
          blobType: "",
          pdf: {
            version: "1.10.100",
            info: { Title: "Reference" },
            metadata: null,
            totalPages: 3,
          },
          loc: { pageNumber: 1 },
        },
      },
      {
        pageContent: "Third",
        metadata: expect.objectContaining({ loc: { pageNumber: 3 } }),
      },
    ]);
    expect(mocks.getDocument.mock.calls[0][0]).toEqual({ data: bytes });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(["open", "page"])(
    "releases the document when the %s step fails",
    async (step) => {
      const failure = new Error("private parser detail");
      mocks.getDocument.mockReturnValue({
        promise:
          step === "open"
            ? Promise.reject(failure)
            : Promise.resolve({
                ...document([{ items: [item("A", 1)] }]),
                getPage: async () => {
                  throw failure;
                },
              }),
        destroy: mocks.destroy,
      });
      await expect(loadPdfPages(new Uint8Array([1]))).rejects.toBe(failure);
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
