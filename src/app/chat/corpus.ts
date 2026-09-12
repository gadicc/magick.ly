import { openai } from "@ai-sdk/openai";
import { Pinecone, type RecordMetadata } from "@pinecone-database/pinecone";
import { embed, embedMany } from "ai";
import type { ChatSource } from "./contracts";
import { maximalMarginalRelevance } from "./mmr";

const EMBEDDING_MODEL = "text-embedding-ada-002";
const EMBEDDING_BATCH_SIZE = 512;
const UPSERT_BATCH_SIZE = 100;

/** Corpus operations shared by chat retrieval and the existing PDF ingestion. */
export interface ChatCorpus {
  retrieve(question: string, signal: AbortSignal): Promise<ChatSource[]>;
  /** Upserts caller-provided stable IDs; success means every batch resolved. */
  upsertChunks(
    chunks: ChatSource[],
    ids: string[],
    signal?: AbortSignal,
  ): Promise<string[]>;
}

/** Keeps the existing OpenAI/Pinecone corpus behind one replaceable boundary. */
export function createPineconeCorpus(
  indexName: string,
  namespace = "",
  fetcher: typeof fetch = globalThis.fetch,
): ChatCorpus {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!indexName || !apiKey) {
    throw new Error("Chat retrieval is not configured.");
  }
  const embeddingModel = openai.embeddingModel(EMBEDDING_MODEL);

  const index = (signal?: AbortSignal) =>
    new Pinecone({
      apiKey,
      controllerHostUrl: process.env.PINECONE_CONTROLLER_HOST,
      // SDK 9 has no query/upsert signal option. Its supported fetch adapter
      // cancels both index-host discovery and data requests for this operation.
      fetchApi: async (input, init) => {
        signal?.throwIfAborted();
        const requestSignal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return fetcher(input, {
          ...init,
          signal:
            signal && requestSignal
              ? AbortSignal.any([signal, requestSignal])
              : (signal ?? requestSignal),
        });
      },
    }).index({ name: indexName });

  return {
    async retrieve(question, signal) {
      signal.throwIfAborted();
      const { embedding } = await embed({
        model: embeddingModel,
        value: normalizeEmbeddingText(question),
        abortSignal: signal,
      });
      signal.throwIfAborted();
      const result = await cancellable(
        index(signal).query({
          vector: embedding,
          topK: 10,
          includeMetadata: true,
          includeValues: true,
          // Index construction normalizes '' to '__default__' in SDK 9.
          // The per-request namespace override retains the existing empty value.
          namespace,
        }),
        signal,
      );
      signal.throwIfAborted();
      const matches = result.matches ?? [];
      const selected = maximalMarginalRelevance(
        embedding,
        matches.map((match) => {
          if (!match.values) {
            throw new Error(
              "The vector provider omitted embeddings required for ranking.",
            );
          }
          return match.values;
        }),
      );
      return selected.flatMap((position) => {
        const match = matches[position];
        // Preserve the old adapter's score filtering AFTER MMR selection.
        if (!match.score) return [];
        const { text, ...metadata } = match.metadata ?? {};
        return [{ pageContent: text ? String(text) : "", metadata }];
      });
    },

    async upsertChunks(chunks, ids, signal) {
      signal?.throwIfAborted();
      if (chunks.length !== ids.length || new Set(ids).size !== ids.length) {
        throw new Error("Every chunk must have one distinct indexing key.");
      }
      if (!chunks.length) return [];
      const embeddings: number[][] = [];
      for (
        let offset = 0;
        offset < chunks.length;
        offset += EMBEDDING_BATCH_SIZE
      ) {
        signal?.throwIfAborted();
        const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
        const result = await embedMany({
          model: embeddingModel,
          values: batch.map((chunk) =>
            normalizeEmbeddingText(chunk.pageContent),
          ),
          abortSignal: signal,
        });
        if (result.embeddings.length !== batch.length) {
          throw new Error(
            "The embedding provider returned an incomplete batch.",
          );
        }
        embeddings.push(...result.embeddings);
      }
      signal?.throwIfAborted();
      const records = chunks.map((chunk, position) => ({
        id: ids[position],
        values: embeddings[position],
        metadata: pineconeMetadata(chunk),
      }));
      const target = index(signal);
      for (
        let offset = 0;
        offset < records.length;
        offset += UPSERT_BATCH_SIZE
      ) {
        signal?.throwIfAborted();
        await cancellable(
          target.upsert({
            records: records.slice(offset, offset + UPSERT_BATCH_SIZE),
            namespace,
          }),
          signal,
        );
      }
      signal?.throwIfAborted();
      // Native SDK upsert returns void, not IDs or an acknowledged record count.
      // As before, return the submitted IDs only after every batch succeeds.
      return [...ids];
    },
  };
}

/** Matches OpenAIEmbeddings stripNewLines, including retaining carriage returns. */
export function normalizeEmbeddingText(text: string): string {
  return text.replace(/\n/g, " ");
}

/** Matches the old corpus metadata layout: dotted keys and original source text. */
export function pineconeMetadata(chunk: ChatSource): RecordMetadata {
  const metadata: RecordMetadata = Object.create(null);
  const visit = (path: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        visit(`${path}.${key}`, nested);
      }
    } else if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      metadata[path] = value;
    } else {
      throw new Error("A chunk contains unsupported citation metadata.");
    }
  };
  for (const [key, value] of Object.entries(chunk.metadata)) {
    // The old adapter preserved root string arrays before applying flat().
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      if (value.length) metadata[key] = [...value];
    } else {
      visit(key, value);
    }
  }
  metadata.text = chunk.pageContent;
  return metadata;
}

function cancellable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    // The SDK's retry backoff has no signal. Stop waiting immediately; the
    // bound fetch rejects any subsequent attempt before it reaches the network.
    void operation
      .then(resolve, (error) => reject(signal.aborted ? signal.reason : error))
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
