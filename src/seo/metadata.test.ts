import { describe, expect, it } from "vitest";
import { pageMetadata, privateMetadata, seoMetadata } from "./metadata";
import { PUBLIC_PAGES } from "./pages";
import { SITE_NAME, SITE_TITLE } from "./site";

describe("seoMetadata", () => {
  it("sets the canonical, snippet and sharing fields for a path", () => {
    expect(
      seoMetadata("/gd/grade/0=0", {
        title: "Neophyte 0=0",
        description: "The first grade.",
      }),
    ).toEqual({
      title: "Neophyte 0=0",
      description: "The first grade.",
      alternates: { canonical: "/gd/grade/0=0" },
      openGraph: {
        type: "website",
        siteName: SITE_NAME,
        url: "/gd/grade/0=0",
        images: [
          {
            url: "/og/gd/grade/0=0.png",
            width: 1200,
            height: 630,
            alt: "Neophyte 0=0",
          },
        ],
      },
    });
  });

  it("keeps an absolute title and a page's own image", () => {
    const image = { url: "/og.png", width: 1200, height: 630, alt: "Card" };
    const metadata = seoMetadata("/x", {
      title: "Whole title",
      absoluteTitle: true,
      description: "Snippet.",
      image,
    });
    expect(metadata.title).toEqual({ absolute: "Whole title" });
    expect(metadata.openGraph).toMatchObject({ url: "/x", images: [image] });
  });
});

describe("pageMetadata", () => {
  it("reads the registry entry for a public path", () => {
    expect(pageMetadata("/")).toMatchObject({
      title: { absolute: SITE_TITLE },
      alternates: { canonical: "/" },
    });
    expect(pageMetadata("/enochian/keys")).toMatchObject({
      title: PUBLIC_PAGES["/enochian/keys"].title,
      description: PUBLIC_PAGES["/enochian/keys"].description,
      alternates: { canonical: "/enochian/keys" },
    });
  });
});

describe("privateMetadata", () => {
  it("names the page and keeps it out of the index", () => {
    expect(privateMetadata("Sign in")).toEqual({
      title: "Sign in",
      robots: { index: false },
    });
  });
});
