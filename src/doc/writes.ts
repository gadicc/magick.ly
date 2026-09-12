import { createHash } from "node:crypto";
import {
  type ClientSession,
  type Db,
  type Document,
  type Filter,
  type MongoClient,
  ObjectId,
} from "mongodb";
import { isUuidV7 } from "../lib/ids";
import {
  authorizeRevisionInsert,
  authorizeRitualContentUpdate,
  authorizeRitualCreation,
  authorizeRitualPublication,
  getRitualAccess,
  parseRitualScope,
  type RitualPrincipal,
  type RitualScope,
} from "./access";
import {
  legacyRitualId,
  legacyRitualPolicy,
  legacyRitualPrincipal,
} from "./legacyAccess";
import { prepare } from "./prepare";

/** A stable client UUIDv7 is reused until this exact operation has a known result. */
interface RequestBase {
  version: 1;
  operationId: string;
  /** Account-switch precondition only; authorship always comes from server authentication. */
  expectedActorId: string;
}
/** Both tokens protect source and metadata changes; null means absent legacy data. */
interface ExpectedState {
  docId: string;
  expectedRevisionId: string | null;
  expectedUpdatedAt: number | null;
}
export type RitualWriteRequest =
  | (RequestBase &
      ExpectedState & { kind: "save"; source: string; title?: string })
  | (RequestBase & {
      kind: "create";
      scope: RitualScope;
      title: string;
      source: string;
    })
  | (RequestBase & ExpectedState & { kind: "publish" });

/** Safe transport result; errors never echo source, database errors or stack traces. */
export type RitualWriteResult =
  | {
      ok: true;
      docId: string;
      revisionId: string | null;
      updatedAt: number;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "UPGRADE_REQUIRED"
        | "INVALID_REQUEST"
        | "INVALID_SOURCE"
        | "NOT_AUTHENTICATED"
        | "ACCOUNT_CHANGED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_STATE"
        | "CONFLICT"
        | "IDEMPOTENCY_KEY_REUSED"
        | "TRANSACTIONS_REQUIRED"
        | "UNAVAILABLE";
      message: string;
    };

const messages: Record<
  Extract<RitualWriteResult, { ok: false }>["code"],
  string
> = {
  UPGRADE_REQUIRED:
    "Reload the ritual editor before saving. Keep a copy of any pending source edits.",
  INVALID_REQUEST: "The ritual command is invalid or unsupported.",
  INVALID_SOURCE:
    "The ritual source cannot be compiled. Fix the editor errors and retry.",
  NOT_AUTHENTICATED: "Sign in before saving this ritual.",
  ACCOUNT_CHANGED:
    "The signed-in account changed. Switch back to the draft owner before retrying this request.",
  FORBIDDEN: "You do not currently have permission for this ritual command.",
  NOT_FOUND: "The ritual is unavailable.",
  INVALID_STATE:
    "The ritual has inconsistent stored references and needs repair.",
  CONFLICT:
    "The ritual changed since this editor loaded. Keep your source, reload, and merge before saving.",
  IDEMPOTENCY_KEY_REUSED:
    "This request ID was already used for a different operation. Keep the original request unchanged when retrying.",
  TRANSACTIONS_REQUIRED:
    "Ritual writes require a transaction-capable MongoDB deployment. No fallback write was attempted.",
  UNAVAILABLE:
    "The save result could not be confirmed. Keep your source and retry the identical request with the same request ID.",
};

class WriteFailure extends Error {
  constructor(
    readonly code: Extract<RitualWriteResult, { ok: false }>["code"],
  ) {
    super(messages[code]);
  }
}
function fail(code: WriteFailure["code"]): never {
  throw new WriteFailure(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parse(input: unknown): RitualWriteRequest {
  if (!record(input) || input.version !== 1) fail("UPGRADE_REQUIRED");
  const allowed = [
    "version",
    "operationId",
    "expectedActorId",
    "kind",
    ...(input.kind === "create"
      ? ["scope", "title", "source"]
      : [
          "docId",
          "expectedRevisionId",
          "expectedUpdatedAt",
          ...(input.kind === "save" ? ["source", "title"] : []),
        ]),
  ];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    typeof input.operationId !== "string" ||
    !isUuidV7(input.operationId) ||
    typeof input.expectedActorId !== "string" ||
    !legacyRitualId(input.expectedActorId)
  )
    fail("INVALID_REQUEST");
  const base = {
    version: 1 as const,
    operationId: input.operationId.toLowerCase(),
    expectedActorId: legacyRitualId(input.expectedActorId) as string,
  };
  if (
    input.kind !== "save" &&
    input.kind !== "create" &&
    input.kind !== "publish"
  )
    fail("INVALID_REQUEST");
  if (input.kind === "save" || input.kind === "create") {
    if (
      typeof input.source !== "string" ||
      (input.kind === "save" && !input.source.length) ||
      Buffer.byteLength(input.source, "utf8") > 1024 * 1024
    )
      fail("INVALID_REQUEST");
    if (
      input.title !== undefined &&
      (typeof input.title !== "string" || input.title.length > 500)
    )
      fail("INVALID_REQUEST");
  }
  if (input.kind === "create") {
    const scope = parseRitualScope(input.scope);
    if (!scope || typeof input.title !== "string" || !input.title.trim())
      fail("INVALID_REQUEST");
    if (scope.kind === "group") {
      const id = legacyRitualId(scope.groupId);
      if (!id) fail("INVALID_REQUEST");
      scope.groupId = id;
    }
    if (scope.kind === "temple") {
      const id = legacyRitualId(scope.templeId);
      if (!id) fail("INVALID_REQUEST");
      scope.templeId = id;
    }
    return {
      ...base,
      kind: "create",
      scope,
      title: input.title,
      source: input.source as string,
    };
  }
  const docId = legacyRitualId(input.docId);
  const expectedRevisionId =
    input.expectedRevisionId === null
      ? null
      : legacyRitualId(input.expectedRevisionId);
  if (
    !docId ||
    (input.expectedRevisionId !== null && !expectedRevisionId) ||
    (input.expectedUpdatedAt !== null && !timestamp(input.expectedUpdatedAt))
  )
    fail("INVALID_REQUEST");
  const state = {
    docId,
    expectedRevisionId,
    expectedUpdatedAt: input.expectedUpdatedAt as number | null,
  };
  return input.kind === "publish"
    ? { ...base, ...state, kind: "publish" }
    : {
        ...base,
        ...state,
        kind: "save",
        source: input.source as string,
        ...(input.title === undefined ? {} : { title: input.title as string }),
      };
}

function reference(field: string, id: string): Filter<Document> {
  return { [field]: { $in: [new ObjectId(id), new RegExp(`^${id}$`, "i")] } };
}
async function one(
  db: Db,
  coll: string,
  id: string,
  session: ClientSession,
): Promise<Document | null> {
  const rows = await db
    .collection(coll)
    .find(reference("_id", id), { session })
    .limit(2)
    .toArray();
  if (rows.length > 1) fail("INVALID_STATE");
  return rows[0] ?? null;
}
async function principal(
  db: Db,
  actor: string,
  session: ClientSession,
): Promise<RitualPrincipal> {
  const user = await one(db, "users", actor, session);
  if (!user || user.__deleted) fail("NOT_AUTHENTICATED");
  const memberships = await db
    .collection("templeMemberships")
    .find(
      { ...reference("userId", actor), __deleted: { $ne: true } },
      { session },
    )
    .toArray();
  const result = legacyRitualPrincipal(actor, user, memberships);
  if (!result) fail("NOT_AUTHENTICATED");
  return result;
}
function currentRevision(row: Document): string | null {
  if (row.docRevisionId === undefined || row.docRevisionId === null)
    return null;
  return legacyRitualId(row.docRevisionId) ?? fail("INVALID_STATE");
}
function currentUpdatedAt(row: Document): number | null {
  if (row.__updatedAt === undefined || row.__updatedAt === null) return null;
  return timestamp(row.__updatedAt) ? row.__updatedAt : fail("INVALID_STATE");
}
function expected(row: Document, command: ExpectedState) {
  if (
    currentRevision(row) !== command.expectedRevisionId ||
    currentUpdatedAt(row) !== command.expectedUpdatedAt
  )
    fail("CONFLICT");
}
function exactField(row: Document, key: string): unknown {
  if (!Object.hasOwn(row, key)) return { $exists: false };
  return row[key] === null ? { $eq: null, $exists: true } : row[key];
}
function cas(row: Document): Filter<Document> {
  // Exact persisted types distinguish missing/string/ObjectId references; no upsert.
  return {
    _id: row._id,
    docRevisionId: exactField(row, "docRevisionId"),
    __updatedAt: exactField(row, "__updatedAt"),
    __deleted: { $ne: true },
  };
}
function compile(source: string): unknown {
  try {
    return prepare(source);
  } catch {
    return fail("INVALID_SOURCE");
  }
}

/**
 * Temporary Mongo implementation of the command boundary. Every source revision,
 * derived document update and idempotency receipt commits in the same transaction.
 * No fallback runs on standalone Mongo. Future Neon code can retain this wire API.
 */
export async function writeRitual(
  { client, db }: { client: MongoClient; db: Db },
  authenticatedUserId: unknown,
  input: unknown,
): Promise<RitualWriteResult> {
  try {
    const actor = legacyRitualId(authenticatedUserId);
    if (!actor) fail("NOT_AUTHENTICATED");
    const command = parse(input);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    // ObjectIds remain a temporary legacy/Gongo constraint; request IDs are UUIDv7.
    const newDocId = new ObjectId();
    const newRevisionId = new ObjectId();
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = client.startSession();
      try {
        return await session.withTransaction(
          async () => {
            const who = await principal(db, actor, session);
            if (command.expectedActorId !== who.userId) fail("ACCOUNT_CHANGED");
            const receipts = db.collection<Document & { _id: string }>(
              "ritualWriteReceipts",
            );
            const receipt = await receipts.findOne(
              { _id: command.operationId },
              { session },
            );
            if (receipt) {
              if (
                legacyRitualId(receipt.userId) !== actor ||
                receipt.requestHash !== requestHash
              )
                fail("IDEMPOTENCY_KEY_REUSED");
              const replayId = legacyRitualId(receipt.result?.docId);
              if (!replayId) fail("INVALID_STATE");
              const parent = await one(db, "docs", replayId, session);
              if (
                !parent ||
                parent.__deleted ||
                !getRitualAccess(legacyRitualPolicy(parent), who).edit ||
                (command.kind === "publish" && !who.globalAdmin)
              )
                fail("FORBIDDEN");
              return { ...receipt.result, replayed: true } as Extract<
                RitualWriteResult,
                { ok: true }
              >;
            }
            let parent: Document;
            let policy;
            if (command.kind === "create") {
              policy = {
                id: newDocId.toHexString(),
                creatorId: actor,
                scope: command.scope,
              };
              if (!authorizeRitualCreation(policy, who).allowed)
                fail("FORBIDDEN");
              if (command.scope.kind !== "public") {
                const scope = command.scope;
                const target = await one(
                  db,
                  scope.kind === "group" ? "userGroups" : "temples",
                  scope.kind === "group" ? scope.groupId : scope.templeId,
                  session,
                );
                if (!target || target.__deleted) fail("FORBIDDEN");
              }
              parent = {
                _id: newDocId,
                userId: new ObjectId(actor),
                title: command.title,
              };
              if (command.scope.kind === "group")
                parent.groupId = new ObjectId(command.scope.groupId);
              if (command.scope.kind === "temple") {
                parent.templeId = new ObjectId(command.scope.templeId);
                parent.minGrade = command.scope.minGrade;
              }
            } else {
              const existing = await one(db, "docs", command.docId, session);
              if (!existing || existing.__deleted) fail("NOT_FOUND");
              parent = existing;
              policy = legacyRitualPolicy(parent);
              if (!getRitualAccess(policy, who).edit) fail("FORBIDDEN");
              if (command.kind === "publish") {
                if (
                  !policy ||
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
              expected(parent, command);
              const revisionId = currentRevision(parent);
              if (revisionId) {
                const revision = await one(
                  db,
                  "docRevisions",
                  revisionId,
                  session,
                );
                if (
                  !revision ||
                  revision.__deleted ||
                  legacyRitualId(revision.docId) !== policy?.id
                )
                  fail("INVALID_STATE");
              }
            }
            const at = Math.max(
              Date.now(),
              (currentUpdatedAt(parent) ?? 0) + 1,
            );
            const date = new Date(at);
            let revisionId = currentRevision(parent);
            if (command.kind === "publish") {
              const result = await db.collection("docs").updateOne(
                cas(parent),
                {
                  $unset: { groupId: "", templeId: "", minGrade: "" },
                  $set: { updatedAt: date, __updatedAt: at },
                },
                { session },
              );
              if (result.matchedCount !== 1) fail("CONFLICT");
            } else {
              const compiled = compile(command.source);
              revisionId = newRevisionId.toHexString();
              if (
                !policy ||
                !authorizeRevisionInsert(
                  policy,
                  {
                    id: revisionId,
                    ritualId: policy.id,
                    authorId: actor,
                    createdAt: at,
                  },
                  who,
                ).allowed
              )
                fail("FORBIDDEN");
              await db.collection("docRevisions").insertOne(
                {
                  _id: newRevisionId,
                  docId: new ObjectId(policy.id),
                  userId: new ObjectId(actor),
                  text: command.source,
                  createdAt: date,
                  updatedAt: date,
                  __updatedAt: at,
                },
                { session },
              );
              const content = {
                doc: compiled,
                docRevisionId: newRevisionId,
                updatedAt: date,
                __updatedAt: at,
                ...(command.title === undefined
                  ? {}
                  : { title: command.title }),
              };
              if (command.kind === "create")
                await db
                  .collection("docs")
                  .insertOne(
                    { ...parent, ...content, createdAt: date },
                    { session },
                  );
              else {
                const result = await db
                  .collection("docs")
                  .updateOne(cas(parent), { $set: content }, { session });
                if (result.matchedCount !== 1) fail("CONFLICT");
              }
            }
            const result: Extract<RitualWriteResult, { ok: true }> = {
              ok: true,
              docId: legacyRitualId(parent._id) as string,
              revisionId,
              updatedAt: at,
              replayed: false,
            };
            await receipts.insertOne(
              {
                _id: command.operationId,
                userId: new ObjectId(actor),
                requestHash,
                result,
                createdAt: date,
              },
              { session },
            );
            return result;
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            readPreference: "primary",
          },
        );
      } catch (error) {
        // Concurrent create retries can collide only on the receipt's unique _id.
        // Re-enter a fresh transaction to resolve the winning receipt once.
        if (attempt === 0 && record(error) && error.code === 11000) continue;
        throw error;
      } finally {
        await session.endSession();
      }
    }
    return fail("UNAVAILABLE");
  } catch (error) {
    const code =
      error instanceof WriteFailure
        ? error.code
        : record(error) && (error.code === 20 || error.code === 303)
          ? "TRANSACTIONS_REQUIRED"
          : "UNAVAILABLE";
    return { ok: false, code, message: messages[code] };
  }
}

/** Rejects stale/offline generic changes without discarding their client-side source. */
export async function rejectLegacyRitualMutation(): Promise<string> {
  return `RITUAL_EDITOR_UPGRADE_REQUIRED: ${messages.UPGRADE_REQUIRED}`;
}
