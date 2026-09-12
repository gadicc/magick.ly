import { db, ObjectId } from "../../../api-lib/db";
import { auth } from "../../../auth";

/** Checks the server user record for global-admin access to the shared corpus. */
export async function trainingAccess(): Promise<200 | 401 | 403> {
  const session = await auth();
  if (!session?.user?.id) return 401;
  if (!ObjectId.isValid(session.user.id)) return 403;

  // The session callback exposes an ID, not the authoritative admin flag.
  const user = await db.collection("users").findOne({
    _id: new ObjectId(session.user.id),
  });
  return user?.admin === true ? 200 : 403;
}
