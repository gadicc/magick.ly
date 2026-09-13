import "server-only";

import type { PreparedRitualBundle } from "./prepareRitualBundle";
import type { R2RitualBundleStorage } from "./r2RitualBundleStorage";
import {
  failedRitualPublication,
  parseRitualPublicationRequest,
  type RitualPublicationCode,
  type RitualPublicationResult,
} from "./ritualPublicationContract";
import type {
  RitualBundleClaimResult,
  RitualBundleOperation,
  RitualBundleReservationResult,
} from "./sqlRitualBundlePublications";
import type { RitualPublicationSelection } from "./sqlRitualPublicationSelection";

interface PublicationPublisher {
  initiate(
    request: RitualBundleOperation,
    prepared: PreparedRitualBundle,
    signal?: AbortSignal,
  ): Promise<RitualBundleReservationResult>;
  claim(
    request: RitualBundleOperation,
    signal?: AbortSignal,
  ): Promise<RitualBundleClaimResult>;
  publish(
    claim: Extract<RitualBundleClaimResult, { kind: "claimed" }>["claim"],
    receipts: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<{
    operationId: string;
    bundleId: string;
    ritualId: string;
    publishedAtMs: number;
  }>;
  releaseClaim(
    claim: Extract<RitualBundleClaimResult, { kind: "claimed" }>["claim"],
    signal?: AbortSignal,
  ): Promise<void>;
}

interface PublicationServices {
  loadSelection(
    request: {
      expectedActorId: string;
      ritualId: string;
      expectedRevisionId: string;
      expectedVersion: number;
    },
    signal?: AbortSignal,
  ): Promise<RitualPublicationSelection>;
  buildPrepared(
    input: { selection: RitualPublicationSelection; operationId: string },
    signal?: AbortSignal,
  ): Promise<PreparedRitualBundle>;
  publisher: PublicationPublisher;
  storage: Pick<R2RitualBundleStorage, "ensureAsset">;
}

const code = (error: unknown): RitualPublicationCode => {
  const value =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (value === "INVALID_REQUEST" || value === "INVALID_INPUT")
    return "INVALID_REQUEST";
  if (value === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (value === "ACTOR_CHANGED") return "ACTOR_CHANGED";
  if (value === "FORBIDDEN") return "FORBIDDEN";
  if (value === "STALE" || value === "SNAPSHOT_MISMATCH") return "STALE";
  if (value === "INCOMPLETE" || value === "MISSING_BYTES") return "INCOMPLETE";
  if (value === "EXPIRED") return "EXPIRED";
  if (value === "OPERATION_CONFLICT") return "OPERATION_CONFLICT";
  if (value === "BUSY") return "BUSY";
  if (value === "ABORTED" || value === "TIMEOUT") return "ABORTED";
  return "UNAVAILABLE";
};

function sameSelection(
  expected: RitualPublicationSelection,
  current: RitualPublicationSelection,
) {
  return (
    expected.ritualId === current.ritualId &&
    expected.title === current.title &&
    expected.contentJson === current.contentJson &&
    expected.currentRevisionId === current.currentRevisionId &&
    expected.currentCompiledArtifactId === current.currentCompiledArtifactId &&
    expected.version === current.version &&
    JSON.stringify(expected.descriptor) === JSON.stringify(current.descriptor)
  );
}
const safeReceipt = (receipt: {
  operationId: string;
  bundleId: string;
  ritualId: string;
  publishedAtMs: number;
}) => ({
  operationId: receipt.operationId,
  bundleId: receipt.bundleId,
  ritualId: receipt.ritualId,
  publishedAtMs: receipt.publishedAtMs,
});

/**
 * Runs durable reservation -> fenced claim -> exact object verification -> SQL
 * publication. A fresh editor-policy snapshot occurs immediately before every
 * provider mutation and again before the final SQL marker write.
 */
export function createRitualPublicationService(services: PublicationServices) {
  return async function publish(
    input: unknown,
    signal = new AbortController().signal,
  ): Promise<RitualPublicationResult> {
    const request = parseRitualPublicationRequest(input);
    if (!request) return failedRitualPublication("INVALID_REQUEST");
    const selectionRequest = {
      expectedActorId: request.expectedActorId,
      ritualId: request.ritualId,
      expectedRevisionId: request.expectedRevisionId,
      expectedVersion: request.expectedVersion,
    };
    const operation: RitualBundleOperation = {
      operationId: request.operationId,
      expectedActorId: request.expectedActorId,
    };
    let prepared: PreparedRitualBundle | undefined;
    let claim:
      | Extract<RitualBundleClaimResult, { kind: "claimed" }>["claim"]
      | undefined;
    try {
      const selection = await services.loadSelection(selectionRequest, signal);
      prepared = await services.buildPrepared(
        { selection, operationId: request.operationId },
        signal,
      );
      const beforeReservation = await services.loadSelection(
        selectionRequest,
        signal,
      );
      if (!sameSelection(selection, beforeReservation))
        return failedRitualPublication("STALE");
      const reservation = await services.publisher.initiate(
        operation,
        prepared,
        signal,
      );
      if (reservation.kind === "completed")
        return {
          ok: true,
          state: "completed",
          replayed: true,
          receipt: safeReceipt(reservation.receipt),
        };
      const claimed = await services.publisher.claim(operation, signal);
      if (claimed.kind === "completed")
        return {
          ok: true,
          state: "completed",
          replayed: true,
          receipt: safeReceipt(claimed.receipt),
        };
      claim = claimed.claim;
      const receipts: unknown[] = [];
      for (const asset of claim.assets) {
        const current = await services.loadSelection(selectionRequest, signal);
        if (!sameSelection(selection, current))
          throw Object.assign(new Error("STALE"), { code: "STALE" });
        let bytes = prepared.copyBytes(asset.key) ?? undefined;
        try {
          receipts.push(
            await services.storage.ensureAsset(
              { claim, assetKey: asset.key, bytes },
              signal,
            ),
          );
        } finally {
          bytes?.fill(0);
          bytes = undefined;
        }
      }
      const beforePublish = await services.loadSelection(
        selectionRequest,
        signal,
      );
      if (!sameSelection(selection, beforePublish))
        throw Object.assign(new Error("STALE"), { code: "STALE" });
      const receipt = await services.publisher.publish(claim, receipts, signal);
      return {
        ok: true,
        state: "completed",
        replayed: reservation.replayed,
        receipt: safeReceipt(receipt),
      };
    } catch (error) {
      if (claim)
        try {
          await services.publisher.releaseClaim(claim, signal);
        } catch {
          // The original failure remains authoritative; a fenced claim expires.
        }
      return failedRitualPublication(code(error));
    } finally {
      prepared?.dispose();
    }
  };
}
