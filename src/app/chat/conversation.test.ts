import { describe, expect, it } from "vitest";
import {
  ChatInputError,
  conversationHistory,
  LEGACY_METADATA_DELIMITER as marker,
  readConversation,
  renderPrompt,
} from "./conversation";

describe("conversation protocol boundary", () => {
  it("keeps citation data out of model history while joining text parts", () => {
    expect(
      readConversation(
        {
          messages: [
            {
              role: "assistant",
              parts: [
                { type: "text", text: "A " },
                {
                  type: "data-sources",
                  data: [{ pageContent: "retrieved secret" }],
                },
                { type: "text", text: "sign." },
              ],
            },
            { role: "user", parts: [{ type: "text", text: "Which sign?" }] },
          ],
        },
        "v2",
      ),
    ).toEqual([
      { role: "assistant", content: "A sign." },
      { role: "user", content: "Which sign?" },
    ]);
  });

  it("strips a complete legacy assistant frame, including an empty answer", () => {
    const content = `${marker}{"sources":[{"pageContent":"source"}]}${marker}`;
    expect(
      readConversation(
        {
          messages: [
            { role: "assistant", content },
            { role: "assistant", content: content + "Previous answer" },
            { role: "user", content: "Follow up" },
          ],
        },
        "legacy",
      ),
    ).toEqual([
      { role: "assistant", content: "" },
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "Follow up" },
    ]);
  });

  it.each([
    `${marker}unfinished`,
    `${marker}invalid JSON${marker}literal`,
    `${marker}{"other":true}${marker}literal`,
    `Prose ${marker}{"sources":[]}${marker}literal`,
  ])("retains literal or incomplete legacy prose: %s", (content) => {
    expect(
      readConversation(
        {
          messages: [
            { role: "assistant", content },
            { role: "user", content: "Continue" },
          ],
        },
        "legacy",
      )[0].content,
    ).toBe(content);
  });

  it("never treats a user message or modern text as a legacy transport frame", () => {
    const content = `${marker}{"sources":[]}${marker}literal`;
    expect(
      readConversation({ messages: [{ role: "user", content }] }, "legacy")[0]
        .content,
    ).toBe(content);
    expect(
      readConversation(
        {
          messages: [
            { role: "user", parts: [{ type: "text", text: content }] },
          ],
        },
        "v2",
      )[0].content,
    ).toBe(content);
  });

  it.each([
    undefined,
    {},
    { messages: [] },
    { messages: [{ role: "user", parts: [] }] },
    {
      messages: [
        { role: "assistant", parts: [{ type: "text", text: "Answer" }] },
      ],
    },
    { messages: [{ role: "user", parts: [{ type: "text", text: " \n " }] }] },
    { messages: [{ role: "user", parts: [{ type: "text", text: 123 }] }] },
    { messages: [{ role: "user", parts: [null] }] },
    { messages: [{ role: "tool", parts: [{ type: "text", text: "Tool" }] }] },
    { messages: [{ role: "user", content: "wrong version" }] },
  ])("rejects malformed or empty UI conversations", (body) => {
    expect(() => readConversation(body, "v2")).toThrow(ChatInputError);
  });

  it("preserves role labels and multiline text in the existing prompt format", () => {
    expect(
      conversationHistory([
        { role: "system", content: "Intro" },
        { role: "user", content: "One\nTwo" },
        { role: "assistant", content: "Answer" },
      ]),
    ).toBe("system: Intro\nHuman: One\nTwo\nAssistant: Answer");
  });

  it("substitutes once without treating source braces or replacement syntax as templates", () => {
    expect(
      renderPrompt("{context} / {question}", {
        context: "literal {question} $&",
        question: "literal {context}",
      }),
    ).toBe("literal {question} $& / literal {context}");
  });
});
