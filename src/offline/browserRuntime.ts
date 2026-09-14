"use client";

import { isUuidV7 } from "../lib/ids";
import {
  OfflineLifecycleCoordinator,
  type OfflineLifecycleState,
} from "./lifecycle";
import { LockedRecoveryQueue } from "./recovery";
import { OfflineRitualRepository } from "./repository";
import { RitualOfflineDatabase } from "./storage";

const CHANNEL = "magickli-ritual-offline-v1";
const SESSION_CHECK_TIMEOUT_MS = 5_000;

export interface BrowserOfflineRuntime {
  repository: OfflineRitualRepository;
  coordinator: OfflineLifecycleCoordinator;
  recovery: LockedRecoveryQueue;
  start(): Promise<void>;
  refreshVerifiedAccount(fetcher?: typeof fetch): Promise<boolean>;
  signOut(): Promise<boolean>;
  subscribeState(listener: (state: OfflineLifecycleState) => void): () => void;
}

function exactSessionUser(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(row).length !== 2 ||
    !Object.hasOwn(row, "user") ||
    !Object.hasOwn(row, "admin") ||
    typeof row.admin !== "boolean" ||
    !row.user ||
    typeof row.user !== "object" ||
    Array.isArray(row.user)
  )
    return null;
  const user = row.user as Record<string, unknown>;
  if (
    !["id", "name", "image"].every((key) => Object.hasOwn(user, key)) ||
    Reflect.ownKeys(user).length !== 3 ||
    typeof user.id !== "string" ||
    !isUuidV7(user.id) ||
    user.id !== user.id.toLowerCase() ||
    (user.name !== null && typeof user.name !== "string") ||
    (user.image !== null && typeof user.image !== "string")
  )
    return null;
  return user.id;
}

export function createBrowserOfflineRuntime(
  database = new RitualOfflineDatabase(),
): BrowserOfflineRuntime {
  const repository = new OfflineRitualRepository(database);
  const recovery = new LockedRecoveryQueue();
  const listeners = new Set<(state: OfflineLifecycleState) => void>();
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(CHANNEL)
      : null;
  const coordinator = new OfflineLifecycleCoordinator(
    repository,
    {
      document,
      window,
      visible: () => document.visibilityState !== "hidden",
      now: Date.now,
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      messages: {
        post: (message) => channel?.postMessage(message),
        subscribe: (listener) => {
          if (!channel) return () => {};
          const receive = (event: MessageEvent<unknown>) =>
            listener(event.data);
          channel.addEventListener("message", receive);
          return () => channel.removeEventListener("message", receive);
        },
      },
    },
    recovery,
    {
      state: (state) => {
        for (const listener of listeners) listener(state);
      },
    },
  );
  let started: Promise<void> | undefined;
  // Every caller gets a fresh session read after the preceding coordinator
  // transition. Explicit sign-out permanently cancels this instance's queue.
  let accountRefreshFenced = false;
  let accountRefreshTransition: Promise<void> = Promise.resolve();
  const performVerifiedAccountRefresh = async (fetcher: typeof fetch) => {
    const baseline = coordinator.state;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      SESSION_CHECK_TIMEOUT_MS,
    );
    try {
      const response = await fetcher("/api/session", {
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const policy = response.headers.get("cache-control")?.toLowerCase();
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase();
      const url = new URL(response.url);
      if (
        response.status !== 200 ||
        response.redirected ||
        url.origin !== location.origin ||
        url.pathname !== "/api/session" ||
        url.search !== "" ||
        mediaType !== "application/json" ||
        !policy?.split(",").some((value) => value.trim() === "no-store")
      )
        return false;
      const ownerId = exactSessionUser(await response.json());
      const current = coordinator.state;
      if (
        !ownerId ||
        current.generation !== baseline.generation ||
        current.account?.ownerId !== baseline.account?.ownerId ||
        current.account?.epoch !== baseline.account?.epoch
      )
        return false;
      return coordinator.activateVerifiedAccount(ownerId);
    } catch {
      // Offline, anonymous and expired-session results never clear a local account.
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const runtime: BrowserOfflineRuntime = {
    repository,
    coordinator,
    recovery,
    start() {
      return (started ??= repository
        .resumeCleanup()
        .catch(() => {})
        .then(() => coordinator.start()));
    },
    refreshVerifiedAccount(fetcher = fetch) {
      if (accountRefreshFenced) return Promise.resolve(false);
      const work = () =>
        accountRefreshFenced
          ? Promise.resolve(false)
          : performVerifiedAccountRefresh(fetcher);
      const result = accountRefreshTransition.then(work, work);
      accountRefreshTransition = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    signOut() {
      accountRefreshFenced = true;
      return coordinator.signOut();
    },
    subscribeState(listener) {
      listeners.add(listener);
      listener(coordinator.state);
      return () => listeners.delete(listener);
    },
  };
  return Object.freeze(runtime);
}

let singleton: BrowserOfflineRuntime | undefined;

/** Lazily create the one repository/coordinator shared by readers and sign-out. */
export function getBrowserOfflineRuntime(): BrowserOfflineRuntime {
  if (typeof window === "undefined")
    throw new Error("Browser offline runtime is unavailable on the server");
  return (singleton ??= createBrowserOfflineRuntime());
}
