import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPineconeCorpus,
  normalizeEmbeddingText,
  pineconeMetadata,
} from "./corpus";

let serial = 0;
const responses = {
  matches: [
    {
      id: "one",
      score: 1,
      values: [1, 0],
      metadata: {
        text: "First\nsource",
        "pdf.info.Title": "Reference",
        "loc.pageNumber": 3,
      },
    },
    {
      id: "two",
      score: 0.5,
      values: [0.9, 0.1],
      metadata: { text: "Similar" },
    },
    {
      id: "three",
      score: 0.1,
      values: [0, 1],
      metadata: { text: "Different" },
    },
    { id: "four", score: -1, values: [-1, 0], metadata: { text: "Opposite" } },
    { id: "five", score: 0.1, values: [0, -1], metadata: { text: "Another" } },
  ],
};

function harness() {
  const requests: {
    url: string;
    init: RequestInit;
    body: Record<string, unknown>;
  }[] = [];
  const response = structuredClone(responses);
  const fetcher = vi.fn<typeof fetch>(async (input, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, init, body });
    if (url === "https://api.openai.com/v1/embeddings") {
      return Response.json({
        data: body.input.map((_: string, index: number) => ({
          embedding: [1, 0],
          index,
        })),
        usage: {
          prompt_tokens: body.input.length,
          total_tokens: body.input.length,
        },
      });
    }
    if (url.startsWith("https://api.pinecone.io/indexes/")) {
      return Response.json({ host: "vectors.example.test" });
    }
    if (url === "https://vectors.example.test/query")
      return Response.json(response);
    if (url === "https://vectors.example.test/vectors/upsert")
      return Response.json({ upsertedCount: body.vectors.length });
    throw new Error(`Unexpected synthetic request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const corpus = (namespace = "") =>
    createPineconeCorpus(`synthetic-${++serial}`, namespace, fetcher);
  return { fetcher, requests, response, corpus };
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-key");
  vi.stubEnv("PINECONE_API_KEY", "synthetic-pinecone-key");
  vi.stubEnv("PINECONE_CONTROLLER_HOST", undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("native Pinecone 9 corpus", () => {
  it("preserves embedding preprocessing, explicit empty namespace, MMR and citations on the wire", async () => {
    const test = harness();
    const signal = new AbortController().signal;
    const sources = await test
      .corpus()
      .retrieve("first\r\nsecond\nthird", signal);
    expect(test.requests[0].body).toMatchObject({
      model: "text-embedding-ada-002",
      input: ["first\r second third"],
    });
    const query = test.requests.find(({ url }) => url.endsWith("/query"))!;
    expect(query.body).toEqual({
      namespace: "",
      vector: [1, 0],
      topK: 10,
      includeValues: true,
      includeMetadata: true,
    });
    expect(query.init.signal).toBe(signal);
    expect(
      test.requests.find(({ url }) => url.includes("/indexes/"))!.init.signal,
    ).toBe(signal);
    expect(sources.map(({ pageContent }) => pageContent)).toEqual([
      "First\nsource",
      "Opposite",
      "Different",
      "Another",
    ]);
    expect(sources[0].metadata).toEqual({
      "pdf.info.Title": "Reference",
      "loc.pageNumber": 3,
    });
    expect(sources[0]).not.toHaveProperty("id");
    expect(sources[0].metadata).not.toHaveProperty("text");
  });

  it("keeps named namespaces and the old zero-score exclusion after selection", async () => {
    const test = harness();
    test.response.matches[3].score = 0;
    const sources = await test
      .corpus("ritual-corpus")
      .retrieve("question", new AbortController().signal);
    expect(sources.map(({ pageContent }) => pageContent)).toEqual([
      "First\nsource",
      "Different",
      "Another",
    ]);
    expect(test.requests.at(-1)!.body.namespace).toBe("ritual-corpus");
  });

  it("returns no sources for empty matches", async () => {
    const test = harness();
    test.response.matches = [];
    await expect(
      test.corpus().retrieve("question", new AbortController().signal),
    ).resolves.toEqual([]);
  });

  it.each([
    [{}, []],
    [
      { matches: [{ score: 1, values: [1, 0] }] },
      [{ pageContent: "", metadata: {} }],
    ],
    [
      {
        matches: [
          { score: 1, values: [1, 0], metadata: { text: "", title: "Empty" } },
        ],
      },
      [{ pageContent: "", metadata: { title: "Empty" } }],
    ],
  ])(
    "handles sparse provider payloads without inventing source text",
    async (payload, expected) => {
      const test = harness();
      const normal = test.fetcher.getMockImplementation()!;
      test.fetcher.mockImplementation((input, init) =>
        String(input).endsWith("/query")
          ? Promise.resolve(Response.json(payload))
          : normal(input, init),
      );
      await expect(
        test.corpus().retrieve("question", new AbortController().signal),
      ).resolves.toEqual(expected);
    },
  );

  it("rejects matches without vectors required for ranking", async () => {
    const test = harness();
    const normal = test.fetcher.getMockImplementation()!;
    test.fetcher.mockImplementation((input, init) =>
      String(input).endsWith("/query")
        ? Promise.resolve(
            Response.json({
              matches: [{ score: 1, metadata: { text: "Unrankable" } }],
            }),
          )
        : normal(input, init),
    );
    await expect(
      test.corpus().retrieve("question", new AbortController().signal),
    ).rejects.toThrow("omitted embeddings");
  });

  it("rejects missing credentials without contacting providers", () => {
    const test = harness();
    vi.stubEnv("PINECONE_API_KEY", undefined);
    expect(() => test.corpus()).toThrow("not configured");
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("performs no work after cancellation or for invalid configuration", async () => {
    const test = harness();
    const abort = new AbortController();
    abort.abort();
    await expect(
      test.corpus().retrieve("question", abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(() => createPineconeCorpus("")).toThrow("not configured");
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it.each(["embedding", "lookup", "query"])(
    "cancels an in-flight %s request",
    async (stage) => {
      const test = harness();
      const normal = test.fetcher.getMockImplementation()!;
      const abort = new AbortController();
      let reached!: () => void;
      const started = new Promise<void>((resolve) => {
        reached = resolve;
      });
      test.fetcher.mockImplementation((input, init) => {
        const url = String(input);
        const target =
          stage === "embedding"
            ? url.endsWith("/embeddings")
            : stage === "lookup"
              ? url.includes("/indexes/")
              : url.endsWith("/query");
        if (!target) return normal(input, init);
        expect(init?.signal).toBeTruthy();
        reached();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        });
      });
      const pending = test.corpus().retrieve("question", abort.signal);
      await started;
      abort.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      if (stage !== "query")
        expect(test.requests.some(({ url }) => url.endsWith("/query"))).toBe(
          false,
        );
    },
  );

  it("does not wait through SDK backoff or send another request after cancellation", async () => {
    vi.useFakeTimers();
    const test = harness();
    const normal = test.fetcher.getMockImplementation()!;
    let queryCalls = 0;
    test.fetcher.mockImplementation((input, init) => {
      if (String(input).endsWith("/query")) {
        queryCalls++;
        return Promise.resolve(
          Response.json({ message: "temporary" }, { status: 503 }),
        );
      }
      return normal(input, init);
    });
    const abort = new AbortController();
    const pending = test.corpus().retrieve("question", abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryCalls).toBe(1);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(queryCalls).toBe(1);
  });

  it.each(["embedding", "query"])(
    "propagates %s errors without generating fake sources",
    async (stage) => {
      const test = harness();
      const normal = test.fetcher.getMockImplementation()!;
      test.fetcher.mockImplementation((input, init) => {
        if (
          String(input).endsWith(
            stage === "embedding" ? "/embeddings" : "/query",
          )
        ) {
          return Promise.resolve(
            Response.json(
              { error: { message: "Synthetic failure" } },
              { status: 400 },
            ),
          );
        }
        return normal(input, init);
      });
      await expect(
        test.corpus().retrieve("question", new AbortController().signal),
      ).rejects.toBeInstanceOf(Error);
    },
  );

  it("preserves stable IDs and metadata in native 100-record upsert batches", async () => {
    const test = harness();
    const chunks = Array.from({ length: 101 }, (_, index) => ({
      pageContent: `line ${index}\nnext`,
      metadata: {
        source: "reference.pdf",
        loc: { pageNumber: 3 },
        pdf: { info: { Title: "Reference" } },
        tags: ["ritual", "source"],
        unused: null,
      },
    }));
    const ids = chunks.map((_, index) => `pdf-v1:synthetic-hash:${index}`);
    await expect(test.corpus().upsertChunks(chunks, ids)).resolves.toEqual(ids);
    const batches = test.requests.filter(({ url }) =>
      url.endsWith("/vectors/upsert"),
    );
    expect(batches).toHaveLength(2);
    expect(
      batches.map(({ body }) => (body.vectors as unknown[]).length),
    ).toEqual([100, 1]);
    expect(batches.every(({ body }) => body.namespace === "")).toBe(true);
    expect((batches[0].body.vectors as unknown[])[0]).toEqual({
      id: ids[0],
      values: [1, 0],
      metadata: {
        source: "reference.pdf",
        "loc.pageNumber": 3,
        "pdf.info.Title": "Reference",
        tags: ["ritual", "source"],
        text: "line 0\nnext",
      },
    });
    expect((test.requests[0].body.input as string[])[0]).toBe("line 0 next");
    expect(chunks[0].metadata).toHaveProperty("loc.pageNumber", 3);
  });

  it("rejects a failed later upsert batch and reuses IDs on retry", async () => {
    const test = harness();
    const normal = test.fetcher.getMockImplementation()!;
    let writes = 0;
    test.fetcher.mockImplementation((input, init) => {
      if (String(input).endsWith("/vectors/upsert") && ++writes === 2) {
        return Promise.resolve(
          Response.json({ message: "Synthetic failure" }, { status: 400 }),
        );
      }
      return normal(input, init);
    });
    const chunks = Array.from({ length: 101 }, () => ({
      pageContent: "chunk",
      metadata: {},
    }));
    const ids = chunks.map((_, index) => `pdf-v1:synthetic-hash:${index}`);
    const corpus = test.corpus("corpus");
    await expect(corpus.upsertChunks(chunks, ids)).rejects.toBeInstanceOf(
      Error,
    );
    await expect(corpus.upsertChunks(chunks, ids)).resolves.toEqual(ids);
    const batches = test.requests.filter(({ url }) =>
      url.endsWith("/vectors/upsert"),
    );
    expect((batches[0].body.vectors as { id: string }[])[0].id).toBe(
      (batches[1].body.vectors as { id: string }[])[0].id,
    );
  });

  it("rejects invalid indexing keys before contacting providers", async () => {
    const test = harness();
    await expect(
      test.corpus().upsertChunks([{ pageContent: "text", metadata: {} }], []),
    ).rejects.toThrow("indexing key");
    await expect(
      test.corpus().upsertChunks(
        [
          { pageContent: "first", metadata: {} },
          { pageContent: "second", metadata: {} },
        ],
        ["duplicate", "duplicate"],
      ),
    ).rejects.toThrow("indexing key");
    await expect(test.corpus().upsertChunks([], [])).resolves.toEqual([]);
    const abort = new AbortController();
    abort.abort();
    await expect(
      test.corpus().upsertChunks([], [], abort.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("retains 512-text embedding batches without changing chunk or vector keys", async () => {
    const test = harness();
    const chunks = Array.from({ length: 513 }, (_, index) => ({
      pageContent: `chunk ${index}`,
      metadata: {},
    }));
    const ids = chunks.map((_, index) => `pdf-v1:synthetic-hash:${index}`);
    await expect(test.corpus().upsertChunks(chunks, ids)).resolves.toEqual(ids);
    const embeddings = test.requests.filter(({ url }) =>
      url.endsWith("/embeddings"),
    );
    expect(
      embeddings.map(({ body }) => (body.input as string[]).length),
    ).toEqual([512, 1]);
    const written = test.requests
      .filter(({ url }) => url.endsWith("/vectors/upsert"))
      .flatMap(({ body }) =>
        (body.vectors as { id: string }[]).map(({ id }) => id),
      );
    expect(written).toEqual(ids);
  });

  it("rejects an incomplete embedding batch before any vector write", async () => {
    const test = harness();
    const normal = test.fetcher.getMockImplementation()!;
    test.fetcher.mockImplementation((input, init) => {
      if (String(input).endsWith("/embeddings")) {
        return Promise.resolve(
          Response.json({ data: [{ embedding: [1, 0], index: 0 }] }),
        );
      }
      return normal(input, init);
    });
    await expect(
      test.corpus().upsertChunks(
        [
          { pageContent: "first", metadata: {} },
          { pageContent: "second", metadata: {} },
        ],
        ["first", "second"],
      ),
    ).rejects.toThrow();
    expect(
      test.requests.some(({ url }) => url.endsWith("/vectors/upsert")),
    ).toBe(false);
  });

  it("cancels an in-flight native upsert without acknowledging completion", async () => {
    const test = harness();
    const normal = test.fetcher.getMockImplementation()!;
    const abort = new AbortController();
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    test.fetcher.mockImplementation((input, init) => {
      if (!String(input).endsWith("/vectors/upsert"))
        return normal(input, init);
      expect(init?.signal).toBe(abort.signal);
      reached();
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        );
      });
    });
    const pending = test
      .corpus()
      .upsertChunks(
        [{ pageContent: "chunk", metadata: {} }],
        ["pdf-v1:synthetic:0"],
        abort.signal,
      );
    await started;
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("corpus text and citation normalization", () => {
  it("rejects metadata that cannot be represented by Pinecone", () => {
    expect(() =>
      pineconeMetadata({
        pageContent: "text",
        metadata: { invalid: BigInt(1) },
      }),
    ).toThrow("unsupported citation metadata");
  });
  it("preserves CR, tabs, spacing and source text", () => {
    expect(normalizeEmbeddingText("a\r\nb\tc  d\n")).toBe("a\r b\tc  d ");
    expect(
      pineconeMetadata({
        pageContent: "a\nb",
        metadata: {
          text: "overridden",
          loc: { pageNumber: 2 },
          nested: { tags: ["a", "b"] },
          blank: [],
          empty: {},
          nil: null,
          enabled: false,
          count: 0,
        },
      }),
    ).toEqual({
      "loc.pageNumber": 2,
      "nested.tags.0": "a",
      "nested.tags.1": "b",
      enabled: false,
      count: 0,
      text: "a\nb",
    });
  });
});
