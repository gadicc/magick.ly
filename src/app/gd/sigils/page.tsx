import { pageSearchParams } from "@/lib/pageSearchParams";
import { pageMetadata } from "@/seo/metadata";
import { sigilFromSearchParams } from "./sigilState";
import Sigils from "./sigils";

export const metadata = pageMetadata("/gd/sigils");

/** Shared sigil text is resolved on the server; the page never writes it back to the URL. */
export default async function SigilsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Sigils
      initial={sigilFromSearchParams(pageSearchParams(await searchParams))}
    />
  );
}
