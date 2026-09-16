import { pageMetadata } from "@/seo/metadata";
import Planets from "./planets";

export const metadata = pageMetadata("/astrology/planets");

export default function PlanetsPage() {
  return <Planets />;
}
