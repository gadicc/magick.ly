import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db/neonFull";
import { userAccess } from "../db/schema/userProfile";
import { getCurrentSqlSession } from "./session";

export interface SqlViewer {
  user: { id: string; name: string; image: string | null };
  admin: boolean;
}

/** Fresh display identity plus current SQL global access, fenced by a session recheck. */
export async function getCurrentSqlViewer(): Promise<SqlViewer | null> {
  const current = await getCurrentSqlSession();
  if (!current) return null;
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
    return null;
  return {
    user: {
      id: rechecked.user.id,
      name: rechecked.user.name,
      image: rechecked.user.image ?? null,
    },
    admin: access?.admin === true,
  };
}
