"use client";

import type {
  OfflineLifecycleCoordinator,
  OfflineLifecycleState,
  OfflinePermissionOperation,
} from "./lifecycle";
import type { OfflineRitualRepository } from "./repository";
import { fetchRitualAsset, fetchRitualDelivery } from "./ritualClientTransport";
import type { RitualBundle, StoredAsset } from "./storage";

interface PermissionRegistration {
  beginPermissionCheck(): OfflinePermissionOperation | null;
}

interface DownloadRuntime {
  repository: OfflineRitualRepository;
  coordinator: OfflineLifecycleCoordinator;
  subscribeState: (
    listener: (state: OfflineLifecycleState) => void,
  ) => () => void;
}

/**
 * Refresh one ritual through the current account epoch. The first accepted
 * permission write is broadcast before asset I/O so denials and source-right
 * downgrades close every tab immediately.
 */
export async function refreshOfflineRitual(
  runtime: DownloadRuntime,
  registration: PermissionRegistration,
  ritualId: string,
  options: {
    fetcher?: typeof fetch;
    routeAlias?: string;
    /** Retry hint only when lifecycle invalidation aborts before acceptPermission commits. */
    onInterrupted?: () => void;
  } = {},
): Promise<boolean> {
  const fetcher = options.fetcher ?? fetch;
  const operation = registration.beginPermissionCheck();
  if (!operation) return false;
  let permissionAccepted = false;
  try {
    const pending = await runtime.repository.beginCheck(
      operation.account,
      ritualId,
    );
    const request = {
      version: 1 as const,
      requestId: pending.requestId,
      expectedActorId: pending.ownerId,
      ritualId: pending.ritualId,
    };
    const delivery = await fetchRitualDelivery(
      request,
      operation.signal,
      fetcher,
      options.routeAlias ?? null,
    );
    if (!delivery || !runtime.coordinator.currentPermissionCheck(operation))
      return false;
    const binding = delivery.bundle
      ? {
          bundleId: delivery.bundle.bundleId,
          manifestSha256: delivery.bundle.manifestSha256,
          ...(delivery.routeAlias ? { routeAlias: delivery.routeAlias } : {}),
        }
      : undefined;
    const outcome = await runtime.repository.acceptPermission(
      pending,
      delivery.permission,
      binding,
    );
    if (outcome !== "accepted") return false;
    permissionAccepted = true;
    await runtime.coordinator.changed();
    if (
      delivery.permission.kind !== "granted" ||
      !delivery.bundle ||
      operation.account.ownerId !== delivery.permission.ownerId
    )
      return delivery.permission.kind !== "temporarily-unavailable";

    const existing = await runtime.repository.readBundle(
      operation.account,
      ritualId,
    );
    if (
      existing?.bundleId === delivery.bundle.bundleId &&
      existing.manifestSha256 === delivery.bundle.manifestSha256
    )
      return true;

    const generation = runtime.coordinator.state.generation;
    const controller = new AbortController();
    const unsubscribe = runtime.subscribeState((state) => {
      if (
        state.generation !== generation ||
        state.account?.ownerId !== operation.account.ownerId ||
        state.account.epoch !== operation.account.epoch
      )
        controller.abort();
    });
    try {
      const manifest = delivery.bundle.manifest;
      const assets: StoredAsset[] = [];
      for (const entry of manifest.assets) {
        const blob = await fetchRitualAsset(
          operation.account.ownerId,
          ritualId,
          manifest.bundleId,
          entry,
          controller.signal,
          fetcher,
        );
        if (!blob || controller.signal.aborted) return false;
        assets.push({
          ...entry,
          ownerId: operation.account.ownerId,
          ritualId,
          bundleId: manifest.bundleId,
          blob,
        });
      }
      const bundle: RitualBundle = {
        version: 1,
        ownerId: operation.account.ownerId,
        ritualId,
        bundleId: manifest.bundleId,
        manifestSha256: delivery.bundle.manifestSha256,
        title: manifest.title,
        renderedJson: manifest.renderedJson,
        renderedSha256: manifest.descriptor.contentSha256,
        rendererFormat: "jrt-v1",
        assets: manifest.assets.map((entry) => ({ ...entry })),
        occurrences: manifest.occurrences.map((entry) => ({
          ...entry,
          path: [...entry.path],
        })),
        routeAliases: [
          ...new Set([
            ...(existing?.routeAliases ?? []),
            ...(delivery.routeAlias ? [delivery.routeAlias] : []),
          ]),
        ],
      };
      const installed = await runtime.repository.installBundle(
        pending,
        bundle,
        assets,
      );
      if (installed) await runtime.coordinator.changed();
      return installed;
    } finally {
      controller.abort();
      unsubscribe();
    }
  } finally {
    if (!permissionAccepted && operation.signal.aborted)
      try {
        options.onInterrupted?.();
      } catch {
        // Retry scheduling cannot replace the permission operation's cleanup.
      }
    runtime.coordinator.finish(operation);
  }
}
