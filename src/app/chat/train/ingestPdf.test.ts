import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestPdf, MAX_PDF_BYTES } from "./ingestPdf";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  createCorpus: vi.fn(),
  upsertChunks: vi.fn(),
}));

vi.mock("@langchain/community/document_loaders/fs/pdf", () => ({
  PDFLoader: class {
    load = mocks.load;
  },
}));
vi.mock("../corpus", () => ({ createPineconeCorpus: mocks.createCorpus }));

const pdf = (name = "ritual.pdf") =>
  new File(["%PDF-1.7\nfixture"], name, { type: "application/pdf" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PINECONE_INDEX_NAME", "chat-index");
  vi.stubEnv("PINECONE_NAME_SPACE", "chat-corpus");
  mocks.load.mockResolvedValue([
    {
      pageContent: "A ritual reference. ".repeat(90),
      metadata: {
        pdf: { info: { Title: "Reference", Author: "Example" } },
        loc: { pageNumber: 3 },
      },
    },
  ]);
  mocks.createCorpus.mockReturnValue({ upsertChunks: mocks.upsertChunks });
  mocks.upsertChunks.mockImplementation(async (_documents, ids) => [...ids]);
});

afterEach(() => vi.unstubAllEnvs());

describe("PDF corpus ingestion", () => {
  it("extracts a real PDF using the installed parser before indexing", async () => {
    const stream = "BT /F1 12 Tf 40 100 Td (A ritual reference.) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let source = "%PDF-1.4\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(source.length);
      source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = source.length;
    source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) {
      source += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = new File([source], "reference.pdf", {
      type: "application/pdf",
    });
    const { PDFLoader } = await vi.importActual<
      typeof import("@langchain/community/document_loaders/fs/pdf")
    >("@langchain/community/document_loaders/fs/pdf");
    mocks.load.mockImplementation(() => new PDFLoader(file).load());

    await expect(ingestPdf(file)).resolves.toMatchObject({ chunks: 1 });
    expect(mocks.upsertChunks.mock.calls[0][0][0]).toMatchObject({
      pageContent: "A ritual reference.",
      metadata: { source: "reference.pdf", loc: { pageNumber: 1 } },
    });
  });

  it("indexes extracted text with citation metadata in the retrieval namespace", async () => {
    const result = await ingestPdf(pdf());
    expect(result.chunks).toBeGreaterThan(1);
    expect(result.sourceId).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.createCorpus).toHaveBeenCalledWith(
      "chat-index",
      "chat-corpus",
    );
    const [chunks, ids] = mocks.upsertChunks.mock.calls[0];
    expect(ids).toHaveLength(chunks.length);
    expect(new Set(ids).size).toBe(chunks.length);
    expect(
      chunks.every(
        (chunk: { pageContent: string }) => chunk.pageContent.length <= 1000,
      ),
    ).toBe(true);
    expect(chunks[0].metadata).toMatchObject({
      source: "ritual.pdf",
      sourceSha256: result.sourceId,
      pdf: { info: { Title: "Reference", Author: "Example" } },
      loc: { pageNumber: 3 },
    });
  });

  it("reuses the same vector keys when retrying a partially failed upload", async () => {
    mocks.upsertChunks.mockRejectedValueOnce(new Error("private SDK details"));
    await expect(ingestPdf(pdf())).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("Some chunks may already be indexed"),
    });
    const firstIds = mocks.upsertChunks.mock.calls[0][1];
    await expect(ingestPdf(pdf("renamed.pdf"))).resolves.toMatchObject({
      chunks: firstIds.length,
    });
    expect(mocks.upsertChunks.mock.calls[1][1]).toEqual(firstIds);
  });

  it("does not acknowledge an incomplete vector result", async () => {
    mocks.upsertChunks.mockResolvedValueOnce([]);
    await expect(ingestPdf(pdf())).rejects.toMatchObject({ status: 502 });
  });

  it.each([
    ["empty", () => new File([], "empty.pdf"), 400],
    [
      "oversized",
      () => new File([new Uint8Array(MAX_PDF_BYTES + 1)], "big.pdf"),
      413,
    ],
    [
      "non-PDF",
      () => new File(["not PDF"], "fake.pdf", { type: "application/pdf" }),
      400,
    ],
  ])(
    "rejects an %s file before parsing or indexing",
    async (_name, makeFile, status) => {
      await expect(ingestPdf(makeFile())).rejects.toMatchObject({ status });
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.createCorpus).not.toHaveBeenCalled();
    },
  );

  it("rejects missing target configuration without contacting providers", async () => {
    vi.stubEnv("PINECONE_NAME_SPACE", "");
    await expect(ingestPdf(pdf())).rejects.toMatchObject({ status: 503 });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.createCorpus).not.toHaveBeenCalled();
  });

  it("rejects unreadable PDFs without leaking parser details", async () => {
    mocks.load.mockRejectedValue(new Error("private parser details"));
    await expect(ingestPdf(pdf())).rejects.toMatchObject({
      status: 400,
      message: expect.not.stringContaining("private"),
    });
    expect(mocks.upsertChunks).not.toHaveBeenCalled();
  });

  it.each([[], [{ pageContent: "  \n", metadata: {} }]])(
    "rejects PDFs without extractable text",
    async (...pages) => {
      mocks.load.mockResolvedValue(pages);
      await expect(ingestPdf(pdf())).rejects.toMatchObject({ status: 400 });
      expect(mocks.upsertChunks).not.toHaveBeenCalled();
    },
  );
});
