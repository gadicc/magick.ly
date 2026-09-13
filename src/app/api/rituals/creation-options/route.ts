import { getSqlRitualEditorRuntime } from "@/doc/sqlEditorRuntime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return getSqlRitualEditorRuntime().creationOptions(request);
}
