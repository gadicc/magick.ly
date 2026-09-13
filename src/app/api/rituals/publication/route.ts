import { createRitualPublicationHttpHandler } from "@/offline/ritualPublicationHttp";
import { requestCurrentRitualPublication } from "@/offline/ritualPublicationRuntime";

export const runtime = "nodejs";

export const POST = createRitualPublicationHttpHandler({
  publish: requestCurrentRitualPublication,
});
