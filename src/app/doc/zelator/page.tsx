import { pageMetadata } from "@/seo/metadata";
import { PUBLIC_PAGES } from "@/seo/pages";
import DocPageShell from "../DocPageShell";

export const metadata = pageMetadata("/doc/zelator");

export default function Page() {
  return (
    <DocPageShell id="zelator" title={PUBLIC_PAGES["/doc/zelator"].title} />
  );
}
