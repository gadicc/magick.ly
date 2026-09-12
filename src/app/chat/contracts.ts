import type { UIMessage } from "ai";

/** Retrieved passages accompany an answer; they are never conversation text. */
export interface ChatSource {
  pageContent: string;
  metadata: {
    [key: string]: unknown;
    pdf?: { info?: { Author?: string; Title?: string } };
    loc?: { pageNumber?: number };
  };
}

/** The chat supports text and one typed collection of retrieved citations. */
export type ChatMessage = UIMessage<never, { sources: ChatSource[] }>;

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function messageSources(message: ChatMessage): ChatSource[] | undefined {
  return message.parts.find((part) => part.type === "data-sources")?.data;
}
