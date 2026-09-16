import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, type SeoPage } from "./pages";
import { SITE_NAME } from "./site";

const entries = Object.entries(PUBLIC_PAGES) as [string, SeoPage][];

/** The title a search result shows, after the root layout's template. */
function shownTitle(page: SeoPage) {
  return page.absoluteTitle ? page.title : `${page.title} | ${SITE_NAME}`;
}

describe("PUBLIC_PAGES", () => {
  it("uses plain canonical paths", () => {
    for (const [path] of entries)
      expect(path).toMatch(/^\/$|^(\/[a-z0-9-]+)+$/);
  });

  it("gives every page its own title and description", () => {
    const titles = new Set(entries.map(([, page]) => shownTitle(page)));
    const descriptions = new Set(entries.map(([, page]) => page.description));
    expect(titles.size).toBe(entries.length);
    expect(descriptions.size).toBe(entries.length);
  });

  it("keeps titles and snippets within search result lengths", () => {
    for (const [path, page] of entries) {
      expect(shownTitle(page).length, path).toBeLessThanOrEqual(60);
      expect(page.description.length, path).toBeGreaterThanOrEqual(70);
      expect(page.description.length, path).toBeLessThanOrEqual(160);
    }
  });

  it("links social images on this site", () => {
    for (const [, page] of entries)
      if (page.image) expect(page.image.url).toMatch(/^\/[^/]/);
  });
});
