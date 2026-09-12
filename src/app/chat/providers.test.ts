import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  chat: vi.fn(() => ({ provider: "test-model" })),
  embeddings: vi.fn(),
  index: vi.fn(() => ({ index: "test-index" })),
  fromExistingIndex: vi.fn(),
  asRetriever: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({ openai: { chat: mock.chat } }));
vi.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: class {
    constructor(options: unknown) {
      mock.embeddings(options);
    }
  },
}));
vi.mock("@pinecone-database/pinecone", () => ({
  Pinecone: class {
    Index = mock.index;
  },
}));
vi.mock("@langchain/pinecone", () => ({
  PineconeStore: { fromExistingIndex: mock.fromExistingIndex },
}));

import { chatDependencies } from "./providers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PINECONE_INDEX_NAME", "existing-index");
  vi.stubEnv("PINECONE_NAME_SPACE", "existing-namespace");
  mock.fromExistingIndex.mockResolvedValue({ asRetriever: mock.asRetriever });
  mock.asRetriever.mockReturnValue({ invoke: mock.invoke });
  mock.invoke.mockResolvedValue([
    {
      pageContent: "Passage",
      metadata: { "loc.pageNumber": 3 },
      id: "not-a-citation-field",
    },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe("existing Pinecone retrieval contract", () => {
  it("keeps index, namespace, embeddings, chat endpoint and MMR ranking settings", async () => {
    const deps = await chatDependencies();
    expect(mock.chat).toHaveBeenCalledWith("gpt-4o");
    expect(mock.embeddings).toHaveBeenCalledWith({
      model: "text-embedding-ada-002",
      stripNewLines: true,
    });
    expect(mock.index).toHaveBeenCalledWith("existing-index");
    expect(mock.fromExistingIndex).toHaveBeenCalledWith(expect.anything(), {
      pineconeIndex: { index: "test-index" },
      namespace: "existing-namespace",
    });
    expect(mock.asRetriever).toHaveBeenCalledWith({
      k: 4,
      searchType: "mmr",
      searchKwargs: { fetchK: 10, lambda: 0.25 },
    });
    const signal = new AbortController().signal;
    expect(await deps.retrieve("standalone question", signal)).toEqual([
      { pageContent: "Passage", metadata: { "loc.pageNumber": 3 } },
    ]);
    expect(mock.invoke).toHaveBeenCalledWith("standalone question");
  });

  it("rejects a missing index before model or vector access", async () => {
    vi.stubEnv("PINECONE_INDEX_NAME", "");
    await expect(chatDependencies()).rejects.toThrow("not configured");
    expect(mock.chat).not.toHaveBeenCalled();
    expect(mock.fromExistingIndex).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])(
    "preserves the default namespace (%s)",
    async (namespace) => {
      vi.stubEnv("PINECONE_NAME_SPACE", namespace);
      await chatDependencies();
      expect(mock.fromExistingIndex).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ namespace: "" }),
      );
    },
  );

  it("does not retrieve after cancellation", async () => {
    const deps = await chatDependencies();
    const abort = new AbortController();
    abort.abort();
    await expect(deps.retrieve("Question", abort.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});
