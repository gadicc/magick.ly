import { createRitualPublicationBackfillHttpHandler } from "@/offline/ritualPublicationHttp";
import { backfillCurrentRitualPublication } from "@/offline/ritualPublicationRuntime";

export const runtime = "nodejs";

export const POST = createRitualPublicationBackfillHttpHandler({
  backfill: backfillCurrentRitualPublication,
});
