import { createHash } from "node:crypto";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

// Leave room for multipart overhead within Vercel's request-body limit.
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** An ingestion failure whose message and HTTP status are safe for the uploader. */
export class IngestionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

/** One PDF ingestion boundary; a future pgvector implementation can replace it. */
export async function ingestPdf(file: File) {
  if (!file.size) throw new IngestionError("The PDF is empty.", 400);
  if (file.size > MAX_PDF_BYTES) {
    throw new IngestionError("The PDF must be 4 MiB or smaller.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new IngestionError("Choose a PDF file.", 400);
  }

  const { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } = process.env;
  if (!PINECONE_INDEX_NAME || !PINECONE_NAME_SPACE) {
    throw new IngestionError("Chat training is not configured.", 503);
  }

  let pages: Awaited<ReturnType<PDFLoader["load"]>>;
  try {
    pages = await new PDFLoader(new Blob([bytes])).load();
  } catch {
    throw new IngestionError(
      "This PDF could not be read. Check that it is valid and unencrypted.",
      400,
    );
  }

  const documents = await new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  }).splitDocuments(pages.filter((page) => page.pageContent.trim()));
  const chunks = documents.filter((document) => document.pageContent.trim());
  if (!chunks.length) {
    throw new IngestionError(
      "This PDF has no extractable text. Scanned pages need OCR first.",
      400,
    );
  }

  const sourceId = createHash("sha256").update(bytes).digest("hex");
  // Content-addressed indexing keys make retries upserts, even after a partial
  // batch failure. These are derived vector keys, not application entity IDs.
  const ids = chunks.map((_, index) => `pdf-v1:${sourceId}:${index}`);
  for (const [index, chunk] of chunks.entries()) {
    chunk.metadata = {
      ...chunk.metadata,
      source: file.name,
      sourceSha256: sourceId,
      ingestionVersion: 1,
      chunkIndex: index,
    };
  }

  try {
    const pinecone = new Pinecone();
    const store = await PineconeStore.fromExistingIndex(
      // Match the installed retrieval client's defaults explicitly. Changing
      // embedding models requires reindexing the existing corpus first.
      new OpenAIEmbeddings({
        model: "text-embedding-ada-002",
        stripNewLines: true,
      }),
      {
        pineconeIndex: pinecone.Index(PINECONE_INDEX_NAME),
        namespace: PINECONE_NAME_SPACE,
      },
    );
    const writtenIds = await store.addDocuments(chunks, { ids });
    if (
      writtenIds.length !== ids.length ||
      writtenIds.some((id, index) => id !== ids[index])
    ) {
      throw new Error("Incomplete vector acknowledgement");
    }
  } catch {
    // Pinecone does not make a multi-batch ingestion atomic. Never report a
    // failed batch as success or delete vectors that an earlier retry created.
    throw new IngestionError(
      "Ingestion failed. Some chunks may already be indexed; retry the same PDF to finish without duplicating them.",
      502,
    );
  }

  return { sourceId, chunks: chunks.length };
}
