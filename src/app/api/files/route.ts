import { createFilesRouteHandlers } from "@gadicc/loom/next/files";
import { authorizeFilesRead, authorizeFilesUpload } from "@/files/access";
import { filesRepository } from "@/files/repository";
import { ritualFileService } from "@/files/runtime";
import { filesStorage } from "@/files/storage";

const handlers = createFilesRouteHandlers({
  authorizeRead: authorizeFilesRead,
  authorizeUpload: authorizeFilesUpload,
  repository: filesRepository,
  storage: filesStorage,
  service: ritualFileService,
  defaultDownloadDisposition: "inline",
  downloadCacheControl: "private, no-store",
});

/** Read-only managed Loom route. Uploads use the ritual signer/finalizer endpoints. */
export async function GET(request: Request) {
  const response = await handlers.GET(request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
