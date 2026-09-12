import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgTransactionConfig,
} from "drizzle-orm/pg-core";
import slug from "slug";
import { user } from "../db/schema/auth";
import { templeMemberships, temples } from "../db/schema/memberships";
import { templeCreationReceipts } from "../db/schema/templeCommands";
import { createUuidV7, isUuidV7 } from "../lib/ids";

type Transaction = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "execute"
>;
/** Requires a real PostgreSQL transaction; the HTTP-only query adapter is unsuitable. */
export interface TempleCreationDatabase {
  transaction<T>(
    work: (tx: Transaction) => Promise<T>,
    config?: PgTransactionConfig,
  ): Promise<T>;
}

/** Persist this exact request until its outcome is known; retries keep the operation UUID. */
export interface CreateTempleRequest {
  version: 1;
  operationId: string;
  /** Account-switch precondition only; the verified server session supplies authorship. */
  expectedActorId: string;
  name: string;
}

/** The immutable original result confirms creation, not current admin permissions. */
export interface CreatedTemple {
  templeId: string;
  firstAdminMembershipId: string;
  slug: string;
}

const messages = {
  INVALID_REQUEST:
    "Enter a temple name of 1–200 characters and retry with a valid request.",
  NOT_AUTHENTICATED: "Sign in before creating a temple.",
  ACCOUNT_CHANGED:
    "Your signed-in account changed. Switch back before retrying this request.",
  IDEMPOTENCY_KEY_REUSED:
    "The pending creation request changed. Restore the original request before retrying.",
  SLUG_UNAVAILABLE:
    "This temple address is already in use. Change the name, or join your existing temple.",
  RETRYABLE: "Temple creation is busy. Please retry.",
  UNAVAILABLE:
    "We could not confirm whether the temple was created. Retry to check its status.",
} as const;
type FailureCode = keyof typeof messages;
/** Safe transport-neutral outcome; errors contain no database details or invitation material. */
export type CreateTempleResult =
  | ({ ok: true; replayed: boolean } & CreatedTemple)
  | { ok: false; code: FailureCode; message: string; retryable: boolean };

class CreationFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}
function reject(code: FailureCode): never {
  throw new CreationFailure(code);
}
function canonical(value: unknown): value is string {
  return isUuidV7(value) && value === value.toLowerCase();
}
function parse(input: unknown): CreateTempleRequest {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    reject("INVALID_REQUEST");
  const row = input as Record<string, unknown>;
  if (
    Object.keys(row).length !== 4 ||
    !["version", "operationId", "expectedActorId", "name"].every((key) =>
      Object.hasOwn(row, key),
    ) ||
    row.version !== 1 ||
    !canonical(row.operationId) ||
    !canonical(row.expectedActorId) ||
    typeof row.name !== "string" ||
    row.name.length < 1 ||
    row.name.length > 200 ||
    !row.name.trim() ||
    row.name.includes("\0") ||
    !row.name.isWellFormed()
  )
    reject("INVALID_REQUEST");
  // Preserve the submitted spelling for request identity; only the stored label is trimmed.
  return {
    version: 1,
    operationId: row.operationId,
    expectedActorId: row.expectedActorId,
    name: row.name,
  };
}
function hash(request: CreateTempleRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(request), "utf8")
    .digest("hex");
}
function outcome(
  row: typeof templeCreationReceipts.$inferSelect,
): CreatedTemple {
  return {
    templeId: row.templeId,
    firstAdminMembershipId: row.firstAdminMembershipId,
    slug: row.slug,
  };
}
function failureCode(error: unknown): FailureCode {
  if (error instanceof CreationFailure) return error.code;
  const seen = new Set<unknown>();
  let current = error;
  for (
    let i = 0;
    i < 5 && current && typeof current === "object" && !seen.has(current);
    i++
  ) {
    seen.add(current);
    const row = current as Record<string, unknown>;
    // postgres-js uses constraint_name; PGlite/node-postgres use constraint.
    if (
      row.code === "23505" &&
      (row.constraint_name === "temples_slug_normalized_unique" ||
        row.constraint === "temples_slug_normalized_unique")
    )
      return "SLUG_UNAVAILABLE";
    if (["55P03", "40001", "40P01", "57014"].includes(row.code as string))
      return "RETRYABLE";
    current = row.cause;
  }
  // A lost commit acknowledgement is indistinguishable from many connection failures.
  // Retrying the unchanged operation resolves its receipt without repeating creation.
  return "UNAVAILABLE";
}

/**
 * Any verified existing user may create a temple and its grade-zero first admin.
 * No global/scoped admin prerequisite or invitation is inferred. The callback
 * verifies the current server session; never derive it from command/body claims.
 * New rows and the receipt commit together; a transaction-scoped operation lock
 * serializes duplicate requests before reading the receipt. Replays never restore
 * removed memberships or use the receipt as a current permission grant.
 */
export function createSqlTempleCreator(
  db: TempleCreationDatabase,
  getVerifiedActorId: () => Promise<string | null>,
  options: { now?: () => Date; generateId?: () => string } = {},
) {
  return async (input: unknown): Promise<CreateTempleResult> => {
    try {
      const request = parse(input);
      const verified = await getVerifiedActorId();
      if (!isUuidV7(verified)) reject("NOT_AUTHENTICATED");
      const actorId = verified.toLowerCase();
      if (request.expectedActorId !== actorId) reject("ACCOUNT_CHANGED");
      const requestHash = hash(request);
      return await db.transaction(
        async (tx) => {
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
            sql`select pg_advisory_xact_lock(hashtextextended(${"magickli:create-temple:v1:" + request.operationId}, 0))`,
          );
          const [receipt] = await tx
            .select()
            .from(templeCreationReceipts)
            .where(eq(templeCreationReceipts.operationId, request.operationId));
          if (receipt) {
            if (
              receipt.actorId !== actorId ||
              receipt.requestHash !== requestHash
            )
              reject("IDEMPOTENCY_KEY_REUSED");
            return { ok: true as const, replayed: true, ...outcome(receipt) };
          }
          const name = request.name.trim();
          const templeSlug = slug(name);
          if (
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templeSlug) ||
            templeSlug.length > 200
          )
            reject("INVALID_REQUEST");
          const templeId = (options.generateId ?? createUuidV7)();
          const firstAdminMembershipId = (options.generateId ?? createUuidV7)();
          const createdAt = (options.now ?? (() => new Date()))();
          if (
            !canonical(templeId) ||
            !canonical(firstAdminMembershipId) ||
            !(createdAt instanceof Date) ||
            !Number.isFinite(createdAt.getTime())
          )
            reject("UNAVAILABLE");
          await tx.insert(temples).values({
            id: templeId,
            name,
            slug: templeSlug,
            createdById: actorId,
            createdAt,
            updatedAt: createdAt,
          });
          await tx.insert(templeMemberships).values({
            id: firstAdminMembershipId,
            templeId,
            userId: actorId,
            grade: 0,
            admin: true,
            addedAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          });
          const [saved] = await tx
            .insert(templeCreationReceipts)
            .values({
              operationId: request.operationId,
              actorId,
              requestHash,
              templeId,
              firstAdminMembershipId,
              slug: templeSlug,
              createdAt,
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
