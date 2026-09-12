import { connection } from "next/server";
import DocPageShell from "../DocPageShell";

export default async function DocPage({
  params,
}: {
  params: Promise<{ _id: string }>;
}) {
  // Database-backed IDs must never become build-time or on-demand static HTML.
  await connection();
  const { _id } = await params;
  return <DocPageShell id={_id} />;
}
