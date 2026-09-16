import { notFound } from "next/navigation";
import { entityIds, pathPage } from "@/seo/entities";
import { seoMetadata } from "@/seo/metadata";
import Path from "./path";

export function generateStaticParams() {
  return entityIds("tolPath");
}

export async function generateMetadata({
  params,
}: PageProps<"/kabbalah/path/[id]">) {
  const page = pathPage((await params).id);
  if (!page) notFound();
  return seoMetadata(page.path, page);
}

export default async function PathPage({
  params,
}: PageProps<"/kabbalah/path/[id]">) {
  const { id } = await params;
  if (!pathPage(id)) notFound();
  return <Path id={id} />;
}
