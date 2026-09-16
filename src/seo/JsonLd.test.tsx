import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import JsonLd, { WEBSITE_JSON_LD } from "./JsonLd";

describe("JsonLd", () => {
  it("names the site for search results", () => {
    const html = renderToStaticMarkup(<JsonLd data={WEBSITE_JSON_LD} />);
    const json = html.match(
      /^<script type="application\/ld\+json">(.*)<\/script>$/,
    )?.[1];
    expect(JSON.parse(json ?? "")).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Magick.ly",
      alternateName: "magick.ly",
      url: "https://magick.ly/",
      description: WEBSITE_JSON_LD.description,
    });
  });

  it("cannot be closed by a value", () => {
    const html = renderToStaticMarkup(
      <JsonLd data={{ name: "</script><script>alert(1)</script>" }} />,
    );
    expect(html).toBe(
      '<script type="application/ld+json">{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}</script>',
    );
    expect(JSON.parse(html.slice(35, -9))).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });
});
