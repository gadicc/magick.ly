import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import { legacyIdAliases } from "./schema/legacyIds";

/** Minimal Drizzle boundary; accepts the app database or an existing transaction. */
type AliasDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert">;

/** Fully qualified source identity, before field-aware reference reconciliation. */
export interface LegacyAliasKey {
  /** Stable origin such as mongodb; never derive this from a connection URL. */
  sourceSystem: string;
  /** Source entity/collection; identical IDs in different collections stay distinct. */
  entityType: string;
  /** ObjectId values are normalized to lowercase hex; strings remain exact. */
  legacyIdType: "objectid" | "string";
  /** The source identifier value, excluding any type prefix. */
  legacyIdValue: string;
}

/** A requested mapping disagreed with a durable mapping and was not written. */
export class LegacyAliasConflictError extends Error {
  constructor() {
    super("The legacy identifier already maps to a different canonical ID.");
    this.name = "LegacyAliasConflictError";
  }
}

function normalizeKey(key: LegacyAliasKey): LegacyAliasKey {
  if (!key.sourceSystem.trim() || !key.entityType.trim()) {
    throw new Error("Legacy source and entity names must not be empty.");
  }
  if (key.legacyIdType !== "objectid" && key.legacyIdType !== "string") {
    throw new Error("Unsupported legacy identifier type.");
  }
  if (typeof key.legacyIdValue !== "string") {
    throw new Error("The legacy identifier value must be a string.");
  }
  if (key.legacyIdType === "objectid") {
    if (!/^[0-9a-f]{24}$/i.test(key.legacyIdValue)) {
      throw new Error(
        "ObjectId aliases require exactly 24 hexadecimal characters.",
      );
    }
    return { ...key, legacyIdValue: key.legacyIdValue.toLowerCase() };
  }
  return { ...key };
}

function keyCondition(key: LegacyAliasKey) {
  return and(
    eq(legacyIdAliases.sourceSystem, key.sourceSystem),
    eq(legacyIdAliases.entityType, key.entityType),
    eq(legacyIdAliases.legacyIdType, key.legacyIdType),
    eq(legacyIdAliases.legacyIdValue, key.legacyIdValue),
  );
}

/** Resolves only the exact typed key; callers decide any cross-type reconciliation. */
export async function resolveLegacyId(
  db: AliasDatabase,
  key: LegacyAliasKey,
): Promise<string | null> {
  const normalizedKey = normalizeKey(key);
  const [row] = await db
    .select({ canonicalId: legacyIdAliases.canonicalId })
    .from(legacyIdAliases)
    .where(keyCondition(normalizedKey))
    .limit(1);
  return row?.canonicalId ?? null;
}

/**
 * Allocates a mapping once, or explicitly aliases a source key to an existing ID.
 * Conflicts never overwrite an earlier mapping. Pass a transaction when mapping
 * and domain records must commit together; stronger isolation may require retry.
 */
export async function ensureLegacyId(
  db: AliasDatabase,
  key: LegacyAliasKey,
  canonicalId?: string,
): Promise<string> {
  const normalizedKey = normalizeKey(key);
  if (canonicalId !== undefined && !isUuidV7(canonicalId)) {
    throw new Error("The canonical ID must be a UUIDv7.");
  }
  const requestedId = canonicalId?.toLowerCase();
  const [inserted] = await db
    .insert(legacyIdAliases)
    .values({
      ...normalizedKey,
      canonicalId: requestedId ?? createUuidV7(),
    })
    .onConflictDoNothing({
      target: [
        legacyIdAliases.sourceSystem,
        legacyIdAliases.entityType,
        legacyIdAliases.legacyIdType,
        legacyIdAliases.legacyIdValue,
      ],
    })
    .returning({ canonicalId: legacyIdAliases.canonicalId });

  // The unique constraint decides concurrent allocation, not a read-before-write
  // check. A losing writer resolves the already committed winner.
  const resolvedId =
    inserted?.canonicalId ?? (await resolveLegacyId(db, normalizedKey));
  if (!resolvedId) {
    throw new Error(
      "The conflicting alias is not visible; retry the transaction.",
    );
  }
  if (requestedId && resolvedId !== requestedId) {
    throw new LegacyAliasConflictError();
  }
  return resolvedId;
}
