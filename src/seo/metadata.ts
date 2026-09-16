import type { Metadata } from "next";
import { socialCardImage } from "./cards";
import { PUBLIC_PAGES, type PublicPath, type SeoPage } from "./pages";
import { SITE_OPEN_GRAPH } from "./site";

/**
 * Metadata for one indexable URL: canonical, snippet and sharing fields. The
 * image defaults to the path's generated card, which exists for every
 * registry and entity page; other paths must pass their own.
 */
export function seoMetadata(path: string, page: SeoPage): Metadata {
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      url: path,
      images: [page.image ?? socialCardImage(path, page.title)],
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
