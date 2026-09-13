import "server-only";

import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  failedRitualPublication,
  type RitualPublicationCode,
  type RitualPublicationResult,
} from "./ritualPublicationContract";
import type {
  RitualPublicationBackfillCandidate,
  RitualPublicationBackfillPage,
} from "./sqlRitualPublicationBackfill";

export interface RitualPublicationBackfillRequestV1 {
  version: 1;
  expectedActorId: string;
  afterRitualId: string | null;
}
export type RitualPublicationBackfillResult =
  | {
      ok: true;
      version: 1;
      done: boolean;
      cursor: string | null;
      skipped: number;
      publication: Extract<RitualPublicationResult, { ok: true }> | null;
    }
  | ({ version: 1; cursor: string | null } & Extract<
      RitualPublicationResult,
      { ok: false }
    >);

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export function parseRitualPublicationBackfillRequest(
  value: unknown,
): RitualPublicationBackfillRequestV1 | null {
  if (
    !plain(value) ||
    Reflect.ownKeys(value).length !== 3 ||
    value.version !== 1 ||
    !id(value.expectedActorId) ||
    (value.afterRitualId !== null && !id(value.afterRitualId))
  )
    return null;
  return {
    version: 1,
    expectedActorId: value.expectedActorId,
    afterRitualId: value.afterRitualId,
  };
}

const errorCode = (error: unknown): RitualPublicationCode => {
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  return [
    "INVALID_REQUEST",
    "AUTH_REQUIRED",
    "ACTOR_CHANGED",
    "FORBIDDEN",
    "BUSY",
  ].includes(code as string)
    ? (code as RitualPublicationCode)
    : "UNAVAILABLE";
};
export const failedRitualPublicationBackfill = (
  code: RitualPublicationCode,
  cursor: string | null,
): Extract<RitualPublicationBackfillResult, { ok: false }> => ({
  version: 1 as const,
  cursor,
  ...failedRitualPublication(code),
});

interface BackfillServices {
  readPage(
    input: { expectedActorId: string; afterRitualId: string | null },
    signal?: AbortSignal,
  ): Promise<RitualPublicationBackfillPage>;
  authorizeGlobalActor(
    expectedActorId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  hasCurrentBundle(
    candidate: RitualPublicationBackfillCandidate,
    expectedActorId: string,
  ): Promise<boolean>;
  publish(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<RitualPublicationResult>;
  createOperationId?(): string;
}

/**
 * Processes at most one unpublished current selection. A prior unexpired SQL
 * intent is discovered and resumed; a new operation is allocated only before a
 * provider-free plan build, then becomes durable before object mutation.
 */
export function createRitualPublicationBackfillService(
  services: BackfillServices,
) {
  const allocate = services.createOperationId ?? createUuidV7;
  return async function backfill(
    input: unknown,
    signal = new AbortController().signal,
  ): Promise<RitualPublicationBackfillResult> {
    const request = parseRitualPublicationBackfillRequest(input);
    if (!request)
      return failedRitualPublicationBackfill("INVALID_REQUEST", null);
    let cursor = request.afterRitualId;
    let skipped = 0;
    try {
      const page = await services.readPage(
        {
          expectedActorId: request.expectedActorId,
          afterRitualId: request.afterRitualId,
        },
        signal,
      );
      for (const candidate of page.candidates) {
        await services.authorizeGlobalActor(request.expectedActorId, signal);
        if (
          await services.hasCurrentBundle(candidate, request.expectedActorId)
        ) {
          cursor = candidate.ritualId;
          skipped++;
          continue;
        }
        if (candidate.pendingOperationIds.length > 1)
          return failedRitualPublicationBackfill("BUSY", cursor);
        const operationId = candidate.pendingOperationIds[0] ?? allocate();
        if (!id(operationId))
          return failedRitualPublicationBackfill("UNAVAILABLE", cursor);
        await services.authorizeGlobalActor(request.expectedActorId, signal);
        const publication = await services.publish(
          {
            version: 1,
            operationId,
            expectedActorId: request.expectedActorId,
            ritualId: candidate.ritualId,
            expectedRevisionId: candidate.currentRevisionId,
            expectedVersion: candidate.version,
          },
          signal,
        );
        if (!publication.ok) return { version: 1, cursor, ...publication };
        return {
          ok: true,
          version: 1,
          done: false,
          cursor: candidate.ritualId,
          skipped,
          publication,
        };
      }
      return {
        ok: true,
        version: 1,
        done: page.exhausted,
        cursor,
        skipped,
        publication: null,
      };
    } catch (error) {
      return failedRitualPublicationBackfill(errorCode(error), cursor);
    }
  };
}
