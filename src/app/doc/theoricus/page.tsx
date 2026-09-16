import { pageMetadata } from "@/seo/metadata";
import DocPageShell from "../DocPageShell";

export const metadata = pageMetadata("/doc/theoricus");

export default function Page() {
  return <DocPageShell id="theoricus" />;
}
