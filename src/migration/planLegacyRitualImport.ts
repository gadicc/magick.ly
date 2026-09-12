import { createHash } from "node:crypto";
import type { LegacyAliasKey } from "../db/legacyIds";
import type * as schema from "../db/schema/rituals";
import { isUuidV7 } from "../lib/ids";

type Row = Record<string, unknown>;
type Identified<T> = T & { id: string };
type ReferenceEvidence = {
  field: string;
  source: LegacyAliasKey;
  canonicalId: string | null;
};
/** Protected ledger material, not a client projection or log-safe report. */
export interface RitualSourceEvidence {
  source: LegacyAliasKey;
  presentFields: string[];
  references: ReferenceEvidence[];
  transformations: string[];
  /** Exact serialized irrelevant legacy value, including absent-versus-present evidence. */
  ignoredMinGradeJson?: string;
}
/** Decoded BSON only. No compiler, DB connection or allocator is called by the planner. */
export interface LegacyRitualInput {
  rituals: readonly unknown[];
  revisions: readonly unknown[];
}
/** Dependency-ordered insert plan. Final pointers and shells belong in one transaction. */
export interface LegacyRitualImportPlan {
  rituals: Identified<typeof schema.rituals.$inferInsert>[];
  revisions: Identified<typeof schema.ritualRevisions.$inferInsert>[];
  archives: (typeof schema.legacyRitualCompiledArchives.$inferInsert)[];
  currentRevisions: { ritualId: string; revisionId: string }[];
  aliases: { source: LegacyAliasKey; canonicalId: string }[];
  evidence: RitualSourceEvidence[];
  /** Every archived snapshot still requires a deliberate source-versus-compiled comparison. */
  parityRequired: string[];
}
/** Messages contain only categories and input positions, never source text or identifiers. */
export class LegacyRitualImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyRitualImportError";
  }
}
const hex = /^[0-9a-f]{24}$/i;
const sourceKey = (ref: LegacyAliasKey) =>
  JSON.stringify([
    ref.sourceSystem,
    ref.entityType,
    ref.legacyIdType,
    ref.legacyIdValue,
  ]);
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
function fail(code: string, path: string): never {
  throw new LegacyRitualImportError(code, path);
}
function row(value: unknown, path: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("invalid-object", path);
  return value as Row;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail("invalid-text", path);
  // PostgreSQL UTF-8 text cannot preserve NUL or lone UTF-16 surrogates.
  if (value.includes("\0") || !value.isWellFormed())
    fail("unrepresentable-text", path);
  return value;
}
function date(value: unknown, path: string, required = false): Date | null {
  if (value === undefined || value === null) {
    if (required) fail("missing-date", path);
    return null;
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    fail("invalid-date", path);
  return new Date(value.getTime());
}
function sync(value: unknown, path: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail("invalid-sync-timestamp", path);
  return value;
}
function reference(
  entityType: string,
  value: unknown,
  path: string,
): LegacyAliasKey {
  if (typeof value === "string" && value) {
    text(value, path);
    return {
      sourceSystem: "mongodb",
      entityType,
      legacyIdType: "string",
      legacyIdValue: value,
    };
  }
  const obj = row(value, path);
  if (obj._bsontype !== "ObjectId" || typeof obj.toHexString !== "function")
    fail("invalid-source-id", path);
  let id: unknown;
  try {
    id = obj.toHexString();
  } catch {
    fail("invalid-source-id", path);
  }
  if (typeof id !== "string" || !hex.test(id)) fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: "objectid",
    legacyIdValue: id.toLowerCase(),
  };
}
function checkedReference(
  value: LegacyAliasKey,
  entity: string,
  path: string,
): LegacyAliasKey {
  if (
    !value ||
    value.sourceSystem !== "mongodb" ||
    value.entityType !== entity ||
    !["string", "objectid"].includes(value.legacyIdType) ||
    typeof value.legacyIdValue !== "string" ||
    !value.legacyIdValue ||
    (value.legacyIdType === "objectid" &&
      !/^[0-9a-f]{24}$/.test(value.legacyIdValue))
  )
    fail("invalid-declared-reference", path);
  return { ...value };
}
function json(value: unknown, path: string): string {
  const ancestors = new Set<object>();
  function validate(item: unknown): void {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (
      typeof item === "number" &&
      Number.isFinite(item) &&
      !Object.is(item, -0)
    )
      return;
    if (!item || typeof item !== "object" || ancestors.has(item))
      fail("non-json-content", path);
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      fail("non-json-content", path);
    if (Object.getOwnPropertySymbols(item).length)
      fail("non-json-content", path);
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length)
        fail("non-json-content", path);
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) fail("non-json-content", path);
        validate(item[i]);
      }
    } else {
      for (const itemValue of Object.values(item)) validate(itemValue);
    }
    ancestors.delete(item);
  }
  validate(value);
  return JSON.stringify(value);
}

/**
 * Applies only the documented docRevisionId string/ObjectId reconciliation.
 * All other references need durable typed aliases. Unexpected orphans, dropped
 * fields or uncertain current pointers fail; no history or compilation is invented.
 */
export function planLegacyRitualImport(
  input: LegacyRitualInput,
  options: {
    lookup: (source: LegacyAliasKey) => string | null;
    canonicalUserIds: readonly string[];
    canonicalGroupIds: readonly string[];
    canonicalTempleIds: readonly string[];
    importedAt: Date;
    /** Exact reviewed exceptions; each declaration must be consumed and still unresolved. */
    unresolvedCreators: readonly {
      ritual: LegacyAliasKey;
      creator: LegacyAliasKey;
    }[];
  },
): LegacyRitualImportPlan {
  row(input, "input");
  row(options, "options");
  if (!Array.isArray(input.rituals) || !Array.isArray(input.revisions))
    fail("invalid-input-arrays", "input");
  if (
    typeof options.lookup !== "function" ||
    !Array.isArray(options.canonicalUserIds) ||
    !Array.isArray(options.canonicalGroupIds) ||
    !Array.isArray(options.canonicalTempleIds) ||
    !Array.isArray(options.unresolvedCreators)
  )
    fail("invalid-options", "options");
  const importedAt = date(
    options.importedAt,
    "options.importedAt",
    true,
  ) as Date;
  const occupied = new Set<string>();
  function canonicalSet(ids: readonly string[], path: string) {
    const set = new Set<string>();
    for (const value of ids) {
      if (!isUuidV7(value)) fail("invalid-canonical-set", path);
      const id = value.toLowerCase();
      if (occupied.has(id)) fail("duplicate-canonical-identity", path);
      occupied.add(id);
      set.add(id);
    }
    return set;
  }
  const users = canonicalSet(
    options.canonicalUserIds,
    "options.canonicalUserIds",
  );
  const groups = canonicalSet(
    options.canonicalGroupIds,
    "options.canonicalGroupIds",
  );
  const temples = canonicalSet(
    options.canonicalTempleIds,
    "options.canonicalTempleIds",
  );
  const orphanDeclarations = new Map<string, string>();
  options.unresolvedCreators.forEach((entry, i) => {
    const location = `options.unresolvedCreators[${i}]`;
    row(entry, location);
    const key = sourceKey(checkedReference(entry.ritual, "docs", location));
    const creator = sourceKey(
      checkedReference(entry.creator, "users", location),
    );
    if (orphanDeclarations.has(key))
      fail("duplicate-orphan-declaration", location);
    orphanDeclarations.set(key, creator);
  });
  const aliases = new Map<
    string,
    { source: LegacyAliasKey; canonicalId: string }
  >();
  const plan: LegacyRitualImportPlan = {
    rituals: [],
    revisions: [],
    archives: [],
    currentRevisions: [],
    aliases: [],
    evidence: [],
    parityRequired: [],
  };
  function lookup(ref: LegacyAliasKey, path: string): string | null {
    const value = options.lookup(ref);
    if (value === null) return null;
    if (!isUuidV7(value)) fail("invalid-canonical-alias", path);
    return value.toLowerCase();
  }
  function addAlias(ref: LegacyAliasKey, id: string, path: string) {
    const prior = lookup(ref, path) ?? aliases.get(sourceKey(ref))?.canonicalId;
    if (prior && prior !== id) fail("alias-conflict", path);
    aliases.set(sourceKey(ref), { source: { ...ref }, canonicalId: id });
  }
  function identities(
    values: readonly unknown[],
    entity: string,
    path: string,
    allowed: readonly string[],
  ) {
    const bySource = new Map<string, string>();
    const entries = values.map((value, i) => {
      const location = `${path}[${i}]`;
      const document = row(value, location);
      if (Object.keys(document).some((key) => !allowed.includes(key)))
        fail("unclassified-fields", location);
      const source = reference(entity, document._id, `${location}._id`);
      const id = lookup(source, `${location}._id`);
      if (!id) fail("missing-canonical-alias", location);
      if (occupied.has(id) || bySource.has(sourceKey(source)))
        fail("duplicate-canonical-identity", location);
      occupied.add(id);
      bySource.set(sourceKey(source), id);
      addAlias(source, id, location);
      const evidence: RitualSourceEvidence = {
        source,
        presentFields: Object.keys(document).sort(),
        references: [],
        transformations: [],
      };
      plan.evidence.push(evidence);
      return { document, source, id, location, evidence };
    });
    return {
      entries,
      bySource,
      ids: new Set(entries.map((entry) => entry.id)),
    };
  }
  const rituals = identities(input.rituals, "docs", "rituals", [
    "_id",
    "title",
    "userId",
    "groupId",
    "templeId",
    "minGrade",
    "createdAt",
    "updatedAt",
    "__updatedAt",
    "docRevisionId",
    "doc",
  ]);
  const revisions = identities(input.revisions, "docRevisions", "revisions", [
    "_id",
    "docId",
    "userId",
    "text",
    "createdAt",
    "updatedAt",
    "__updatedAt",
  ]);
  function resolve(
    value: unknown,
    entity: string,
    targets: Set<string>,
    path: string,
    evidence: RitualSourceEvidence,
    field: string,
  ) {
    const ref = reference(entity, value, path);
    const id = lookup(ref, path);
    if (!id || !targets.has(id)) fail("unresolved-reference", path);
    addAlias(ref, id, path);
    evidence.references.push({ field, source: ref, canonicalId: id });
    return id;
  }
  for (const { document, id, location, evidence } of revisions.entries) {
    const source = text(document.text, `${location}.text`);
    plan.revisions.push({
      id,
      ritualId: resolve(
        document.docId,
        "docs",
        rituals.ids,
        `${location}.docId`,
        evidence,
        "docId",
      ),
      authorId: resolve(
        document.userId,
        "users",
        users,
        `${location}.userId`,
        evidence,
        "userId",
      ),
      source,
      sourceSha256: hash(source),
      sourceFormat: "magickli-pug-shortcuts",
      sourceFormatVersion: "legacy-unversioned",
      createdAt: date(
        document.createdAt,
        `${location}.createdAt`,
        true,
      ) as Date,
      updatedAt: date(
        document.updatedAt,
        `${location}.updatedAt`,
        true,
      ) as Date,
      legacySyncUpdatedAtMilliseconds: sync(
        document.__updatedAt,
        `${location}.__updatedAt`,
      ),
    });
  }
  const revisionRows = new Map(
    plan.revisions.map((revision) => [revision.id, revision]),
  );
  for (const { document, source, id, location, evidence } of rituals.entries) {
    let creatorId: string | null = null;
    const declaration = orphanDeclarations.get(sourceKey(source));
    if (document.userId !== undefined && document.userId !== null) {
      const ref = reference("users", document.userId, `${location}.userId`);
      creatorId = lookup(ref, `${location}.userId`);
      if (creatorId && !users.has(creatorId))
        fail("unresolved-reference", `${location}.userId`);
      if (creatorId === null) {
        if (declaration !== sourceKey(ref))
          fail("unapproved-orphan-creator", `${location}.userId`);
        evidence.transformations.push(
          "known-orphan-creator-retained-as-null-v1",
        );
        orphanDeclarations.delete(sourceKey(source));
      } else {
        if (declaration)
          fail("resolved-orphan-declaration", `${location}.userId`);
        addAlias(ref, creatorId, location);
      }
      evidence.references.push({
        field: "userId",
        source: ref,
        canonicalId: creatorId,
      });
    }
    if (document.groupId !== undefined && document.templeId !== undefined)
      fail("combined-scope", location);
    let scope: "public" | "group" | "temple" = "public";
    let groupId: string | null = null,
      templeId: string | null = null,
      minGrade: number | null = null;
    if (document.groupId !== undefined) {
      scope = "group";
      groupId = resolve(
        document.groupId,
        "userGroups",
        groups,
        `${location}.groupId`,
        evidence,
        "groupId",
      );
    } else if (document.templeId !== undefined) {
      scope = "temple";
      templeId = resolve(
        document.templeId,
        "temples",
        temples,
        `${location}.templeId`,
        evidence,
        "templeId",
      );
      if (document.minGrade === undefined) {
        minGrade = 0;
        evidence.transformations.push("absent-temple-grade-defaulted-zero-v1");
      } else {
        if (
          typeof document.minGrade !== "number" ||
          !Number.isSafeInteger(document.minGrade) ||
          document.minGrade < 0
        )
          fail("invalid-grade", `${location}.minGrade`);
        minGrade = document.minGrade;
      }
    }
    if (scope !== "temple" && Object.hasOwn(document, "minGrade")) {
      evidence.ignoredMinGradeJson = json(
        document.minGrade,
        `${location}.minGrade`,
      );
      evidence.transformations.push(
        "irrelevant-min-grade-retained-in-evidence-v1",
      );
    }
    const currentSource = reference(
      "docRevisions",
      document.docRevisionId,
      `${location}.docRevisionId`,
    );
    let currentId = revisions.bySource.get(sourceKey(currentSource));
    if (
      currentSource.legacyIdType === "string" &&
      hex.test(currentSource.legacyIdValue)
    ) {
      const objectSource: LegacyAliasKey = {
        ...currentSource,
        legacyIdType: "objectid",
        legacyIdValue: currentSource.legacyIdValue.toLowerCase(),
      };
      const objectId = revisions.bySource.get(sourceKey(objectSource));
      if (currentId && objectId && currentId !== objectId)
        fail("ambiguous-revision-reference", `${location}.docRevisionId`);
      if (!currentId && objectId) {
        currentId = objectId;
        evidence.transformations.push(
          "current-revision-string-objectid-alias-v1",
        );
      }
    }
    currentId ??=
      lookup(currentSource, `${location}.docRevisionId`) ?? undefined;
    const current = currentId ? revisionRows.get(currentId) : undefined;
    if (!current || current.ritualId !== id)
      fail("invalid-current-revision", `${location}.docRevisionId`);
    if (
      plan.revisions.some(
        (other) =>
          other.ritualId === id &&
          (other.updatedAt as Date).getTime() >
            (current.updatedAt as Date).getTime(),
      )
    )
      fail("current-revision-not-latest", `${location}.docRevisionId`);
    addAlias(currentSource, current.id, `${location}.docRevisionId`);
    evidence.references.push({
      field: "docRevisionId",
      source: currentSource,
      canonicalId: current.id,
    });
    row(document.doc, `${location}.doc`);
    const contentJson = json(document.doc, `${location}.doc`);
    plan.rituals.push({
      id,
      title: text(document.title, `${location}.title`),
      creatorId,
      scope,
      groupId,
      templeId,
      minGrade,
      currentRevisionId: null,
      version: 0,
      createdAt: date(document.createdAt, `${location}.createdAt`),
      updatedAt: date(document.updatedAt, `${location}.updatedAt`),
      legacySyncUpdatedAtMilliseconds: sync(
        document.__updatedAt,
        `${location}.__updatedAt`,
      ),
    });
    plan.archives.push({
      ritualId: id,
      claimedRevisionId: current.id,
      contentJson,
      contentSha256: hash(contentJson),
      serializationVersion: "json-stringify-utf8-v1",
      importedAt: new Date(importedAt),
    });
    plan.currentRevisions.push({ ritualId: id, revisionId: current.id });
    plan.parityRequired.push(id);
  }
  if (orphanDeclarations.size)
    fail("unused-orphan-declaration", "options.unresolvedCreators");
  plan.aliases = [...aliases.values()];
  return plan;
}
