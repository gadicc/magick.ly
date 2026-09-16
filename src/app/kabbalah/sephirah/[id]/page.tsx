import { notFound } from "next/navigation";
import { entityIds, sephirahPage } from "@/seo/entities";
import { seoMetadata } from "@/seo/metadata";
import Sephirah from "./sephirah";

export function generateStaticParams() {
  return entityIds("sephirah");
}

export async function generateMetadata({
  params,
}: PageProps<"/kabbalah/sephirah/[id]">) {
  const page = sephirahPage((await params).id);
  if (!page) notFound();
  return seoMetadata(page.path, page);
}

export default async function SephirahPage({
  params,
}: PageProps<"/kabbalah/sephirah/[id]">) {
  const { id } = await params;
  if (!sephirahPage(id)) notFound();
  return <Sephirah id={id} />;
}
