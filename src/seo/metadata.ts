import type { Metadata } from "next";
import { PUBLIC_PAGES, type PublicPath, type SeoPage } from "./pages";
import { SITE_OPEN_GRAPH } from "./site";

/** Metadata for one indexable URL: canonical, snippet and sharing fields. */
export function seoMetadata(path: string, page: SeoPage): Metadata {
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      url: path,
      ...(page.image && { images: [page.image] }),
    },
  };
}

/** Metadata for a static route listed in the public page registry. */
export function pageMetadata(path: PublicPath): Metadata {
  return seoMetadata(path, PUBLIC_PAGES[path]);
}

/** Account, administration and offline pages stay out of search results. */
export function privateMetadata(title: string): Metadata {
  return { title, robots: { index: false } };
}
