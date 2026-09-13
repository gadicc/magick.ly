import { getSqlRitualRuntime } from "@/offline/sqlRitualRuntime";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      ritualId: string;
      bundleId: string;
      assetKey: string;
    }>;
  },
) {
  const { ritualId, bundleId, assetKey } = await params;
  return getSqlRitualRuntime().handlers.asset(request, {
    expectedActorId: request.headers.get("x-magickli-expected-actor"),
    ritualId,
    bundleId,
    assetKey,
  });
}
