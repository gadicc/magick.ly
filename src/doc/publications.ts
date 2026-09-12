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

/** Preserve the existing admin-group cursor while validating known legacy grants. */
export async function publishRitualCreationGroups(
  db: MongoDatabaseAdapter,
  _opts: unknown,
  props: Pick<Props, "auth">,
) {
  const principal = await loadRitualPrincipal(db, props.auth);
  if (!principal) return [];
  if (principal.globalAdmin) return db.collection("userGroups").find();
  if (!principal.groupAdminIds.length) return [];
  return db.collection("userGroups").find({
    _id: { $in: principal.groupAdminIds.map((id) => new ObjectId(id)) },
  });
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
  return { ...project(row, fields), canEdit: access.edit };
}

/**
 * Return the complete authorized projection. Legacy watermark/sort/limit arguments
 * are deliberately ignored: transaction timestamps can precede another ritual's
 * commit, so a collection watermark would otherwise permanently miss later commits.
 * Real metadata is preserved. An empty response does not clear Gongo's old cache.
 */
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
  return entries.length ? [{ coll: "docs", entries }] : [];
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
  // Detail shares the full-snapshot contract, regardless of legacy cursor arguments.
  return entry ? [{ coll: "docs", entries: [entry] }] : [];
}

/**
 * Return all source history for this exact, currently editable, live parent.
 * Ignore legacy watermark/sort/limit arguments so the current revision remains
 * available beyond Gongo's old 200-row cap and across out-of-order commits.
 */
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
  return entries.length ? [{ coll: "docRevisions", entries }] : [];
}
