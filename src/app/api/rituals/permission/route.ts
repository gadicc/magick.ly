import { getSqlRitualRuntime } from "@/offline/sqlRitualRuntime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return getSqlRitualRuntime().handlers.permission(request);
}
