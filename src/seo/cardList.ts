import { type SocialCard, socialCard } from "./cards";
import { entityPages } from "./entities";
import { PUBLIC_PAGES, type SeoPage } from "./pages";

/**
 * Every card the build draws: public pages without an image of their own,
 * then entity pages. Kept apart from the card helpers so page metadata does
 * not load the data set.
 */
export function socialCards(): SocialCard[] {
  return [
    ...(Object.entries(PUBLIC_PAGES) as [string, SeoPage][])
      .filter(([, page]) => !page.image)
      .map(([path, page]) => socialCard(path, page.title)),
    ...entityPages().map((page) => socialCard(page.path, page.title)),
  ];
}
