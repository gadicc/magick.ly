/** Production origin. Preview deployments also point canonicals here. */
export const SITE_URL = "https://magick.ly";

export const SITE_NAME = "Magick.ly";

export const SITE_TITLE = `${SITE_NAME}: Open Source Magick Reference and Tools`;

export const SITE_DESCRIPTION =
  "Free, open source reference and tools for Western esoteric study: Kabbalah, " +
  "the Golden Dawn, Enochian magick, astrology, geomancy and flashcards.";

/**
 * Open Graph fields every page shares. Next replaces a parent's `openGraph`
 * object when a page sets its own, so page metadata spreads this first.
 */
export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
} as const;
