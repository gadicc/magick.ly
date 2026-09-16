import type { MetadataRoute } from "next";
import { SITE_URL } from "@/seo/site";

/**
 * Private pages carry `noindex` instead of a disallow, so crawlers can see
 * it. The public diagram renderers stay crawlable for social cards and
 * saved ritual images.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/render/", "/api/treeOfLife"],
      disallow: ["/api/", "/chat/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
