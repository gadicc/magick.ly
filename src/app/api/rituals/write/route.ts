import { getSqlRitualEditorRuntime } from "@/doc/sqlEditorRuntime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return getSqlRitualEditorRuntime().write(request);
}
