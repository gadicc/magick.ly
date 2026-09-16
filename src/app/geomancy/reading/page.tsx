import { pageSearchParams } from "@/lib/pageSearchParams";
import { pageMetadata } from "@/seo/metadata";
import GeomancyReading from "./reading";
import { readingFromSearchParams } from "./readingState";

export const metadata = pageMetadata("/geomancy/reading");

/**
 * A shared link's reading is resolved on the server so the HTML carries the
 * shared figures; the page itself never writes state back to the URL.
 */
export default async function GeomancyReadingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = readingFromSearchParams(pageSearchParams(await searchParams));
  return <GeomancyReading initial={initial} />;
}
