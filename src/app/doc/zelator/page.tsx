import { pageMetadata } from "@/seo/metadata";
import DocPageShell from "../DocPageShell";

export const metadata = pageMetadata("/doc/zelator");

export default function Page() {
  return <DocPageShell id="zelator" />;
}
