import { pageMetadata } from "@/seo/metadata";
import Tablets from "./tablets";

export const metadata = pageMetadata("/enochian/tablets");

export default function TabletsPage() {
  return <Tablets />;
}
