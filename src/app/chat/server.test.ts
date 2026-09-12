import {
  DefaultChatTransport,
  readUIMessageStream,
  simulateReadableStream,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  type ChatMessage,
  type ChatSource,
  messageSources,
  messageText,
} from "./contracts";
import { LEGACY_METADATA_DELIMITER as marker } from "./conversation";
import { CHAT_ERROR_MESSAGE, prepareAnswer, respondToChat } from "./server";

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const sources: ChatSource[] = [
  {
    pageContent: "First passage {question}.",
    metadata: { "pdf.info.Title": "First", "loc.pageNumber": 2 },
  },
  {
    pageContent: "Second passage.",
    metadata: {
      pdf: { info: { Title: "Second", Author: "Author" } },
      loc: { pageNumber: 4 },
    },
  },
];

function dependencies(answer = ["Answer ", "🜁", "\nnext line"]) {
  const model = new MockLanguageModelV4({
    modelId: "gpt-4o",
    doGenerate: {
      content: [{ type: "text", text: "What does the sign mean?" }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          { type: "text-start", id: "answer" },
          ...answer.map((delta) => ({
            type: "text-delta" as const,
            id: "answer",
            delta,
          })),
          { type: "text-end", id: "answer" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
  return { model, retrieve: vi.fn(async () => sources) };
}

function request(messages: unknown[], signal?: AbortSignal): Request {
  return new Request("http://localhost/chat/api/v2", {
    method: "POST",
    body: JSON.stringify({ messages }),
    headers: { "Content-Type": "application/json" },
    signal,
  });
}

const messages: ChatMessage[] = [
  {
    id: "old-user",
    role: "user",
    parts: [{ type: "text", text: "Tell me about signs." }],
  },
  {
    id: "old-assistant",
    role: "assistant",
    parts: [
      {
        type: "data-sources",
        data: [
          { pageContent: "Old source must not enter history", metadata: {} },
        ],
      },
      { type: "text", text: "There is a sign." },
    ],
  },
  {
    id: "new-user",
    role: "user",
    parts: [{ type: "text", text: "What does it mean?" }],
  },
];

describe("shared chat generation and protocols", () => {
  it("makes the same two prompted model calls, with standalone retrieval and safe history", async () => {
    const deps = dependencies();
    const response = await respondToChat(
      request(messages),
      "v2",
      async () => deps,
    );
    await response.text();
    expect(deps.model.doGenerateCalls).toHaveLength(1);
    expect(deps.model.doStreamCalls).toHaveLength(1);
    const first = deps.model.doGenerateCalls[0];
    const second = deps.model.doStreamCalls[0];
    expect(first.temperature).toBe(1);
    expect(second.temperature).toBe(1);
    expect(first.prompt).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.\n\n<chat_history>\n  Human: Tell me about signs.\nAssistant: There is a sign.\n</chat_history>\n\nFollow Up Input: What does it mean?\nStandalone question:",
          },
        ],
      },
    ]);
    expect(deps.retrieve).toHaveBeenCalledWith(
      "What does the sign mean?",
      expect.any(AbortSignal),
    );
    expect(second.prompt).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "You are a helpful assistant and academic expert in Magick and related fields.\nUse the following context to supplement your current knowledge in answering the question at the end,\nproviding sources where possible.  In the case of a conflict, information from the context takes precedence.\n\n<context>\n  First passage {question}.\n\nSecond passage.\n</context>\n\n<chat_history>\n  Human: Tell me about signs.\nAssistant: There is a sign.\n</chat_history>\n\nQuestion: What does the sign mean?\n",
          },
        ],
      },
    ]);
  });

  it("round-trips citations and Unicode text through the actual SDK transport", async () => {
    const deps = dependencies();
    const transport = new DefaultChatTransport<ChatMessage>({
      api: "http://localhost/chat/api/v2",
      fetch: async (input, init) =>
        respondToChat(new Request(input, init), "v2", async () => deps),
    });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      messageId: undefined,
      chatId: "conversation",
      messages,
      abortSignal: new AbortController().signal,
    });
    let final: ChatMessage | undefined;
    for await (const message of readUIMessageStream<ChatMessage>({ stream }))
      final = message;
    expect(final?.role).toBe("assistant");
    expect(messageText(final!)).toBe("Answer 🜁\nnext line");
    expect(messageSources(final!)).toEqual(sources);
    expect(final?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("preserves the exact legacy prefix and answer bytes, without sending old metadata to the model", async () => {
    const deps = dependencies();
    const legacyMessages = messages.map((message) => ({
      role: message.role,
      content:
        (message.role === "assistant"
          ? `${marker}{"sources":[{"pageContent":"old source"}]}${marker}`
          : "") + messageText(message),
    }));
    const response = await respondToChat(
      request(legacyMessages),
      "legacy",
      async () => deps,
    );
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe(
      `${marker}${JSON.stringify({ sources })}${marker}Answer 🜁\nnext line`,
    );
    expect(JSON.stringify(deps.model.doGenerateCalls[0].prompt)).not.toContain(
      "old source",
    );
  });

  it("answers with an empty citation collection when retrieval returns no matches", async () => {
    const deps = dependencies();
    deps.retrieve.mockResolvedValueOnce([]);
    const response = await respondToChat(
      request(messages),
      "v2",
      async () => deps,
    );
    expect(await response.text()).toContain(
      '"type":"data-sources","id":"retrieved-sources","data":[]',
    );
    expect(deps.model.doStreamCalls).toHaveLength(1);
  });

  it("regenerates from the same user turn with fresh citations and a new answer", async () => {
    const deps = dependencies(["Replacement"]);
    const replacement = [{ pageContent: "Newly retrieved", metadata: {} }];
    deps.retrieve.mockResolvedValueOnce(replacement);
    // useChat.regenerate removes the previous assistant before sending history.
    const response = await respondToChat(
      request(messages),
      "v2",
      async () => deps,
    );
    const wire = await response.text();
    expect(wire).toContain('"delta":"Replacement"');
    expect(wire).toContain("Newly retrieved");
    expect(wire).not.toContain("Old source must not enter history");
  });

  it.each(["legacy", "v2"] as const)(
    "rejects invalid %s input before creating provider clients",
    async (protocol) => {
      const factory = vi.fn(async () => dependencies());
      const response = await respondToChat(request([]), protocol, factory);
      expect(response.status).toBe(400);
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid JSON before creating provider clients", async () => {
    const factory = vi.fn(async () => dependencies());
    const response = await respondToChat(
      new Request("http://localhost", { method: "POST", body: "{" }),
      "v2",
      factory,
    );
    expect(response.status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });

  it("masks provider setup and retrieval failures", async () => {
    const response = await respondToChat(request(messages), "v2", async () => {
      throw new Error("provider-secret");
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("provider-secret");
    const deps = dependencies();
    deps.retrieve.mockRejectedValueOnce(new Error("vector-secret"));
    const retrievalResponse = await respondToChat(
      request(messages),
      "v2",
      async () => deps,
    );
    expect(retrievalResponse.status).toBe(500);
    expect(await retrievalResponse.text()).not.toContain("vector-secret");
    expect(deps.model.doStreamCalls).toHaveLength(0);
  });

  it("emits a safe SSE error if answer generation fails after headers", async () => {
    const deps = dependencies();
    deps.model.doStream = async () => {
      throw new Error("provider-secret");
    };
    const response = await respondToChat(
      request(messages),
      "v2",
      async () => deps,
    );
    const body = await response.text();
    expect(body).toContain(
      `"type":"error","errorText":"${CHAT_ERROR_MESSAGE}"`,
    );
    expect(body).not.toContain("provider-secret");
  });

  it("fails the legacy body instead of reporting a truncated answer as successful", async () => {
    const deps = dependencies();
    deps.model.doStream = async () => {
      throw new Error("provider-secret");
    };
    const response = await respondToChat(
      request([{ role: "user", content: "Hello" }]),
      "legacy",
      async () => deps,
    );
    await expect(response.text()).rejects.toThrow(CHAT_ERROR_MESSAGE);
  });

  it("does no provider work when already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const factory = vi.fn(async () => dependencies());
    const response = await respondToChat(
      request(messages, abort.signal),
      "v2",
      factory,
    );
    expect(response.status).toBe(499);
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not begin the answer when the caller stops during retrieval", async () => {
    const abort = new AbortController();
    const deps = dependencies();
    deps.retrieve.mockImplementationOnce(async () => {
      abort.abort();
      return sources;
    });
    await expect(
      prepareAnswer(
        [{ role: "user", content: "Question" }],
        abort.signal,
        deps,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(deps.model.doStreamCalls).toHaveLength(0);
  });

  it("passes cancellation to an in-flight model call", async () => {
    const abort = new AbortController();
    const deps = dependencies();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    deps.model.doGenerate = async ({ abortSignal }) => {
      started();
      return new Promise((_resolve, reject) => {
        abortSignal!.addEventListener(
          "abort",
          () => reject(abortSignal!.reason),
          { once: true },
        );
      });
    };
    const responsePromise = respondToChat(
      request(messages, abort.signal),
      "v2",
      async () => deps,
    );
    await startedPromise;
    abort.abort();
    expect((await responsePromise).status).toBe(499);
    expect(deps.retrieve).not.toHaveBeenCalled();
  });

  it.each(["legacy", "v2"] as const)(
    "propagates stop through the %s answer stream",
    async (protocol) => {
      const abort = new AbortController();
      const deps = dependencies();
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      let providerSignal: AbortSignal | undefined;
      deps.model.doStream = async ({ abortSignal }) => {
        providerSignal = abortSignal;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: "answer" });
              controller.enqueue({
                type: "text-delta",
                id: "answer",
                delta: "Partial",
              });
              abortSignal!.addEventListener(
                "abort",
                () => controller.error(abortSignal!.reason),
                { once: true },
              );
              started();
            },
          }),
        };
      };
      const response = await respondToChat(
        request(
          protocol === "legacy"
            ? messages.map((message) => ({
                role: message.role,
                content: messageText(message),
              }))
            : messages,
          abort.signal,
        ),
        protocol,
        async () => deps,
      );
      const body = response.text();
      await startedPromise;
      abort.abort();
      if (protocol === "legacy") {
        await expect(body).rejects.toMatchObject({ name: "AbortError" });
        expect(providerSignal?.aborted).toBe(true);
        return;
      }
      const wire = await body;
      expect(providerSignal?.aborted).toBe(true);
      expect(wire).toContain('"type":"abort"');
      expect(wire).not.toContain('"type":"error"');
    },
  );
});
