import { getCurrentSqlViewer } from "@/auth/viewer";

export const runtime = "nodejs";
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

/** Fresh identity for local account binding; never a ritual permission or offline lease. */
export async function GET() {
  try {
    const viewer = await getCurrentSqlViewer();
    if (!viewer)
      return Response.json(
        { user: null, admin: false },
        { status: 401, headers: responseHeaders },
      );
    return Response.json(viewer, { headers: responseHeaders });
  } catch {
    return Response.json(
      { error: "SESSION_UNAVAILABLE" },
      { status: 503, headers: responseHeaders },
    );
  }
}
