"use client";

import { createAuthClient } from "better-auth/react";

/** Same-origin cookies; private offline authorization uses its own fresh check. */
export const authClient = createAuthClient();
export const useSession = authClient.useSession;
