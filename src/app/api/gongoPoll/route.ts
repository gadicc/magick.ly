/**
 * SQL is authoritative after cutover. The legacy implementation lives only in
 * migration test support and is not imported by this production route.
 */
export async function POST() {
  return Response.json(
    {
      error: "LEGACY_CLIENT_UPGRADE_REQUIRED",
      recovery: "Open this site in the current app to preserve offline work.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie, Authorization",
      },
    },
  );
}
