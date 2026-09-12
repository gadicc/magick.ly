import { createHash } from "node:crypto";
import { EJSON } from "bson";
import type { LegacyAliasKey } from "../db/legacyIds";
import type * as schema from "../db/schema/studyProgress";
import { isUuidV7 } from "../lib/ids";

type Row = Record<string, unknown>;
/** Protected reviewed exception: archive only the approved, fingerprinted zero-counter source. */
export interface EmptyStudyDuplicate {
  keep: LegacyAliasKey;
  archive: LegacyAliasKey;
  /** SHA-256 of the independently reviewed canonical EJSON source, including its schedules. */
  expectedArchiveSha256: string;
}
/** Pure rows and evidence for one dependency-ordered transaction; no review events are synthesized. */
export interface LegacyStudyImportPlan {
  progress: (typeof schema.studyProgress.$inferInsert & { id: string })[];
  cards: (typeof schema.studyCardStates.$inferInsert)[];
  snapshots: (typeof schema.legacyStudySnapshots.$inferInsert)[];
  aliases: { source: LegacyAliasKey; canonicalId: string }[];
  /** Persist these typed mappings and explicit merge reasons in the protected import ledger. */
  evidence: {
    source: LegacyAliasKey;
    userSource: LegacyAliasKey;
    canonicalId: string;
    presentFields: string[];
    disposition: "baseline" | "empty-duplicate";
    keptSource?: LegacyAliasKey;
    approvedArchiveSha256?: string;
    aggregateMismatches: string[];
  }[];
  counts: {
    sourceRows: number;
    canonicalRows: number;
    archivedDuplicateRows: number;
    sourceCards: number;
    canonicalCards: number;
    archivedCards: number;
    sourceRepetitions: number;
    canonicalRepetitions: number;
    archivedRepetitions: number;
    quirkRows: number;
    aggregateMismatchRows: number;
  };
}
/** Categories and positions only; source identifiers, card keys and payloads never enter errors. */
export class LegacyStudyImportError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
  ) {
    super(`${code} at ${path}`);
    this.name = "LegacyStudyImportError";
  }
}
const key = (source: LegacyAliasKey) =>
  JSON.stringify([
    source.sourceSystem,
    source.entityType,
    source.legacyIdType,
    source.legacyIdValue,
  ]);
function fail(code: string, path: string): never {
  throw new LegacyStudyImportError(code, path);
}
function row(value: unknown, path: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("invalid-object", path);
  return value as Row;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) fail("invalid-text", path);
  if (value.includes("\0") || !value.isWellFormed())
    fail("unrepresentable-text", path);
  return value;
}
function fields(value: Row, allowed: readonly string[], path: string) {
  if (Object.keys(value).some((field) => !allowed.includes(field)))
    fail("unclassified-fields", path);
}
function count(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    Object.is(value, -0)
  )
    fail("invalid-counter", path);
  return value;
}
function date(value: unknown, path: string, required = true): Date | null {
  if (!required && (value === undefined || value === null)) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    fail("invalid-date", path);
  return new Date(value.getTime());
}
function source(
  entityType: string,
  value: unknown,
  path: string,
): LegacyAliasKey {
  if (typeof value === "string")
    return {
      sourceSystem: "mongodb",
      entityType,
      legacyIdType: "string",
      legacyIdValue: text(value, path),
    };
  const object = row(value, path);
  if (
    object._bsontype !== "ObjectId" ||
    typeof object.toHexString !== "function"
  )
    fail("invalid-source-id", path);
  let hex: unknown;
  try {
    hex = object.toHexString();
  } catch {
    fail("invalid-source-id", path);
  }
  if (typeof hex !== "string" || !/^[0-9a-f]{24}$/i.test(hex))
    fail("invalid-source-id", path);
  return {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: "objectid",
    legacyIdValue: hex.toLowerCase(),
  };
}
function declared(value: LegacyAliasKey, path: string): LegacyAliasKey {
  if (
    !value ||
    value.sourceSystem !== "mongodb" ||
    value.entityType !== "studySet" ||
    !["string", "objectid"].includes(value.legacyIdType) ||
    typeof value.legacyIdValue !== "string" ||
    (value.legacyIdType === "objectid" &&
      !/^[0-9a-f]{24}$/.test(value.legacyIdValue))
  )
    fail("invalid-duplicate-declaration", path);
  text(value.legacyIdValue, path);
  return { ...value };
}
function snapshot(document: Row, path: string): string {
  const ancestors = new Set<object>();
  function validate(value: unknown): void {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (value instanceof Date) {
      date(value, path);
      return;
    }
    if (value === null || typeof value !== "object" || ancestors.has(value))
      fail("unsupported-snapshot-value", path);
    if ("_bsontype" in value && value._bsontype === "ObjectId") {
      source("studySet", value, path);
      return;
    }
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail("unsupported-snapshot-value", path);
    if (Object.getOwnPropertySymbols(value).length)
      fail("unsupported-snapshot-value", path);
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length)
        fail("unsupported-snapshot-value", path);
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) fail("unsupported-snapshot-value", path);
        validate(value[i]);
      }
    } else for (const fieldValue of Object.values(value)) validate(fieldValue);
    ancestors.delete(value);
  }
  validate(document);
  function same(left: unknown, right: unknown): boolean {
    if (left instanceof Date)
      return right instanceof Date && left.getTime() === right.getTime();
    if (left === null || typeof left !== "object")
      return Object.is(left, right);
    if (right === null || typeof right !== "object") return false;
    if ("_bsontype" in left && left._bsontype === "ObjectId") {
      return (
        "_bsontype" in right &&
        right._bsontype === "ObjectId" &&
        source("studySet", left, path).legacyIdValue ===
          source("studySet", right, path).legacyIdValue
      );
    }
    if (
      right instanceof Date ||
      "_bsontype" in right ||
      Array.isArray(left) !== Array.isArray(right)
    )
      return false;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (field) =>
          Object.hasOwn(right, field) &&
          same((left as Row)[field], (right as Row)[field]),
      )
    );
  }
  try {
    const serialized = EJSON.stringify(document, { relaxed: false });
    // Literal objects that resemble EJSON type tags must not revive as another value.
    if (!same(document, EJSON.parse(serialized, { relaxed: true })))
      fail("snapshot-roundtrip-loss", path);
    return serialized;
  } catch (error) {
    if (error instanceof LegacyStudyImportError) throw error;
    return fail("snapshot-serialization-failed", path);
  }
}

/**
 * Keeps stored aggregates and individual schedules independent. Exact reviewed
 * fingerprinted zero-counter duplicate pairs are the sole merge path; no timestamp
 * or email heuristics. Zero counters alone never establish untouched scheduling.
 * Source snapshots preserve typed dates/IDs, absent fields and quirk provenance.
 */
export function planLegacyStudyImport(
  input: readonly unknown[],
  options: {
    lookup: (source: LegacyAliasKey) => string | null;
    canonicalUserIds: readonly string[];
    emptyDuplicates: readonly EmptyStudyDuplicate[];
    importedAt: Date;
  },
): LegacyStudyImportPlan {
  if (!Array.isArray(input)) fail("invalid-input-array", "input");
  row(options, "options");
  if (
    typeof options.lookup !== "function" ||
    !Array.isArray(options.canonicalUserIds) ||
    !Array.isArray(options.emptyDuplicates)
  )
    fail("invalid-options", "options");
  const importedAt = date(options.importedAt, "options.importedAt") as Date;
  const users = new Set<string>();
  for (const value of options.canonicalUserIds) {
    if (!isUuidV7(value) || users.has(value.toLowerCase()))
      fail("invalid-user-set", "options.canonicalUserIds");
    users.add(value.toLowerCase());
  }
  function lookup(ref: LegacyAliasKey, path: string): string | null {
    const id = options.lookup(ref);
    if (id === null) return null;
    if (!isUuidV7(id)) fail("invalid-canonical-alias", path);
    return id.toLowerCase();
  }
  const duplicates = new Map<
    string,
    { keep: LegacyAliasKey; expectedArchiveSha256: string }
  >();
  const involved = new Set<string>();
  options.emptyDuplicates.forEach((pair, i) => {
    const path = `options.emptyDuplicates[${i}]`;
    row(pair, path);
    const keep = declared(pair.keep, path),
      archive = declared(pair.archive, path);
    if (
      key(keep) === key(archive) ||
      involved.has(key(keep)) ||
      involved.has(key(archive))
    )
      fail("overlapping-duplicate-declaration", path);
    involved.add(key(keep));
    involved.add(key(archive));
    if (
      typeof pair.expectedArchiveSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(pair.expectedArchiveSha256)
    )
      fail("invalid-duplicate-fingerprint", path);
    duplicates.set(key(archive), {
      keep,
      expectedArchiveSha256: pair.expectedArchiveSha256,
    });
  });
  const known = new Map<string, number>();
  const rows = input.map((item, index) => {
    const path = `input[${index}]`,
      document = row(item, path);
    fields(
      document,
      [
        "_id",
        "userId",
        "setId",
        "cards",
        "correct",
        "incorrect",
        "time",
        "dueDate",
        "createdAt",
        "updatedAt",
        "__updatedAt",
        "__ObjectIDs",
        "quirk",
      ],
      path,
    );
    const ref = source("studySet", document._id, `${path}._id`);
    if (known.has(key(ref))) fail("duplicate-source-id", path);
    known.set(key(ref), index);
    const userSource = source("users", document.userId, `${path}.userId`);
    const userId = lookup(userSource, `${path}.userId`);
    if (!userId || !users.has(userId))
      fail("unresolved-user", `${path}.userId`);
    if (
      Object.hasOwn(document, "__ObjectIDs") &&
      (!Array.isArray(document.__ObjectIDs) ||
        document.__ObjectIDs.some((value) => value !== "userId"))
    )
      fail("invalid-objectid-metadata", path);
    const setId = text(document.setId, `${path}.setId`);
    const correct = count(document.correct, `${path}.correct`),
      incorrect = count(document.incorrect, `${path}.incorrect`),
      time = count(document.time, `${path}.time`);
    const dueDate = date(document.dueDate, `${path}.dueDate`) as Date;
    const cards = Object.entries(row(document.cards, `${path}.cards`)).map(
      ([cardKey, value], i) => {
        const cardPath = `${path}.cards[${i}]`,
          card = row(value, cardPath);
        text(cardKey, cardPath);
        fields(
          card,
          [
            "correct",
            "incorrect",
            "time",
            "dueDate",
            "supermemo",
            "repetition",
          ],
          cardPath,
        );
        const memo = row(card.supermemo, `${cardPath}.supermemo`);
        fields(
          memo,
          ["interval", "repetition", "efactor"],
          `${cardPath}.supermemo`,
        );
        if (
          typeof memo.interval !== "number" ||
          !Number.isFinite(memo.interval) ||
          memo.interval < 0 ||
          Object.is(memo.interval, -0)
        )
          fail("invalid-interval", cardPath);
        if (
          typeof memo.efactor !== "number" ||
          !Number.isFinite(memo.efactor) ||
          memo.efactor <= 0
        )
          fail("invalid-efactor", cardPath);
        let repetitionWeight: number | null = null;
        const repetitionPresent = Object.hasOwn(card, "repetition");
        if (repetitionPresent) {
          const repetition = row(card.repetition, `${cardPath}.repetition`);
          fields(repetition, ["weight"], `${cardPath}.repetition`);
          if (Object.hasOwn(repetition, "weight"))
            repetitionWeight = count(
              repetition.weight,
              `${cardPath}.repetition.weight`,
            );
        }
        return {
          cardKey,
          correct: count(card.correct, `${cardPath}.correct`),
          incorrect: count(card.incorrect, `${cardPath}.incorrect`),
          time: count(card.time, `${cardPath}.time`),
          dueDate: date(card.dueDate, `${cardPath}.dueDate`) as Date,
          interval: memo.interval,
          repetition: count(
            memo.repetition,
            `${cardPath}.supermemo.repetition`,
          ),
          efactor: memo.efactor,
          repetitionPresent,
          repetitionWeight,
        };
      },
    );
    const aggregateMismatches = (
      ["correct", "incorrect", "time"] as const
    ).filter(
      (field) =>
        cards.reduce((sum, card) => sum + BigInt(card[field]), BigInt(0)) !==
        BigInt(document[field] as number),
    );
    return {
      path,
      document,
      source: ref,
      userSource,
      userId,
      setId,
      correct,
      incorrect,
      time,
      dueDate,
      cards,
      aggregateMismatches,
      createdAt: date(document.createdAt, `${path}.createdAt`, false),
      updatedAt: date(document.updatedAt, `${path}.updatedAt`, false),
      legacySyncUpdatedAtMilliseconds:
        document.__updatedAt === undefined
          ? null
          : count(document.__updatedAt, `${path}.__updatedAt`),
      sourceEjson: snapshot(document, path),
    };
  });
  const plan: LegacyStudyImportPlan = {
    progress: [],
    cards: [],
    snapshots: [],
    aliases: [],
    evidence: [],
    counts: {
      sourceRows: rows.length,
      canonicalRows: 0,
      archivedDuplicateRows: 0,
      sourceCards: 0,
      canonicalCards: 0,
      archivedCards: 0,
      sourceRepetitions: 0,
      canonicalRepetitions: 0,
      archivedRepetitions: 0,
      quirkRows: 0,
      aggregateMismatchRows: 0,
    },
  };
  const assigned = new Map<string, string>();
  const occupied = new Set(users);
  const naturalKeys = new Set<string>();
  for (const item of rows) {
    if (duplicates.has(key(item.source))) continue;
    const id = lookup(item.source, item.path);
    if (!id) fail("missing-canonical-alias", item.path);
    const natural = JSON.stringify([item.userId, item.setId]);
    if (occupied.has(id)) fail("duplicate-canonical-identity", item.path);
    if (naturalKeys.has(natural))
      fail("unapproved-duplicate-user-set", item.path);
    occupied.add(id);
    naturalKeys.add(natural);
    assigned.set(key(item.source), id);
    plan.progress.push({
      id,
      userId: item.userId,
      setId: item.setId,
      correct: item.correct,
      incorrect: item.incorrect,
      time: item.time,
      dueDate: item.dueDate,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      legacySyncUpdatedAtMilliseconds: item.legacySyncUpdatedAtMilliseconds,
      version: 0,
    });
    plan.cards.push(...item.cards.map((card) => ({ progressId: id, ...card })));
  }
  function activity(item: (typeof rows)[number]) {
    return (
      item.correct > 0 ||
      item.incorrect > 0 ||
      item.time > 0 ||
      item.cards.some(
        (card) => card.correct > 0 || card.incorrect > 0 || card.time > 0,
      )
    );
  }
  for (const item of rows) {
    const approvedDuplicate = duplicates.get(key(item.source));
    const keptSource = approvedDuplicate?.keep;
    let id = assigned.get(key(item.source));
    const disposition = keptSource ? "empty-duplicate" : "baseline";
    if (keptSource) {
      const keepIndex = known.get(key(keptSource));
      if (keepIndex === undefined) fail("missing-kept-duplicate", item.path);
      const keep = rows[keepIndex];
      if (item.userId !== keep.userId || item.setId !== keep.setId)
        fail("duplicate-pair-mismatch", item.path);
      if (activity(item) || !activity(keep))
        fail("duplicate-not-empty-vs-reviewed", item.path);
      const keys = (row: typeof item) =>
        row.cards.map((card) => card.cardKey).sort();
      if (JSON.stringify(keys(item)) !== JSON.stringify(keys(keep)))
        fail("duplicate-card-keys-differ", item.path);
      // Counters do not prove untouched scheduling. The exact reviewed snapshot
      // must still match, including all SM2/repetition fields, dates and metadata.
      if (
        createHash("sha256").update(item.sourceEjson, "utf8").digest("hex") !==
        approvedDuplicate?.expectedArchiveSha256
      )
        fail("duplicate-source-fingerprint-mismatch", item.path);
      id = assigned.get(key(keptSource));
      const existing = lookup(item.source, item.path);
      if (existing !== null && existing !== id)
        fail("duplicate-alias-conflict", item.path);
      duplicates.delete(key(item.source));
    }
    if (!id) fail("missing-canonical-alias", item.path);
    plan.aliases.push({ source: { ...item.source }, canonicalId: id });
    plan.snapshots.push({
      sourceSystem: "mongodb",
      legacyIdType: item.source.legacyIdType,
      legacyIdValue: item.source.legacyIdValue,
      progressId: id,
      disposition,
      sourceEjson: item.sourceEjson,
      sourceSha256: createHash("sha256")
        .update(item.sourceEjson, "utf8")
        .digest("hex"),
      serializationVersion: "bson-canonical-ejson-v1",
      importedAt: new Date(importedAt),
    });
    plan.evidence.push({
      source: { ...item.source },
      userSource: { ...item.userSource },
      canonicalId: id,
      presentFields: Object.keys(item.document).sort(),
      disposition,
      ...(keptSource
        ? {
            keptSource: { ...keptSource },
            approvedArchiveSha256: approvedDuplicate?.expectedArchiveSha256,
          }
        : {}),
      aggregateMismatches: item.aggregateMismatches,
    });
    const repetitions = item.cards.filter(
      (card) => card.repetitionPresent,
    ).length;
    plan.counts.sourceCards += item.cards.length;
    plan.counts.sourceRepetitions += repetitions;
    if (keptSource) {
      plan.counts.archivedDuplicateRows++;
      plan.counts.archivedCards += item.cards.length;
      plan.counts.archivedRepetitions += repetitions;
    } else {
      plan.counts.canonicalRows++;
      plan.counts.canonicalCards += item.cards.length;
      plan.counts.canonicalRepetitions += repetitions;
    }
    if (Object.hasOwn(item.document, "quirk")) plan.counts.quirkRows++;
    if (item.aggregateMismatches.length) plan.counts.aggregateMismatchRows++;
  }
  if (duplicates.size)
    fail("unused-duplicate-declaration", "options.emptyDuplicates");
  return plan;
}
