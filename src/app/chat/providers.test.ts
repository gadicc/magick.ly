import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  chat: vi.fn(() => ({ provider: "test-model" })),
  createCorpus: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({ openai: { chat: mock.chat } }));
vi.mock("./corpus", () => ({ createPineconeCorpus: mock.createCorpus }));

import { chatDependencies } from "./providers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PINECONE_INDEX_NAME", "existing-index");
  vi.stubEnv("PINECONE_NAME_SPACE", "existing-namespace");
  mock.createCorpus.mockReturnValue({ retrieve: mock.retrieve });
  mock.retrieve.mockResolvedValue([
    { pageContent: "Passage", metadata: { "loc.pageNumber": 3 } },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe("chat provider wiring", () => {
  it("keeps the existing chat endpoint and corpus and passes cancellation through", async () => {
    const deps = await chatDependencies();
    expect(mock.chat).toHaveBeenCalledWith("gpt-4o");
    expect(mock.createCorpus).toHaveBeenCalledWith(
      "existing-index",
      "existing-namespace",
    );
    const signal = new AbortController().signal;
    expect(await deps.retrieve("standalone question", signal)).toEqual([
      { pageContent: "Passage", metadata: { "loc.pageNumber": 3 } },
    ]);
    expect(mock.retrieve).toHaveBeenCalledWith("standalone question", signal);
  });

  it.each([undefined, ""])(
    "preserves the default namespace (%s)",
    async (namespace) => {
      vi.stubEnv("PINECONE_NAME_SPACE", namespace);
      await chatDependencies();
      expect(mock.createCorpus).toHaveBeenCalledWith("existing-index", "");
    },
  );

  it("surfaces corpus configuration failure before creating the chat model", async () => {
    vi.stubEnv("PINECONE_INDEX_NAME", undefined);
    mock.createCorpus.mockImplementationOnce(() => {
      throw new Error("Chat retrieval is not configured.");
    });
    await expect(chatDependencies()).rejects.toThrow("not configured");
    expect(mock.createCorpus).toHaveBeenCalledWith("", "existing-namespace");
    expect(mock.chat).not.toHaveBeenCalled();
  });
});
