import { pageMetadata } from "@/seo/metadata";
import Study from "./study";

export const metadata = pageMetadata("/study");

export default function StudyPage() {
  return <Study />;
}
