import type { ChatSource } from "../contracts";

interface PdfTextItem {
  str?: string;
  transform: number[];
}

interface PdfJs {
  version: string;
  getDocument(options: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getMetadata(): Promise<{
        info?: { Author?: string; Title?: string };
        metadata?: unknown;
      }>;
      getPage(pageNumber: number): Promise<{
        getTextContent(): Promise<{ items: PdfTextItem[] }>;
      }>;
    }>;
    /** Releases the document, transport and worker; safe before the promise settles. */
    destroy(): Promise<void>;
  };
}

/**
 * Extracts one text passage per non-empty PDF page.
 *
 * This preserves the retired LangChain 0.2 `PDFLoader` text joining and
 * metadata, so existing and newly ingested vectors cite pages identically.
 */
export async function loadPdfPages(bytes: Uint8Array): Promise<ChatSource[]> {
  // pdf-parse bundles the pdf.js build the previous loader used. Its Node
  // fallback worker clones the data instead of transferring it.
  const pdfjs: PdfJs = (
    await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js")
  ).default;
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const meta = await pdf.getMetadata().catch(() => null);
    const pdfMetadata = {
      version: pdfjs.version,
      info: meta?.info,
      metadata: meta?.metadata,
      totalPages: pdf.numPages,
    };
    const pages: ChatSource[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const { items } = await (await pdf.getPage(pageNumber)).getTextContent();
      if (!items.length) continue;
      // Start a new line when the baseline changes. A zero baseline counts as
      // unset, exactly as the retired loader treated it.
      let lastY: number | undefined;
      let text = "";
      for (const item of items) {
        if (item.str === undefined) continue;
        text +=
          lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
        lastY = item.transform[5];
      }
      pages.push({
        pageContent: text,
        metadata: {
          source: "blob",
          blobType: "",
          pdf: pdfMetadata,
          loc: { pageNumber },
        },
      });
    }
    return pages;
  } finally {
    // A parsed document keeps worker and transport state until destroyed,
    // whether parsing succeeded or failed.
    await task.destroy();
  }
}
