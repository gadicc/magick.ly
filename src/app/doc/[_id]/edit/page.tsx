import { Alert } from "@mui/material";
import { connection } from "next/server";
import { resolveSqlRitualRouteId } from "@/doc/sqlRuntime";
import SqlDocEdit from "./SqlDocEdit";

export default async function DocEditPage({
  params,
}: {
  params: Promise<{ _id: string }>;
}) {
  await connection();
  const ritualId = await resolveSqlRitualRouteId((await params)._id).catch(
    () => null,
  );
  return ritualId ? (
    <SqlDocEdit key={ritualId} ritualId={ritualId} />
  ) : (
    <Alert severity="info">Ritual source is unavailable.</Alert>
  );
}
