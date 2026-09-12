import type {
  PublicationProps,
  PublicationResult,
} from "gongo-server/lib/publications";
import type MongoDatabaseAdapter from "gongo-server-db-mongo";
import { type Document, type Filter, ObjectId } from "mongodb";
import { getRitualAccess, type RitualPrincipal } from "./access";
import {
  legacyRitualId,
  legacyRitualPolicy,
  legacyRitualPrincipal,
} from "./legacyAccess";

type Props = Pick<
  PublicationProps<MongoDatabaseAdapter>,
  "auth" | "updatedAt" | "sort" | "limit" | "lastSortedValue"
>;
type Row = Record<string, unknown>;

/** Match only a known Mongo reference, including legacy hex strings. */
function idFilter(
  field: "_id" | "userId" | "docId",
  id: string,
): Filter<Document> {
  return { [field]: { $in: [new ObjectId(id), new RegExp(`^${id}$`, "i")] } };
}

/** Resolve the authenticated identity and its current grants on every request. */
export async function loadRitualPrincipal(
  db: MongoDatabaseAdapter,
  auth: Pick<Props["auth"], "userId">,
): Promise<RitualPrincipal | null> {
  const userId = legacyRitualId(await auth.userId());
  if (!userId) return null;
  const users = await db
    .collection("users")
    .find({ ...idFilter("_id", userId), __deleted: { $ne: true } })
    .toArray();
  // Ambiguous typed aliases must not select an arbitrary user's grant set.
  if (users.length !== 1) return null;
  const memberships = await db
    .collection("templeMemberships")
    .find({ ...idFilter("userId", userId), __deleted: { $ne: true } })
    .toArray();
  return legacyRitualPrincipal(userId, users[0], memberships);
}

const docFields = [
  "_id",
  "title",
  "doc",
  "userId",
  "groupId",
  "templeId",
  "minGrade",
  "createdAt",
  "updatedAt",
  "__updatedAt",
] as const;
const revisionFields = [
  "_id",
  "docId",
  "userId",
  "text",
  "createdAt",
  "updatedAt",
  "__updatedAt",
] as const;
const references = new Set([
  "_id",
  "userId",
  "groupId",
  "templeId",
  "docId",
  "docRevisionId",
]);

function project(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const field of fields) {
    if (!Object.hasOwn(row, field)) continue;
    if (references.has(field)) {
      const id = legacyRitualId(row[field]);
      if (id) out[field] = new ObjectId(id);
    } else out[field] = row[field];
  }
  return out;
}

function tombstone(row: Row): Row {
  return { ...project(row, ["_id", "__updatedAt"]), __deleted: true };
}

/**
 * Array publications bypass Gongo's cursor helper. Reuse that helper to select
 * IDs with its existing delta/pagination rules, then return only authorized
 * projections. Authorization happens before limits so denied rows cannot crowd
 * out permitted changes. Never synthesize timestamps for permission changes.
 */
async function finish(
  db: MongoDatabaseAdapter,
  coll: string,
  rows: Row[],
  props: Props,
): Promise<PublicationResult> {
  if (!rows.length) return [];
  const ids = rows.flatMap((row) => {
    const id = legacyRitualId(row._id);
    return id ? [new ObjectId(id), new RegExp(`^${id}$`, "i")] : [];
  });
  const cursor = db
    .collection<{ _id: ObjectId | string }>(coll)
    .find({ _id: { $in: ids } })
    .project({ _id: true });
  const selected = await db.publishHelper(
    cursor,
    props as PublicationProps<MongoDatabaseAdapter>,
  );
  const byId = new Map(rows.map((row) => [legacyRitualId(row._id), row]));
  const entries = selected.flatMap((result) =>
    result.entries.flatMap((row) => {
      const entry = byId.get(legacyRitualId(row._id));
      return entry ? [entry] : [];
    }),
  );
  return entries.length ? [{ coll, entries }] : [];
}

function readableDoc(row: Row, principal: RitualPrincipal | null): Row | null {
  const access = getRitualAccess(legacyRitualPolicy(row), principal);
  if (!access.read) return null;
  if (row.__deleted === true) {
    // Legacy remove erases all policy fields. Absence cannot prove public scope.
    // Only tombstones retaining a valid explicit scope can be authorized here.
    if (row.groupId === undefined && row.templeId === undefined) return null;
    return tombstone(row);
  }
  const fields: readonly string[] = access.readSourceHistory
    ? [...docFields, "docRevisionId"]
    : docFields;
  return project(row, fields);
}

/** Publish readable compiled rituals; source and revision payloads stay separate. */
export async function publishRitualDocs(
  db: MongoDatabaseAdapter,
  _opts: unknown,
  props: Props,
): Promise<PublicationResult> {
  const principal = await loadRitualPrincipal(db, props.auth);
  const rows = await db.collection("docs").find({}).toArray();
  const identities = rows.map((row) => legacyRitualId(row._id));
  const entries = rows.flatMap((row) => {
    const id = legacyRitualId(row._id);
    if (!id || identities.filter((candidate) => candidate === id).length !== 1)
      return [];
    const entry = readableDoc(row, principal);
    return entry ? [entry] : [];
  });
  return finish(db, "docs", entries, props);
}

function optionId(opts: unknown, field: "_id" | "docId"): string | null {
  return opts !== null && typeof opts === "object" && !Array.isArray(opts)
    ? legacyRitualId((opts as Row)[field])
    : null;
}

async function parentDoc(
  db: MongoDatabaseAdapter,
  id: string,
): Promise<Row | null> {
  const rows = await db.collection("docs").find(idFilter("_id", id)).toArray();
  return rows.length === 1 ? rows[0] : null;
}

/** Public details work anonymously; private details use the same policy as lists. */
export async function publishRitualDoc(
  db: MongoDatabaseAdapter,
  opts: unknown,
  props: Props,
): Promise<PublicationResult> {
  const id = optionId(opts, "_id");
  if (!id) return [];
  const row = await parentDoc(db, id);
  if (!row) return [];
  const entry = readableDoc(row, await loadRitualPrincipal(db, props.auth));
  // Detail previously returned a full record, regardless of its update watermark.
  return entry ? [{ coll: "docs", entries: [entry] }] : [];
}

/** Source history belongs to this exact, currently editable, live parent. */
export async function publishRitualRevisions(
  db: MongoDatabaseAdapter,
  opts: unknown,
  props: Props,
): Promise<PublicationResult> {
  const id = optionId(opts, "docId");
  if (!id) return [];
  const parent = await parentDoc(db, id);
  if (!parent || parent.__deleted === true) return [];
  const principal = await loadRitualPrincipal(db, props.auth);
  if (!getRitualAccess(legacyRitualPolicy(parent), principal).readSourceHistory)
    return [];
  const rows = await db
    .collection("docRevisions")
    .find(idFilter("docId", id))
    .toArray();
  const entries = rows.flatMap((row) => {
    if (legacyRitualId(row.docId) !== id || !legacyRitualId(row._id)) return [];
    return [
      row.__deleted === true ? tombstone(row) : project(row, revisionFields),
    ];
  });
  return finish(db, "docRevisions", entries, props);
}
