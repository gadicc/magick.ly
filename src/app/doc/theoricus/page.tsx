import { pageMetadata } from "@/seo/metadata";
import { PUBLIC_PAGES } from "@/seo/pages";
import DocPageShell from "../DocPageShell";

export const metadata = pageMetadata("/doc/theoricus");

export default function Page() {
  return (
    <DocPageShell id="theoricus" title={PUBLIC_PAGES["/doc/theoricus"].title} />
  );
}
