import { openai } from "@ai-sdk/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import type { ChatDependencies } from "./server";

/** Keep the existing Pinecone corpus and ranking until the vector migration. */
export async function chatDependencies(): Promise<ChatDependencies> {
  const { PINECONE_INDEX_NAME, PINECONE_NAME_SPACE } = process.env;
  if (!PINECONE_INDEX_NAME) {
    throw new Error("Chat retrieval is not configured.");
  }
  const store = await PineconeStore.fromExistingIndex(
    new OpenAIEmbeddings({
      model: "text-embedding-ada-002",
      stripNewLines: true,
    }),
    {
      pineconeIndex: new Pinecone().Index(PINECONE_INDEX_NAME),
      // The old adapter uses Pinecone's default namespace when this is absent.
      namespace: PINECONE_NAME_SPACE ?? "",
    },
  );
  const retriever = store.asRetriever({
    k: 4,
    searchType: "mmr",
    searchKwargs: { fetchK: 10, lambda: 0.25 },
  });
  return {
    // Select Chat Completions explicitly; the provider's default uses Responses.
    model: openai.chat("gpt-4o"),
    async retrieve(question, signal) {
      signal.throwIfAborted();
      // This older adapter cannot forward AbortSignal to its embedding/query
      // requests. Check both boundaries so a stopped chat never starts an answer.
      const documents = await retriever.invoke(question);
      signal.throwIfAborted();
      return documents.map(({ pageContent, metadata }) => ({
        pageContent,
        metadata,
      }));
    },
  };
}
