import {
  createRitualUploadRouteHandlers,
  unavailableRitualUploadResponse,
} from "@/files/ritualUploadRoutes";
import { getRitualUploadRuntime } from "@/files/ritualUploadRuntime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return createRitualUploadRouteHandlers(getRitualUploadRuntime()).finalize(
      request,
    );
  } catch {
    return unavailableRitualUploadResponse();
  }
}
