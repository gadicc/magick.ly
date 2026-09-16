import { pageMetadata } from "@/seo/metadata";
import { PUBLIC_PAGES } from "@/seo/pages";
import DocPageShell from "../DocPageShell";

export const metadata = pageMetadata("/doc/neophyte");

export default function Page() {
  return (
    <DocPageShell id="neophyte" title={PUBLIC_PAGES["/doc/neophyte"].title} />
  );
}
