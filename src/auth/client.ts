"use client";

import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { SqlAuth } from "./sqlAuth";

/** Same-origin cookies; private offline authorization uses its own fresh check. */
export const authClient = createAuthClient({
  // Types only: the import is erased, so the server auth module never reaches
  // the browser bundle.
  plugins: [inferAdditionalFields<SqlAuth>()],
});

// Better Auth reports a signed-out session as pending again while it
// refetches (on focus, reconnect or a cross-tab change). Views that wait
// for the first answer would unmount and re-check identity each time, so
// once this page has had an answer, a refetch keeps the settled state.
let settled = false;

/** Better Auth's `useSession`, pending only until the page's first answer. */
export function useSession(): ReturnType<typeof authClient.useSession> {
  const session = authClient.useSession();
  if (!session.isPending) {
    // Server renders never settle, so hydration starts from the same state.
    if (typeof window !== "undefined") settled = true;
    return session;
  }
  return settled ? { ...session, isPending: false } : session;
}
