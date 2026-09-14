"use client";

import { fetchSqlRitualSource } from "../doc/sqlEditorClient";
import type {
  OfflineLifecycleCoordinator,
  OfflinePermissionOperation,
} from "./lifecycle";
import type { OfflineRitualRepository } from "./repository";
import type { SourceSnapshot } from "./storage";

interface SourceRegistration {
  beginPermissionCheck(): OfflinePermissionOperation | null;
}

/** One fresh permission/source envelope; no source is installed from split snapshots. */
export async function syncOfflineRitualSource(
  runtime: {
    repository: OfflineRitualRepository;
    coordinator: OfflineLifecycleCoordinator;
  },
  registration: SourceRegistration,
  ritualId: string,
  fetcher: typeof fetch = fetch,
  onInstalled?: (value: { title: string; snapshot: SourceSnapshot }) => void,
  /** Retry hint only when lifecycle invalidation aborts before acceptPermission commits. */
  onInterrupted?: () => void,
): Promise<{ title: string; snapshot: SourceSnapshot } | null> {
  const operation = registration.beginPermissionCheck();
  if (!operation) return null;
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
    const delivery = await fetchSqlRitualSource(
      request,
      operation.signal,
      fetcher,
    );
    if (!delivery || !runtime.coordinator.currentPermissionCheck(operation))
      return null;
    const outcome = await runtime.repository.acceptPermission(
      pending,
      delivery.permission,
      undefined,
      delivery.source
        ? {
            revisionId: delivery.source.revisionId,
            parentVersion: delivery.source.parentVersion,
          }
        : undefined,
    );
    if (outcome !== "accepted") return null;
    permissionAccepted = true;
    await runtime.coordinator.changed();
    if (
      delivery.permission.kind !== "granted" ||
      !delivery.permission.grant.sourceEdit ||
      !delivery.source ||
      delivery.permission.ownerId !== operation.account.ownerId
    )
      return null;
    const snapshot: SourceSnapshot = {
      ownerId: operation.account.ownerId,
      ritualId,
      revisionId: delivery.source.revisionId,
      parentVersion: delivery.source.parentVersion,
      title: delivery.source.title,
      source: delivery.source.source,
    };
    if (!(await runtime.repository.installSource(pending, snapshot)))
      return null;
    const installed = { title: delivery.source.title, snapshot };
    onInstalled?.(installed);
    await runtime.coordinator.changed();
    return installed;
  } finally {
    if (!permissionAccepted && operation.signal.aborted)
      try {
        onInterrupted?.();
      } catch {
        // Retry scheduling cannot replace the permission operation's cleanup.
      }
    runtime.coordinator.finish(operation);
  }
}
