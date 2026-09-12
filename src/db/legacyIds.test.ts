import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../tests/memory-pglite";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  ensureLegacyId,
  LegacyAliasConflictError,
  type LegacyAliasKey,
  resolveLegacyId,
} from "./legacyIds";
import { legacyIdAliases } from "./schema/legacyIds";

const key: LegacyAliasKey = {
  sourceSystem: "mongodb",
  entityType: "docs",
  legacyIdType: "objectid",
  legacyIdValue: "507f1f77bcf86cd799439011",
};

beforeEach(async () => {
  await db.delete(legacyIdAliases);
});

describe("durable legacy identifiers", () => {
  it("resolves an absent alias without allocating anything", async () => {
    expect(await resolveLegacyId(db, key)).toBeNull();
    expect(await db.select().from(legacyIdAliases)).toHaveLength(0);
  });

  it("persists one mapping and reuses it on an import rerun", async () => {
    const first = await ensureLegacyId(db, key);
    const [before] = await db.select().from(legacyIdAliases);
    expect(await ensureLegacyId(db, key)).toBe(first);
    expect(await resolveLegacyId(db, key)).toBe(first);
    expect(await db.select().from(legacyIdAliases)).toEqual([before]);
    expect(isUuidV7(first)).toBe(true);
    expect(isUuidV7(before.id)).toBe(true);
    expect(before.createdAt).toBeInstanceOf(Date);
  });

  it("normalizes ObjectId hex without mutating caller input", async () => {
    const uppercase = {
      ...key,
      legacyIdValue: key.legacyIdValue.toUpperCase(),
    };
    const expected = { ...uppercase };
    const id = await ensureLegacyId(db, uppercase);
    expect(await resolveLegacyId(db, key)).toBe(id);
    expect(uppercase).toEqual(expected);
  });

  it("keeps string and ObjectId keys distinct even when their text matches", async () => {
    const objectId = await ensureLegacyId(db, key);
    const stringKey = { ...key, legacyIdType: "string" as const };
    expect(await resolveLegacyId(db, stringKey)).toBeNull();
    const stringId = await ensureLegacyId(db, stringKey);
    expect(stringId).not.toBe(objectId);
    expect(await resolveLegacyId(db, key)).toBe(objectId);
    expect(await resolveLegacyId(db, stringKey)).toBe(stringId);
  });

  it("preserves exact string values including case, whitespace and the empty ID", async () => {
    const values = ["abc", "ABC", " abc ", ""];
    const ids = await Promise.all(
      values.map((legacyIdValue) =>
        ensureLegacyId(db, { ...key, legacyIdType: "string", legacyIdValue }),
      ),
    );
    expect(new Set(ids).size).toBe(values.length);
    const rows = await db.select().from(legacyIdAliases);
    expect(rows.map((row) => row.legacyIdValue).sort()).toEqual(values.sort());
  });

  it("scopes keys by source and entity", async () => {
    const ids = await Promise.all([
      ensureLegacyId(db, key),
      ensureLegacyId(db, { ...key, entityType: "users" }),
      ensureLegacyId(db, { ...key, sourceSystem: "another-source" }),
    ]);
    expect(new Set(ids).size).toBe(3);
  });

  it("allows deliberate many-to-one aliases for reconciled source records", async () => {
    const canonicalId = await ensureLegacyId(db, key);
    const second = { ...key, legacyIdValue: "507f1f77bcf86cd799439012" };
    expect(await ensureLegacyId(db, second, canonicalId.toUpperCase())).toBe(
      canonicalId,
    );
    expect(await ensureLegacyId(db, second, canonicalId)).toBe(canonicalId);
    expect(await db.select().from(legacyIdAliases)).toHaveLength(2);
  });

  it("rejects conflicting remaps and leaves the original mapping intact", async () => {
    const original = await ensureLegacyId(db, key);
    const [before] = await db.select().from(legacyIdAliases);
    await expect(
      ensureLegacyId(db, key, createUuidV7()),
    ).rejects.toBeInstanceOf(LegacyAliasConflictError);
    expect(await resolveLegacyId(db, key)).toBe(original);
    expect(await db.select().from(legacyIdAliases)).toEqual([before]);
  });

  it("converges concurrent allocations on one durable mapping", async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, () => ensureLegacyId(db, key)),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await db.select().from(legacyIdAliases)).toHaveLength(1);
  });

  it("commits or rolls back mappings with the caller's transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        await ensureLegacyId(tx, key);
        throw new Error("abort import batch");
      }),
    ).rejects.toThrow("abort import batch");
    expect(await resolveLegacyId(db, key)).toBeNull();
    const id = await db.transaction((tx) => ensureLegacyId(tx, key));
    expect(await resolveLegacyId(db, key)).toBe(id);
  });

  it.each([
    { ...key, sourceSystem: " " },
    { ...key, entityType: "" },
    { ...key, legacyIdValue: "invalid ObjectId" },
  ])("rejects invalid source keys before writing", async (input) => {
    await expect(ensureLegacyId(db, input)).rejects.toThrow();
    expect(await db.select().from(legacyIdAliases)).toHaveLength(0);
  });

  it("rejects UUIDv4 canonical targets", async () => {
    await expect(
      ensureLegacyId(db, key, "550e8400-e29b-41d4-a716-446655440000"),
    ).rejects.toThrow("UUIDv7");
    expect(await db.select().from(legacyIdAliases)).toHaveLength(0);
  });

  it.each([
    { ...key, legacyIdType: "number" },
    { ...key, legacyIdValue: 123 },
  ])("rejects unsupported encodings from import input", async (input) => {
    await expect(
      ensureLegacyId(db, input as unknown as LegacyAliasKey),
    ).rejects.toThrow();
    expect(await db.select().from(legacyIdAliases)).toHaveLength(0);
  });

  it("enforces source uniqueness and target version for direct SQL inserts", async () => {
    const canonicalId = await ensureLegacyId(db, key);
    await expect(
      db.insert(legacyIdAliases).values({ ...key, canonicalId }),
    ).rejects.toThrow();
    await expect(
      db.insert(legacyIdAliases).values({
        ...key,
        legacyIdValue: "507f1f77bcf86cd799439013",
        canonicalId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(legacyIdAliases)).toHaveLength(1);
  });
});
