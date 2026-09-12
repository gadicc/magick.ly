import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type LanguageModel,
  streamText,
  type TextStreamPart,
  type ToolSet,
  toUIMessageStream,
} from "ai";
import { createUuidV7 } from "@/lib/ids";
import type { ChatMessage, ChatSource } from "./contracts";
import {
  ANSWER_TEMPLATE,
  ChatInputError,
  type ChatProtocol,
  CONDENSE_QUESTION_TEMPLATE,
  type ConversationTurn,
  conversationHistory,
  LEGACY_METADATA_DELIMITER,
  readConversation,
  renderPrompt,
} from "./conversation";

export const CHAT_ERROR_MESSAGE = "Error Processing";

// Apply the same redaction to provider events and merged-stream failures.
const safeStreamError = () => CHAT_ERROR_MESSAGE;

/** The provider boundary is shared by both client protocols and can be mocked. */
export interface ChatDependencies {
  model: LanguageModel;
  retrieve: (question: string, signal: AbortSignal) => Promise<ChatSource[]>;
}

/** Preserve the existing condense → retrieve → answer sequence and prompts. */
export async function prepareAnswer(
  turns: ConversationTurn[],
  signal: AbortSignal,
  { model, retrieve }: ChatDependencies,
) {
  signal.throwIfAborted();
  const history = conversationHistory(turns.slice(0, -1));
  const { text: question } = await generateText({
    model,
    temperature: 1,
    prompt: renderPrompt(CONDENSE_QUESTION_TEMPLATE, {
      chat_history: history,
      question: turns[turns.length - 1].content,
    }),
    abortSignal: signal,
  });
  signal.throwIfAborted();
  const sources = await retrieve(question, signal);
  signal.throwIfAborted();
  const result = streamText({
    model,
    temperature: 1,
    prompt: renderPrompt(ANSWER_TEMPLATE, {
      context: sources.map((source) => source.pageContent).join("\n\n"),
      chat_history: history,
      question,
    }),
    abortSignal: signal,
    // The response adapters expose a safe error. Avoid the SDK's default
    // console logging of provider errors, which may include request details.
    onError: () => {},
  });
  return { sources, stream: result.stream };
}

/** Cached clients still expect a JSON prefix followed by unframed answer text. */
function legacyResponse(
  sources: ChatSource[],
  stream: ReadableStream<TextStreamPart<ToolSet>>,
): Response {
  const text = stream.pipeThrough(
    new TransformStream<TextStreamPart<ToolSet>, string>({
      start(controller) {
        controller.enqueue(
          LEGACY_METADATA_DELIMITER +
            JSON.stringify({ sources }) +
            LEGACY_METADATA_DELIMITER,
        );
      },
      transform(part, controller) {
        if (part.type === "text-delta") controller.enqueue(part.text);
        // Unlike toTextStream(), propagate failures so a truncated answer
        // cannot silently look like a successful legacy response.
        if (part.type === "error")
          controller.error(new Error(CHAT_ERROR_MESSAGE));
        if (part.type === "abort")
          controller.error(new DOMException("Aborted", "AbortError"));
      },
    }),
  );
  return new Response(text.pipeThrough(new TextEncoderStream()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Decode either wire format, then adapt the same model result for its client. */
export async function respondToChat(
  request: Request,
  protocol: ChatProtocol,
  dependencies: () => Promise<ChatDependencies>,
): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ChatInputError("Invalid conversation.");
    }
    const turns = readConversation(body, protocol);
    request.signal.throwIfAborted();
    const { sources, stream } = await prepareAnswer(
      turns,
      request.signal,
      await dependencies(),
    );
    if (protocol === "legacy") return legacyResponse(sources, stream);

    const uiStream = createUIMessageStream<ChatMessage>({
      generateId: createUuidV7,
      execute({ writer }) {
        writer.write({ type: "start" });
        writer.write({
          type: "data-sources",
          id: "retrieved-sources",
          data: sources,
        });
        writer.merge(
          toUIMessageStream({
            stream,
            sendStart: false,
            onError: safeStreamError,
          }),
        );
      },
      onError: safeStreamError,
    });
    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const message =
      error instanceof ChatInputError ? error.message : CHAT_ERROR_MESSAGE;
    const status = error instanceof ChatInputError ? 400 : 500;
    // DefaultChatTransport displays a failed response body as its error message.
    return protocol === "legacy"
      ? Response.json({ message }, { status })
      : new Response(message, { status });
  }
}
