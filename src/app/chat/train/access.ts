import { getCurrentSqlViewer } from "../../../auth/viewer";

/** Checks the server user record for global-admin access to the shared corpus. */
export async function trainingAccess(): Promise<200 | 401 | 403> {
  const viewer = await getCurrentSqlViewer();
  if (!viewer) return 401;
  return viewer.admin ? 200 : 403;
}
