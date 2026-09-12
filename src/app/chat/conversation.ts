export const LEGACY_METADATA_DELIMITER = "\n__META_JSON__\n";

export type ChatProtocol = "legacy" | "v2";

/** Only text crosses from either client protocol into the model prompts. */
export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ChatInputError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyAssistantText(content: string): string {
  if (!content.startsWith(LEGACY_METADATA_DELIMITER)) return content;
  const end = content.indexOf(
    LEGACY_METADATA_DELIMITER,
    LEGACY_METADATA_DELIMITER.length,
  );
  if (end === -1) return content;
  try {
    const metadata: unknown = JSON.parse(
      content.slice(LEGACY_METADATA_DELIMITER.length, end),
    );
    if (record(metadata) && Array.isArray(metadata.sources)) {
      return content.slice(end + LEGACY_METADATA_DELIMITER.length);
    }
  } catch {
    // A literal or incomplete delimiter in prose is not a transport frame.
  }
  return content;
}

/** Validate the wire envelope and discard citation parts before prompt creation. */
export function readConversation(
  body: unknown,
  protocol: ChatProtocol,
): ConversationTurn[] {
  if (!record(body) || !Array.isArray(body.messages) || !body.messages.length) {
    throw new ChatInputError("Enter a message.");
  }
  const turns = body.messages.map((message): ConversationTurn => {
    if (
      !record(message) ||
      typeof message.role !== "string" ||
      !["user", "assistant", "system"].includes(message.role)
    ) {
      throw new ChatInputError("Invalid conversation.");
    }
    const role = message.role as ConversationTurn["role"];
    let content: string;
    if (protocol === "legacy") {
      if (typeof message.content !== "string") {
        throw new ChatInputError("Invalid conversation.");
      }
      content =
        role === "assistant"
          ? legacyAssistantText(message.content)
          : message.content;
    } else {
      if (!Array.isArray(message.parts)) {
        throw new ChatInputError("Invalid conversation.");
      }
      content = message.parts
        .map((part) => {
          if (!record(part) || typeof part.type !== "string") {
            throw new ChatInputError("Invalid conversation.");
          }
          if (part.type !== "text") return "";
          if (typeof part.text !== "string") {
            throw new ChatInputError("Invalid conversation.");
          }
          return part.text;
        })
        .join("");
    }
    return { role, content };
  });
  const last = turns[turns.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    throw new ChatInputError("Enter a message.");
  }
  return turns;
}

export const CONDENSE_QUESTION_TEMPLATE = `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

<chat_history>
  {chat_history}
</chat_history>

Follow Up Input: {question}
Standalone question:`;

export const ANSWER_TEMPLATE = `You are a helpful assistant and academic expert in Magick and related fields.
Use the following context to supplement your current knowledge in answering the question at the end,
providing sources where possible.  In the case of a conflict, information from the context takes precedence.

<context>
  {context}
</context>

<chat_history>
  {chat_history}
</chat_history>

Question: {question}
`;

export function conversationHistory(turns: ConversationTurn[]): string {
  return turns
    .map(({ role, content }) => {
      const speaker =
        role === "user" ? "Human" : role === "assistant" ? "Assistant" : role;
      return `${speaker}: ${content}`;
    })
    .join("\n");
}

/** Replace placeholders once so braces in source passages remain literal text. */
export function renderPrompt(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{(chat_history|question|context)\}/g,
    (_, key) => values[key],
  );
}
