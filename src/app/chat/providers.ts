import { openai } from "@ai-sdk/openai";
import { createPineconeCorpus } from "./corpus";
import type { ChatDependencies } from "./server";

/** Keep the existing models and corpus while using cancellable native retrieval. */
export async function chatDependencies(): Promise<ChatDependencies> {
  const corpus = createPineconeCorpus(
    process.env.PINECONE_INDEX_NAME ?? "",
    process.env.PINECONE_NAME_SPACE ?? "",
  );
  return { model: openai.chat("gpt-4o"), retrieve: corpus.retrieve };
}
