import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import { temples, userGroups } from "../db/schema/memberships";
import { ritualWriteReceipts } from "../db/schema/ritualCommands";
import {
  ritualCompiledArtifacts,
  ritualRevisions,
  rituals,
} from "../db/schema/rituals";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  authorizeRevisionInsert,
  authorizeRitualContentUpdate,
  authorizeRitualCreation,
  authorizeRitualPublication,
  getRitualAccess,
  parseRitualScope,
  type RitualPolicy,
} from "./access";
import { compileRitualSource } from "./compileContract";
import {
  loadSqlRitualPrincipal,
  type SqlRitualParentRow,
  sqlRitualParentFields,
  sqlRitualPolicy,
} from "./sqlPolicy";

import {
  type SqlRitualExpectedState as Expected,
  type SqlRitualWriteFailureCode as FailureCode,
  SQL_RITUAL_WRITE_MESSAGES as messages,
  type SqlRitualWriteOutcome,
  type SqlRitualWriteRequest,
  type SqlRitualWriteResult,
} from "./sqlWriteContract";

export type {
  SqlRitualWriteRequest,
  SqlRitualWriteResult,
} from "./sqlWriteContract";

type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "execute"
>;
/** Real transaction-capable server database; no HTTP query adapter or fallback writes. */
export interface SqlRitualWriteDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}
class WriteFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}
function fail(code: FailureCode): never {
  throw new WriteFailure(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown): value is string {
  return isUuidV7(value) && value === value.toLowerCase();
}
function safeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}
function sqlText(value: unknown): value is string {
  return (
    typeof value === "string" && !value.includes("\0") && value.isWellFormed()
  );
}
function parse(input: unknown): SqlRitualWriteRequest {
  if (!record(input) || input.version !== 2) fail("UPGRADE_REQUIRED");
  if (!["save", "create", "publish"].includes(input.kind as string))
    fail("INVALID_REQUEST");
  const fields = [
    "version",
    "operationId",
    "expectedActorId",
    "kind",
    ...(input.kind === "create"
      ? ["scope", "title", "source"]
      : [
          "ritualId",
          "expectedRevisionId",
          "expectedVersion",
          ...(input.kind === "save" ? ["source", "title"] : []),
        ]),
  ];
  if (
    Object.keys(input).some((key) => !fields.includes(key)) ||
    fields.some(
      (key) =>
        !(input.kind === "save" && key === "title") &&
        !Object.hasOwn(input, key),
    ) ||
    !canonical(input.operationId) ||
    !canonical(input.expectedActorId)
  )
    fail("INVALID_REQUEST");
  const base = {
    version: 2 as const,
    operationId: input.operationId,
    expectedActorId: input.expectedActorId,
  };
  if (input.kind !== "publish") {
    if (
      !sqlText(input.source) ||
      (input.kind === "save" && !input.source.length) ||
      Buffer.byteLength(input.source, "utf8") > 1024 * 1024
    )
      fail("INVALID_REQUEST");
    if (
      Object.hasOwn(input, "title") &&
      (!sqlText(input.title) || input.title.length > 500)
    )
      fail("INVALID_REQUEST");
  }
  if (input.kind === "create") {
    const scope = parseRitualScope(input.scope);
    if (!scope || !sqlText(input.title) || !input.title.trim())
      fail("INVALID_REQUEST");
    if (scope.kind === "group" && !canonical(scope.groupId))
      fail("INVALID_REQUEST");
    if (
      scope.kind === "temple" &&
      (!canonical(scope.templeId) || !safeInteger(scope.minGrade))
    )
      fail("INVALID_REQUEST");
    return {
      ...base,
      kind: "create",
      scope,
      title: input.title,
      source: input.source as string,
    };
  }
  if (
    !canonical(input.ritualId) ||
    !canonical(input.expectedRevisionId) ||
    !safeInteger(input.expectedVersion)
  )
    fail("INVALID_REQUEST");
  const expected = {
    ritualId: input.ritualId,
    expectedRevisionId: input.expectedRevisionId,
    expectedVersion: input.expectedVersion,
  };
  return input.kind === "publish"
    ? { ...base, ...expected, kind: "publish" }
    : {
        ...base,
        ...expected,
        kind: "save",
        source: input.source as string,
        ...(Object.hasOwn(input, "title")
          ? { title: input.title as string }
          : {}),
      };
}
function failureCode(error: unknown): FailureCode {
  if (error instanceof WriteFailure) return error.code;
  const seen = new Set<unknown>();
  let current = error;
  for (
    let depth = 0;
    depth < 5 && record(current) && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    if (["55P03", "40001", "40P01", "57014"].includes(current.code as string))
      return "RETRYABLE";
    current = current.cause;
  }
  return "UNAVAILABLE";
}
function outcome(
  row: typeof ritualWriteReceipts.$inferSelect,
): SqlRitualWriteOutcome {
  return {
    ritualId: row.ritualId,
    revisionId: row.revisionId,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function parent(tx: Transaction, id: string) {
  const [row] = await tx
    .select(sqlRitualParentFields)
    .from(rituals)
    .where(eq(rituals.id, id))
    .for("update");
  return row ?? null;
}
function expected(row: SqlRitualParentRow, request: Expected) {
  if (!row.currentRevisionId) fail("INVALID_STATE");
  if (
    row.currentRevisionId !== request.expectedRevisionId ||
    row.version !== request.expectedVersion
  )
    fail("CONFLICT");
  if (row.version === Number.MAX_SAFE_INTEGER) fail("INVALID_STATE");
}

/**
 * Canonical SQL-v2 writes only; no route or legacy retry rejection is activated.
 * The operation lock precedes receipt reads under READ COMMITTED, so a waiter sees
 * a just-committed receipt. Current grants are share-locked and the parent is
 * update-locked through commit. A revocation committed first is observed; one
 * waiting behind an accepted write takes effect afterward. Replay rechecks current
 * edit/publication authority and never treats the old receipt as a permission grant.
 * Every save appends source+artifact; parent CAS and the immutable receipt commit
 * atomically. Unknown commit outcomes are resolved only by identical-operation retry.
 */
export function createSqlRitualWriter(
  db: SqlRitualWriteDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { now?: () => Date; generateId?: () => string } = {},
) {
  return async (input: unknown): Promise<SqlRitualWriteResult> => {
    try {
      const request = parse(input);
      const verified = await getVerifiedActorId();
      if (!isUuidV7(verified)) fail("NOT_AUTHENTICATED");
      const actorId = verified.toLowerCase();
      if (actorId !== request.expectedActorId) fail("ACCOUNT_CHANGED");
      const requestHash = createHash("sha256")
        .update(JSON.stringify(request), "utf8")
        .digest("hex");
      return await db.transaction(
        async (tx) => {
          await tx.execute(
            sql`select set_config('lock_timeout', '5000', true)`,
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${"magickli:ritual-write:v2:" + request.operationId},0))`,
          );
          const who = await loadSqlRitualPrincipal(tx, actorId, true);
          if (!who) fail("NOT_AUTHENTICATED");
          const [receipt] = await tx
            .select()
            .from(ritualWriteReceipts)
            .where(eq(ritualWriteReceipts.operationId, request.operationId));
          if (receipt) {
            if (
              receipt.actorId !== actorId ||
              receipt.requestHash !== requestHash
            )
              fail("IDEMPOTENCY_KEY_REUSED");
            const current = await parent(tx, receipt.ritualId);
            if (
              !current ||
              !getRitualAccess(sqlRitualPolicy(current), who).edit ||
              (request.kind === "publish" && !who.globalAdmin)
            )
              fail("FORBIDDEN");
            return { ok: true as const, replayed: true, ...outcome(receipt) };
          }
          let current: SqlRitualParentRow | null = null;
          const generateId = () => {
            const id = (options.generateId ?? createUuidV7)();
            if (!canonical(id)) fail("UNAVAILABLE");
            return id;
          };
          const ritualId =
            request.kind === "create" ? generateId() : request.ritualId;
          let policy: RitualPolicy | null;
          if (request.kind === "create") {
            policy = { id: ritualId, creatorId: actorId, scope: request.scope };
          } else {
            current = await parent(tx, ritualId);
            if (!current) fail("NOT_FOUND");
            policy = sqlRitualPolicy(current);
          }
          if (request.kind === "create") {
            if (!authorizeRitualCreation(policy, who).allowed)
              fail("FORBIDDEN");
            if (request.scope.kind !== "public") {
              const scope = request.scope;
              const targets =
                scope.kind === "group"
                  ? await tx
                      .select({ id: userGroups.id })
                      .from(userGroups)
                      .where(eq(userGroups.id, scope.groupId))
                      .for("key share")
                  : await tx
                      .select({ id: temples.id })
                      .from(temples)
                      .where(eq(temples.id, scope.templeId))
                      .for("key share");
              if (!targets.length) fail("FORBIDDEN");
            }
          } else {
            if (!policy || !getRitualAccess(policy, who).edit)
              fail("FORBIDDEN");
            if (request.kind === "publish") {
              if (
                !authorizeRitualPublication(
                  policy,
                  { ...policy, scope: { kind: "public" } },
                  who,
                ).allowed
              )
                fail("FORBIDDEN");
            } else if (
              !authorizeRitualContentUpdate(policy, policy, who).allowed
            )
              fail("FORBIDDEN");
            expected(current!, request);
          }
          const now = (options.now ?? (() => new Date()))();
          if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
            fail("UNAVAILABLE");
          const version = (current?.version ?? 0) + 1;
          let revisionId = current?.currentRevisionId;
          let artifactId = current?.currentCompiledArtifactId;
          if (request.kind !== "publish") {
            const compiled = compileRitualSource(request.source);
            if (!compiled) fail("INVALID_SOURCE");
            revisionId = generateId();
            artifactId = generateId();
            if (
              !authorizeRevisionInsert(
                policy,
                {
                  id: revisionId,
                  ritualId,
                  authorId: actorId,
                  createdAt: now.getTime(),
                },
                who,
              ).allowed
            )
              fail("FORBIDDEN");
            if (request.kind === "create") {
              const scope = request.scope;
              await tx.insert(rituals).values({
                id: ritualId,
                title: request.title,
                creatorId: actorId,
                scope: scope.kind,
                groupId: scope.kind === "group" ? scope.groupId : null,
                templeId: scope.kind === "temple" ? scope.templeId : null,
                minGrade: scope.kind === "temple" ? scope.minGrade : null,
                createdAt: now,
                updatedAt: now,
              });
            }
            await tx.insert(ritualRevisions).values({
              id: revisionId,
              ritualId,
              authorId: actorId,
              source: request.source,
              sourceSha256: compiled.sourceSha256,
              sourceFormat: compiled.sourceFormat,
              sourceFormatVersion: compiled.sourceFormatVersion,
              createdAt: now,
              updatedAt: now,
            });
            await tx.insert(ritualCompiledArtifacts).values({
              id: artifactId,
              revisionId,
              sourceSha256: compiled.sourceSha256,
              compilerVersion: compiled.compilerVersion,
              outputFormat: compiled.outputFormat,
              outputFormatVersion: compiled.outputFormatVersion,
              transformations: compiled.transformations,
              contentJson: compiled.contentJson,
              contentSha256: compiled.contentSha256,
              compiledAt: now,
            });
          }
          if (!revisionId) fail("INVALID_STATE");
          const condition =
            request.kind === "create"
              ? eq(rituals.id, ritualId)
              : and(
                  eq(rituals.id, ritualId),
                  eq(rituals.currentRevisionId, request.expectedRevisionId),
                  eq(rituals.version, request.expectedVersion),
                );
          const updated = await tx
            .update(rituals)
            .set({
              currentRevisionId: revisionId,
              currentCompiledArtifactId: artifactId ?? null,
              version,
              updatedAt: now,
              ...(request.kind === "publish"
                ? {
                    scope: "public" as const,
                    groupId: null,
                    templeId: null,
                    minGrade: null,
                  }
                : request.title === undefined
                  ? {}
                  : { title: request.title }),
            })
            .where(condition)
            .returning({ id: rituals.id });
          if (updated.length !== 1) fail("CONFLICT");
          const [saved] = await tx
            .insert(ritualWriteReceipts)
            .values({
              operationId: request.operationId,
              actorId,
              requestHash,
              kind: request.kind,
              ritualId,
              revisionId,
              version,
              updatedAt: now,
            })
            .returning();
          return { ok: true as const, replayed: false, ...outcome(saved) };
        },
        { isolationLevel: "read committed", accessMode: "read write" },
      );
    } catch (error) {
      const code = failureCode(error);
      return {
        ok: false,
        code,
        message: messages[code],
        retryable: code === "RETRYABLE" || code === "UNAVAILABLE",
      };
    }
  };
}
