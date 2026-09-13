import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import {
  studyCardStates,
  studyProgress,
  studyReviewReceipts,
} from "../db/schema/studyProgress";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import { studyProgressSnapshot } from "./progressSnapshot";
import {
  applyStudyReview,
  materializeStudyCards,
  parseStudyReviewRequest,
  type StudyReviewRequest,
  type StudyReviewResult,
  type StudyServerSnapshot,
} from "./reviewContract";

type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "execute"
>;

/** Requires a real PostgreSQL transaction; review state and its receipt commit together. */
export interface StudyDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

const messages = {
  INVALID_REQUEST: "This study review is invalid and was not saved.",
  NOT_AUTHENTICATED: "Sign in to sync this study review.",
  ACCOUNT_CHANGED:
    "The signed-in account changed. Switch back to sync this review.",
  IDEMPOTENCY_KEY_REUSED:
    "This review identifier belongs to different saved data.",
  RETRYABLE: "Study progress is busy. The saved review will retry.",
  UNAVAILABLE:
    "The review outcome could not be confirmed. The saved review will retry.",
} as const;
type FailureCode = keyof typeof messages;

class StudyFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}
function reject(code: FailureCode): never {
  throw new StudyFailure(code);
}
function canonicalActor(value: unknown): value is string {
  return isUuidV7(value) && value === value.toLowerCase();
}
function requestHash(request: StudyReviewRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(request), "utf8")
    .digest("hex");
}
function failureCode(error: unknown): FailureCode {
  if (error instanceof StudyFailure) return error.code;
  const seen = new Set<unknown>();
  let current = error;
  for (
    let i = 0;
    i < 5 && current && typeof current === "object" && !seen.has(current);
    i++
  ) {
    seen.add(current);
    const row = current as Record<string, unknown>;
    if (["55P03", "40001", "40P01", "57014"].includes(row.code as string))
      return "RETRYABLE";
    current = row.cause;
  }
  return "UNAVAILABLE";
}

async function loadSnapshotByProgressId(
  tx: Transaction,
  actorId: string,
  progressId: string,
): Promise<StudyServerSnapshot> {
  const [progress] = await tx
    .select()
    .from(studyProgress)
    .where(
      and(eq(studyProgress.id, progressId), eq(studyProgress.userId, actorId)),
    );
  if (!progress) reject("UNAVAILABLE");
  const cards = await tx
    .select()
    .from(studyCardStates)
    .where(eq(studyCardStates.progressId, progress.id));
  return {
    ...studyProgressSnapshot(progress, cards),
    version: progress.version,
  };
}

async function listSnapshots(
  tx: Transaction,
  actorId: string,
  setId?: string,
): Promise<StudyServerSnapshot[]> {
  const rows = await tx
    .select()
    .from(studyProgress)
    .where(
      setId
        ? and(eq(studyProgress.userId, actorId), eq(studyProgress.setId, setId))
        : eq(studyProgress.userId, actorId),
    );
  return Promise.all(
    rows.map((row) => loadSnapshotByProgressId(tx, actorId, row.id)),
  );
}

function validLookupSetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("\0") &&
    value.isWellFormed()
  );
}

interface AcceptedReview {
  request: StudyReviewRequest;
  replayed: boolean;
  acceptedVersion: number;
  snapshot: StudyServerSnapshot;
}

/** Creates the authenticated SQL reader/reviewer used by the study route. */
export function createSqlStudyService(
  db: StudyDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: {
    now?: () => Date;
    generateId?: () => string;
    /** Exact current content keys, or null when the set is not available. */
    getCardIds: (setId: string) => readonly string[] | null;
  },
) {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? createUuidV7;

  async function verifiedActor() {
    const actorId = await getVerifiedActorId();
    if (!canonicalActor(actorId)) reject("NOT_AUTHENTICATED");
    return actorId;
  }

  async function recheckActor(actorId: string) {
    const rechecked = await getVerifiedActorId();
    if (!canonicalActor(rechecked)) reject("NOT_AUTHENTICATED");
    if (rechecked !== actorId) reject("ACCOUNT_CHANGED");
  }

  return {
    async list(
      setId?: unknown,
    ): Promise<
      | { ok: true; snapshots: StudyServerSnapshot[] }
      | Extract<StudyReviewResult, { ok: false }>
    > {
      try {
        const actorId = await verifiedActor();
        if (setId !== undefined && !validLookupSetId(setId))
          reject("INVALID_REQUEST");
        const snapshots = await db.transaction(
          async (tx) => listSnapshots(tx, actorId, setId),
          { isolationLevel: "repeatable read", accessMode: "read only" },
        );
        await recheckActor(actorId);
        return { ok: true, snapshots };
      } catch (error) {
        const code = failureCode(error);
        return {
          ok: false,
          code,
          message: messages[code],
          retryable: code === "RETRYABLE" || code === "UNAVAILABLE",
        };
      }
    },

    async review(input: unknown): Promise<StudyReviewResult> {
      try {
        const actorId = await verifiedActor();
        const request = parseStudyReviewRequest(input);
        if (!request) reject("INVALID_REQUEST");
        if (request.expectedActorId !== actorId) reject("ACCOUNT_CHANGED");
        const acceptedAt = now();
        const answeredAt = new Date(request.answeredAtMs);
        if (
          !Number.isFinite(acceptedAt.getTime()) ||
          !Number.isFinite(answeredAt.getTime()) ||
          request.answeredAtMs > acceptedAt.getTime() + 5 * 60_000
        )
          reject("INVALID_REQUEST");
        const cardIds = options.getCardIds(request.setId);
        if (!cardIds?.includes(request.cardId)) reject("INVALID_REQUEST");
        const hash = requestHash(request);
        const accepted = await db.transaction(
          async (tx): Promise<AcceptedReview> => {
            await tx.execute(
              sql`select set_config('lock_timeout', '5000', true)`,
            );
            const [identity] = await tx
              .select({ id: user.id })
              .from(user)
              .where(eq(user.id, actorId))
              .for("key share");
            if (!identity) reject("NOT_AUTHENTICATED");
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`magickli:study:event:v1:${request.eventId}`}, 0))`,
            );
            const [receipt] = await tx
              .select()
              .from(studyReviewReceipts)
              .where(eq(studyReviewReceipts.eventId, request.eventId));
            if (receipt) {
              if (receipt.actorId !== actorId || receipt.requestHash !== hash)
                reject("IDEMPOTENCY_KEY_REUSED");
              return {
                request,
                replayed: true,
                acceptedVersion: receipt.acceptedVersion,
                snapshot: await loadSnapshotByProgressId(
                  tx,
                  actorId,
                  receipt.progressId,
                ),
              };
            }
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`magickli:study:set:v1:${actorId}:${request.setId}`}, 0))`,
            );
            const [stored] = await tx
              .select()
              .from(studyProgress)
              .where(
                and(
                  eq(studyProgress.userId, actorId),
                  eq(studyProgress.setId, request.setId),
                ),
              )
              .for("update");
            const progressId = stored?.id ?? generateId();
            if (!canonicalActor(progressId)) reject("UNAVAILABLE");
            const existing = stored
              ? await loadSnapshotByProgressId(tx, actorId, progressId)
              : ({
                  _id: progressId,
                  userId: actorId,
                  setId: request.setId,
                  correct: 0,
                  incorrect: 0,
                  time: 0,
                  dueDate: answeredAt,
                  version: 0,
                  cards: Object.create(null),
                } satisfies StudyServerSnapshot);
            const materialized = materializeStudyCards(
              existing,
              cardIds,
              request.answeredAtMs,
            );
            const updated = applyStudyReview(materialized, request);
            const acceptedVersion = existing.version + 1;
            if (!Number.isSafeInteger(acceptedVersion)) reject("UNAVAILABLE");
            if (stored) {
              await tx
                .update(studyProgress)
                .set({
                  correct: updated.correct,
                  incorrect: updated.incorrect,
                  time: updated.time,
                  dueDate: updated.dueDate,
                  updatedAt: acceptedAt,
                  version: acceptedVersion,
                })
                .where(eq(studyProgress.id, progressId));
            } else {
              await tx.insert(studyProgress).values({
                id: progressId,
                userId: actorId,
                setId: request.setId,
                correct: updated.correct,
                incorrect: updated.incorrect,
                time: updated.time,
                dueDate: updated.dueDate,
                createdAt: acceptedAt,
                updatedAt: acceptedAt,
                version: acceptedVersion,
              });
            }
            for (const [cardKey, card] of Object.entries(updated.cards)) {
              const cardRow = {
                progressId,
                cardKey,
                correct: card.correct,
                incorrect: card.incorrect,
                time: card.time,
                dueDate: card.dueDate,
                interval: card.supermemo.interval,
                repetition: card.supermemo.repetition,
                efactor: card.supermemo.efactor,
                repetitionPresent: Object.hasOwn(card, "repetition"),
                repetitionWeight:
                  card.repetition && Object.hasOwn(card.repetition, "weight")
                    ? (card.repetition.weight ?? null)
                    : null,
              };
              await tx
                .insert(studyCardStates)
                .values(cardRow)
                .onConflictDoUpdate({
                  target: [studyCardStates.progressId, studyCardStates.cardKey],
                  set: cardRow,
                });
            }
            await tx.insert(studyReviewReceipts).values({
              eventId: request.eventId,
              actorId,
              requestHash: hash,
              progressId,
              acceptedVersion,
              acceptedAt,
            });
            return {
              request,
              replayed: false,
              acceptedVersion,
              snapshot: {
                ...updated,
                _id: progressId,
                userId: actorId,
                version: acceptedVersion,
              },
            };
          },
          { isolationLevel: "read committed", accessMode: "read write" },
        );
        await recheckActor(actorId);
        return {
          ok: true,
          eventId: accepted.request.eventId,
          replayed: accepted.replayed,
          acceptedVersion: accepted.acceptedVersion,
          snapshot: accepted.snapshot,
        };
      } catch (error) {
        const code = failureCode(error);
        return {
          ok: false,
          code,
          message: messages[code],
          retryable: code === "RETRYABLE" || code === "UNAVAILABLE",
        };
      }
    },
  };
}
