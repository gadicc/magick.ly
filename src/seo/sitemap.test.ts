import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { entityPages } from "./entities";
import { PUBLIC_PAGES } from "./pages";

describe("sitemap", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("lists every public and entity page once, as its canonical", () => {
    expect(urls).toHaveLength(
      Object.keys(PUBLIC_PAGES).length + entityPages().length,
    );
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toBe("https://magick.ly");
    expect(urls).toContain("https://magick.ly/gd/grade/0=0");
    expect(urls).toContain("https://magick.ly/kabbalah/sephirah/daat");
    expect(urls).toContain("https://magick.ly/kabbalah/path/9_10");
  });

  it("leaves out private pages and query variants", () => {
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/magick\.ly(\/[^?#]*)?$/);
      expect(url).not.toMatch(
        /\/(admin|signin|temples|upload|offline|chat\/train|gd\/components)\b/,
      );
    }
  });

  it("claims no change frequency, priority or modification date", () => {
    for (const entry of sitemap()) expect(Object.keys(entry)).toEqual(["url"]);
  });
});

describe("robots", () => {
  it("keeps APIs out of the crawl except the public renderers", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: ["/", "/api/render/", "/api/treeOfLife"],
        disallow: ["/api/", "/chat/api/"],
      },
      sitemap: "https://magick.ly/sitemap.xml",
    });
  });
});
