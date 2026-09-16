import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "./site";

/** Google's site-name markup for the home page. */
export const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  alternateName: "magick.ly",
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
};

/** Structured data as a script; `<` is escaped so no value can close it. */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON, not HTML
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
