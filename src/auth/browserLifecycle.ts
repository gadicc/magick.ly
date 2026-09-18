"use client";

import { isUuidV7 } from "../lib/ids";
import { getBrowserOfflineRuntime } from "../offline/browserRuntime";
import {
  activateStudyAccount,
  prepareStudySignOut,
  studyIdentityRevision,
} from "../study/client";
import { authClient } from "./client";

export type SqlBrowserSignOutFailure =
  | "LOCAL_CLEANUP_FAILED"
  | "AUTH_SIGNOUT_FAILED";

export type SqlBrowserSignOutResult =
  | { ok: true }
  | { ok: false; code: SqlBrowserSignOutFailure };

export interface SqlBrowserLifecycleDependencies {
  refreshPrivateAccount(): Promise<string | null>;
  studyIdentityRevision(): Promise<number>;
  activateStudy(accountId: string, baselineRevision: number): Promise<boolean>;
  prepareStudySignOut(): Promise<void>;
  preparePrivateSignOut(): Promise<boolean>;
  signOutAuth(): Promise<boolean>;
  replace(url: string): void;
}

/**
 * Coordinate fresh account activation and sign-out across both durable browser
 * runtimes. A generation check keeps a delayed session response from restoring
 * account study views after sign-out or a newer identity check.
 */
export function createSqlBrowserLifecycle(
  dependencies: SqlBrowserLifecycleDependencies,
) {
  let generation = 0;
  let accountViewsFenced = false;

  return Object.freeze({
    async refreshVerifiedAccount(): Promise<boolean> {
      if (accountViewsFenced) return false;
      const action = ++generation;
      // Read before the session check, so a sign-out stored while it runs can
      // refuse this activation rather than being overwritten by it.
      const baseline = await dependencies.studyIdentityRevision();
      const ownerId = await dependencies.refreshPrivateAccount();
      if (
        accountViewsFenced ||
        action !== generation ||
        ownerId === null ||
        !isUuidV7(ownerId) ||
        ownerId !== ownerId.toLowerCase()
      )
        return false;
      if (!(await dependencies.activateStudy(ownerId, baseline))) return false;
      return !accountViewsFenced && action === generation;
    },

    async signOut(): Promise<SqlBrowserSignOutResult> {
      accountViewsFenced = true;
      generation++;

      // Both calls synchronously hide/fence account state before their first await.
      let studyCleanup: Promise<void>;
      let privateCleanup: Promise<boolean>;
      try {
        studyCleanup = dependencies.prepareStudySignOut();
      } catch (cause) {
        studyCleanup = Promise.reject(cause);
      }
      try {
        privateCleanup = dependencies.preparePrivateSignOut();
      } catch (cause) {
        privateCleanup = Promise.reject(cause);
      }
      const local = await Promise.allSettled([studyCleanup, privateCleanup]);
      if (
        local[0].status === "rejected" ||
        local[1].status === "rejected" ||
        local[1].value !== true
      )
        return { ok: false, code: "LOCAL_CLEANUP_FAILED" };

      try {
        if (!(await dependencies.signOutAuth()))
          return { ok: false, code: "AUTH_SIGNOUT_FAILED" };
      } catch {
        return { ok: false, code: "AUTH_SIGNOUT_FAILED" };
      }
      dependencies.replace("/");
      return { ok: true };
    },
  });
}

export const sqlBrowserLifecycle = createSqlBrowserLifecycle({
  async refreshPrivateAccount() {
    const runtime = getBrowserOfflineRuntime();
    await runtime.start();
    if (!(await runtime.refreshVerifiedAccount())) return null;
    return runtime.coordinator.state.account?.ownerId ?? null;
  },
  studyIdentityRevision,
  activateStudy: activateStudyAccount,
  prepareStudySignOut,
  preparePrivateSignOut: () => getBrowserOfflineRuntime().signOut(),
  async signOutAuth() {
    const result = await authClient.signOut();
    return !result.error;
  },
  replace: (url) => window.location.replace(url),
});
