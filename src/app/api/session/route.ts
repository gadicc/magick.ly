import { getCurrentSqlViewer } from "@/auth/viewer";

export const runtime = "nodejs";
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

/**
 * Fresh identity for local account binding; never a ritual permission or offline lease.
 * Signed-out and expired sessions get 200 with a null user: browsers log every
 * 401 as a failed request, and anonymous pages ask on each load and refocus.
 */
export async function GET() {
  try {
    const viewer = await getCurrentSqlViewer();
    return Response.json(viewer ?? { user: null, admin: false }, {
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "SESSION_UNAVAILABLE" },
      { status: 503, headers: responseHeaders },
    );
  }
}
