import type { MetadataRoute } from "next";
import { entityPages } from "@/seo/entities";
import { PUBLIC_PAGES } from "@/seo/pages";
import { SITE_URL } from "@/seo/site";

/**
 * Registry pages, then data rows, spelled exactly like their canonicals.
 * No change frequency or priority (search engines ignore both) and no build
 * time posing as a modification date.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...Object.keys(PUBLIC_PAGES),
    ...entityPages().map((page) => page.path),
  ].map((path) => ({ url: path === "/" ? SITE_URL : SITE_URL + path }));
}
