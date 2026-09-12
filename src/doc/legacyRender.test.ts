// JRT 1.3.1 declares only a bundler `module` entry, so Node tests name it explicitly.
import { Render } from "json-rich-text/lib/esm/index.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { prepare } from "./prepare";

it("renders legacy empty text children without changing the stored tree", () => {
  const current = prepare("p Synthetic α");
  const stored = structuredClone(current);
  stored.children[0].children[0].children = [];
  const original = JSON.stringify(stored);

  expect(
    renderToStaticMarkup(
      createElement(Render, { doc: stored, onChange: undefined }),
    ),
  ).toBe(
    renderToStaticMarkup(
      createElement(Render, { doc: current, onChange: undefined }),
    ),
  );
  expect(JSON.stringify(stored)).toBe(original);
  expect(Object.hasOwn(current.children[0].children[0], "children")).toBe(
    false,
  );
  expect(current.children[0].children[0]).toEqual({
    type: "text",
    value: "Synthetic α",
  });
});
