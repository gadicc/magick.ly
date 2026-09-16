import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TreeOfLifeView } from "./tree";
import { DEFAULT_TREE_SETTINGS } from "./treeSettings";

describe("TreeOfLifeView", () => {
  // The page renders this as its Suspense fallback, outside any router state.
  const html = renderToString(
    <TreeOfLifeView settings={DEFAULT_TREE_SETTINGS} />,
  );

  it("prerenders the default controls", () => {
    expect(html).toMatch(
      /<select name="field"[^>]*>.*?<option value="name.roman" selected="">/,
    );
    expect(html).toMatch(
      /<select name="colorScale"[^>]*>.*?<option value="queen" selected="">/,
    );
  });

  it("prerenders the Tree with its Sephirah and path links", () => {
    expect(html).toContain("<svg");
    expect(html).toContain('xlink:href="/kabbalah/sephirah/keter"');
    expect(html).toContain('xlink:href="/kabbalah/path/1_2"');
    expect(html).toContain('href="/kabbalah/sephirah/malchut"');
  });

  it("links the default image and the canonical page", () => {
    expect(html).toContain("/api/render/tree-of-life");
    expect(html).toContain("Copy page link");
  });
});
