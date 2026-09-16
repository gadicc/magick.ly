// @vitest-environment jsdom
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { chatMarkdownComponents, chatMarkdownRemarkPlugins } from "./markdown";

function markdown(text: string) {
  return render(
    <ReactMarkdown
      remarkPlugins={chatMarkdownRemarkPlugins}
      components={chatMarkdownComponents}
    >
      {text}
    </ReactMarkdown>,
  ).container;
}

describe("assistant markdown rendering", () => {
  it("opens links in a new tab without an opener or referrer", () => {
    const link = markdown(
      "See [the source](https://example.com/a?b=1#c).",
    ).querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/a?b=1#c");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("the source");
  });

  it("keeps filtered and fragment links out of new tabs", () => {
    const links = markdown(
      "[js](javascript:alert(1)) [data](data:text/html,x) [top](#top) [rel](/docs) [mail](mailto:a@b.test)",
    ).querySelectorAll("a");
    expect(
      [...links].map((link) => [
        link.getAttribute("href"),
        link.getAttribute("target"),
      ]),
    ).toEqual([
      [null, null],
      [null, null],
      ["#top", null],
      ["/docs", "_blank"],
      ["mailto:a@b.test", "_blank"],
    ]);
  });

  it("renders GFM tables with the styling hook and highlights fenced code", () => {
    const container = markdown(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nInline `code`.",
    );
    expect(container.querySelector("table")?.className).toBe("rehype-table");
    expect(container.querySelector("table td")?.textContent).toBe("1");
    expect(container.querySelectorAll("span.token").length).toBeGreaterThan(0);
    expect(container.querySelector("code:not([class])")?.textContent).toBe(
      "code",
    );
  });
});
