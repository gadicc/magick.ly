import { eq } from "drizzle-orm";
import { getCurrentSqlSession } from "@/auth/session";
import { db } from "@/db/neonFull";
import { userAccess } from "@/db/schema/userProfile";

export const runtime = "nodejs";
const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

/** Fresh identity for local account binding; never a ritual permission or offline lease. */
export async function GET() {
  try {
    const current = await getCurrentSqlSession();
    if (!current)
      return Response.json(
        { user: null, admin: false },
        { status: 401, headers: responseHeaders },
      );
    const [access] = await db
      .select({ admin: userAccess.admin })
      .from(userAccess)
      .where(eq(userAccess.userId, current.user.id));
    const rechecked = await getCurrentSqlSession();
    if (
      !rechecked ||
      rechecked.user.id !== current.user.id ||
      rechecked.session.id !== current.session.id
    )
      return Response.json(
        { user: null, admin: false },
        { status: 401, headers: responseHeaders },
      );
    return Response.json(
      {
        user: {
          id: rechecked.user.id,
          name: rechecked.user.name,
          image: rechecked.user.image ?? null,
        },
        admin: access?.admin === true,
      },
      { headers: responseHeaders },
    );
  } catch {
    return Response.json(
      { error: "SESSION_UNAVAILABLE" },
      { status: 503, headers: responseHeaders },
    );
  }
}
