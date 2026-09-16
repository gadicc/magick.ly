import { pageMetadata } from "@/seo/metadata";
import Dictionary from "./dictionary";

export const metadata = pageMetadata("/enochian/dictionary");

export default function DictionaryPage() {
  return <Dictionary />;
}
