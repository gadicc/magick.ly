"use client";

import * as React from "react";
import { isUuidV7 } from "../lib/ids";
import { refreshStudyProgress, syncStudyProgress } from "./clientTransport";
import type { StudyMode } from "./reviewContract";
import { StudyDatabase, StudyRepository, type StudyScope } from "./storage";
import type { StudyRuntimeSetStats } from "./types";

let singleton: StudyRepository | undefined;
/** Undefined has no fresh identity yet; null is a sign-out fence; a UUID is an explicit activation. */
let accountActivation: string | null | undefined;
let identityGeneration = 0;
let identityTransition: Promise<void> = Promise.resolve();
const activeRequests = new Set<{
  controller: AbortController;
  promise: Promise<void>;
}>();
const activeScopeResolutions = new Set<{
  controller: AbortController;
  promise: Promise<void>;
}>();
const controlListeners = new Set<() => void>();

class StudyAccountActivationPending extends Error {}

function accountScope(accountId: string): StudyScope {
  return {
    key: `account:${accountId}`,
    kind: "account",
    ownerId: accountId,
  };
}

function notifyControlListeners() {
  for (const listener of controlListeners) listener();
}

function abortActiveWork() {
  for (const request of [...activeRequests, ...activeScopeResolutions])
    request.controller.abort();
}

function enqueueIdentityTransition(work: () => Promise<void>) {
  const result = identityTransition.then(work, work);
  identityTransition = result.catch(() => {});
  return result;
}

function repository() {
  if (!singleton) {
    singleton = new StudyRepository(new StudyDatabase());
    singleton.subscribeIdentity((signal) => {
      accountActivation =
        signal.type === "signed-out" ? null : signal.accountId;
      identityGeneration++;
      abortActiveWork();
      notifyControlListeners();
    });
  }
  return singleton;
}

function useControlRevision() {
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    controlListeners.add(listener);
    return () => {
      controlListeners.delete(listener);
    };
  }, []);
  return revision;
}

/**
 * Immediately hides account study state, then waits for aborted refresh/review
 * requests. Durable snapshots and unsent events remain bound to their owner.
 */
export async function prepareStudySignOut() {
  const study = repository();
  study.announceSignedOut();
  const pending = [...activeRequests, ...activeScopeResolutions];
  await Promise.allSettled(pending.map((request) => request.promise));
  try {
    await enqueueIdentityTransition(() => study.markSignedOut());
  } catch (cause) {
    throw new Error("Study sign-out state could not be saved.", {
      cause,
    });
  }
}

/** Resumes account views only after the auth runtime freshly verifies this exact account. */
export async function activateStudyAccount(accountId: string) {
  if (!isUuidV7(accountId) || accountId !== accountId.toLowerCase())
    throw new Error("Study account identity must be a canonical UUIDv7.");
  const study = repository();
  accountActivation = null;
  const generation = ++identityGeneration;
  abortActiveWork();
  notifyControlListeners();
  await enqueueIdentityTransition(() => study.markAccountActive(accountId));
  if (generation === identityGeneration) study.announceAccount(accountId);
}

function assertCurrentIdentity(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== identityGeneration)
    throw new DOMException("Study identity changed.", "AbortError");
}

async function resolveScope(
  accountId: string | null,
  signal: AbortSignal,
  generation: number,
): Promise<StudyScope> {
  assertCurrentIdentity(generation, signal);
  if (accountId !== null) {
    if (accountActivation === accountId) return accountScope(accountId);
    if (accountActivation !== undefined)
      throw new StudyAccountActivationPending();

    // A cached UI session may expose only the exact account that this device
    // previously activated from a fresh no-store session check. It must not
    // establish or replace durable ownership by itself.
    const lastAccountId = await repository().lastLocalAccountId();
    assertCurrentIdentity(generation, signal);
    if (lastAccountId === accountId) return accountScope(accountId);
    throw new StudyAccountActivationPending();
  }
  if (accountActivation === null) return repository().scope(null);
  let response: Response;
  try {
    response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    assertCurrentIdentity(generation, signal);
    const lastAccountId = await repository().lastLocalAccountId();
    assertCurrentIdentity(generation, signal);
    return repository().scope(lastAccountId);
  }
  assertCurrentIdentity(generation, signal);
  if (response.status === 401) {
    await repository().markSignedOut();
    if (generation !== identityGeneration)
      throw new DOMException("Study identity changed.", "AbortError");
    // markSignedOut() signals only when it changes the device record, so an
    // already signed-out device would otherwise ask again for every view.
    accountActivation = null;
    return repository().scope(null);
  }
  if (response.ok) {
    const body: unknown = await response.json();
    assertCurrentIdentity(generation, signal);
    const id =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { user?: { id?: unknown } }).user?.id
        : null;
    if (isUuidV7(id) && id === id.toLowerCase()) return repository().scope(id);
    throw new Error("Malformed study identity response.");
  }
  const lastAccountId = await repository().lastLocalAccountId();
  assertCurrentIdentity(generation, signal);
  return repository().scope(lastAccountId);
}

function useScope(accountId: string | null | undefined) {
  const controlRevision = useControlRevision();
  const requestedKey =
    accountId === undefined
      ? "loading"
      : accountId !== null &&
          accountActivation !== undefined &&
          accountActivation !== accountId
        ? "suspended"
        : accountId === null
          ? "anonymous"
          : `account:${accountId}`;
  const [resolved, setResolved] = React.useState<{
    key: string;
    scope: StudyScope | null;
  }>({ key: "", scope: null });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    void controlRevision;
    let active = true;
    setResolved({ key: requestedKey, scope: null });
    setError(null);
    if (accountId === undefined || requestedKey === "suspended")
      return () => undefined;
    const controller = new AbortController();
    const generation = identityGeneration;
    const tracked: {
      controller: AbortController;
      promise: Promise<void>;
    } = { controller, promise: Promise.resolve() };
    const abort = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Study identity changed.", "AbortError")),
        { once: true },
      );
    });
    tracked.promise = Promise.race([
      resolveScope(accountId, controller.signal, generation),
      abort,
    ])
      .then((value) => {
        if (active && generation === identityGeneration)
          setResolved({ key: requestedKey, scope: value });
      })
      .catch((cause) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === "AbortError") &&
          !(cause instanceof StudyAccountActivationPending)
        )
          setError(cause instanceof Error ? cause.message : "Storage failed.");
      })
      .finally(() => {
        activeScopeResolutions.delete(tracked);
      });
    activeScopeResolutions.add(tracked);
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, controlRevision, requestedKey]);
  return {
    scope: resolved.key === requestedKey ? resolved.scope : null,
    error,
  };
}

function useRepositoryRevision() {
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const unsubscribe = repository().subscribe(() =>
      setRevision((value) => value + 1),
    );
    return () => {
      unsubscribe();
    };
  }, []);
  return revision;
}

function useAccountNetwork(scope: StudyScope | null, setId?: string) {
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const run = React.useCallback(async () => {
    if (
      !scope ||
      scope.kind !== "account" ||
      accountActivation !== scope.ownerId ||
      !navigator.onLine
    )
      return;
    const controller = new AbortController();
    const tracked: {
      controller: AbortController;
      promise: Promise<void>;
    } = {
      controller,
      promise: Promise.resolve(),
    };
    tracked.promise = (async () => {
      try {
        const refresh = await refreshStudyProgress(repository(), scope, {
          setId,
          signal: controller.signal,
        });
        const sync = await syncStudyProgress(repository(), scope, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setSyncError(
            sync.blocked || !refresh.ok
              ? "Some saved study progress is still waiting to sync."
              : null,
          );
      } catch (cause) {
        if (!controller.signal.aborted)
          setSyncError(cause instanceof Error ? cause.message : "Sync failed.");
      } finally {
        activeRequests.delete(tracked);
      }
    })();
    activeRequests.add(tracked);
    await tracked.promise;
  }, [scope, setId]);
  React.useEffect(() => {
    if (!scope || scope.kind !== "account") return;
    void run();
    const foreground = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [scope, run]);
  return { syncError, sync: run };
}

/** Live current-scope set list. Undefined account means auth is still loading. */
export function useStudyList(accountId: string | null | undefined) {
  const { scope, error } = useScope(accountId);
  const revision = useRepositoryRevision();
  const [stored, setStored] = React.useState<{
    key: string;
    snapshots: StudyRuntimeSetStats[];
  }>({ key: "", snapshots: [] });
  const viewKey = scope?.key ?? "";
  const network = useAccountNetwork(scope);
  React.useEffect(() => {
    void revision;
    let active = true;
    if (!scope) {
      setStored({ key: "", snapshots: [] });
      return () => undefined;
    }
    repository()
      .listSnapshots(scope)
      .then((rows) => active && setStored({ key: scope.key, snapshots: rows }))
      .catch(() => active && setStored({ key: scope.key, snapshots: [] }));
    return () => {
      active = false;
    };
  }, [scope, revision]);
  return {
    loading:
      accountId === undefined ||
      !scope ||
      (viewKey !== "" && stored.key !== viewKey),
    error: error ?? network.syncError,
    scope,
    snapshots: stored.key === viewKey ? stored.snapshots : [],
    sync: network.sync,
  };
}

/** Live set state with atomic local review recording before any network attempt. */
export function useStudySet(
  accountId: string | null | undefined,
  setId: string,
  cardIds: readonly string[],
) {
  const { scope, error } = useScope(accountId);
  const revision = useRepositoryRevision();
  const [stored, setStored] = React.useState<{
    key: string;
    snapshot: StudyRuntimeSetStats | null;
  }>({ key: "", snapshot: null });
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const stableCardIds = React.useMemo(() => [...cardIds].sort(), [cardIds]);
  const network = useAccountNetwork(scope, setId);
  const viewKey = scope ? `${scope.key}\u0000${setId}` : "";
  React.useEffect(() => {
    void revision;
    let active = true;
    setStored((current) =>
      current.key === viewKey ? current : { key: viewKey, snapshot: null },
    );
    setStorageError(null);
    if (!scope) return () => undefined;
    repository()
      .ensureSnapshot(scope, setId, stableCardIds)
      .then(() => repository().getSnapshot(scope, setId))
      .then(
        (row) => active && setStored({ key: viewKey, snapshot: row ?? null }),
      )
      .catch(
        (cause) =>
          active &&
          setStorageError(
            cause instanceof Error ? cause.message : "Study storage failed.",
          ),
      );
    return () => {
      active = false;
    };
  }, [scope, setId, stableCardIds, revision, viewKey]);

  const review = React.useCallback(
    async (input: {
      cardId: string;
      mode: StudyMode;
      wrongCount: number;
      startTime: number;
    }) => {
      if (!scope) throw new Error("Study progress is still loading.");
      const answeredAtMs = Date.now();
      await repository().recordReview(
        scope,
        {
          setId,
          cardId: input.cardId,
          mode: input.mode,
          wrongCount: input.wrongCount,
          elapsedMs: Math.max(0, answeredAtMs - input.startTime),
          answeredAtMs,
        },
        stableCardIds,
      );
      if (scope.kind === "account") void network.sync();
    },
    [network, scope, setId, stableCardIds],
  );
  return {
    loading:
      accountId === undefined ||
      !scope ||
      stored.key !== viewKey ||
      !stored.snapshot,
    error: error ?? storageError ?? network.syncError,
    scope,
    snapshot: stored.key === viewKey ? stored.snapshot : null,
    review,
    sync: network.sync,
  };
}
