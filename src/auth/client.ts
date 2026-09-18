"use client";

import { createSettledSessionHook } from "@gadicc/loom/next/auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { SqlAuth } from "./sqlAuth";

/** Same-origin cookies; private offline authorization uses its own fresh check. */
export const authClient = createAuthClient({
  // Types only: the import is erased, so the server auth module never reaches
  // the browser bundle.
  plugins: [inferAdditionalFields<SqlAuth>()],
});

/** Better Auth's `useSession`, pending only until the page's first answer. */
export const useSession = createSettledSessionHook(authClient.useSession);
