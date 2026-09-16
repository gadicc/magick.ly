import { pageMetadata } from "@/seo/metadata";
import Zodiac from "./zodiac";

export const metadata = pageMetadata("/astrology/zodiac");

export default function ZodiacPage() {
  return <Zodiac />;
}
