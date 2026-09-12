import { createHash } from "node:crypto";
import { EJSON, ObjectId } from "bson";
import type { LegacyAliasKey } from "../src/db/legacyIds";
import { createUuidV7 } from "../src/lib/ids";

export const key = (ref: LegacyAliasKey) =>
  JSON.stringify([
    ref.sourceSystem,
    ref.entityType,
    ref.legacyIdType,
    ref.legacyIdValue,
  ]);
export const source = (
  entityType: string,
  id: ObjectId | string,
): LegacyAliasKey => ({
  sourceSystem: "mongodb",
  entityType,
  legacyIdType: typeof id === "string" ? "string" : "objectid",
  legacyIdValue: typeof id === "string" ? id : id.toHexString(),
});
export const importedAt = new Date("2026-09-12T12:00:00.000Z");
export function card(reviewed: boolean, repetition: boolean) {
  return {
    correct: reviewed ? 2 : 0,
    incorrect: 0,
    time: reviewed ? 1234 : 0,
    dueDate: new Date("2026-09-11T12:34:56.789Z"),
    supermemo: {
      interval: reviewed ? 3 : 0,
      repetition: reviewed ? 1 : 0,
      efactor: 2.6,
    },
    ...(repetition ? { repetition: { weight: 0 } } : {}),
  };
}
/** Entirely synthetic: one reviewed baseline, one exact allowed empty duplicate and another owner. */
export function fixture(large = false) {
  const oid = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
  const users = [oid(1), oid(2)];
  const input: Record<string, unknown>[] = [];
  let repetitionBudget = large ? 459 : 3;
  const addRow = (index: number, cardCount: number, empty = false) => {
    const cards: Record<string, ReturnType<typeof card>> = Object.create(null);
    for (let i = 0; i < cardCount; i++)
      cards[`card-${i}`] = card(!empty, repetitionBudget-- > 0);
    input.push({
      _id: oid(100 + index),
      userId: users[empty ? 0 : index % 2],
      setId: empty ? "synthetic-set-0" : `synthetic-set-${index}`,
      cards,
      correct: empty ? 0 : cardCount * 2 + (index < (large ? 11 : 1) ? 1 : 0),
      incorrect: 0,
      time: empty ? 0 : cardCount * 1234 + (index < (large ? 11 : 1) ? 77 : 0),
      dueDate: new Date("2026-09-12T13:00:00.001Z"),
      __updatedAt: 1700000000000 + index,
      ...(index === 0
        ? {
            quirk: {
              flag: true,
              at: new Date("2020-01-01T00:00:00Z"),
              token: -0,
            },
            __ObjectIDs: ["userId", "userId"],
          }
        : {}),
    });
  };
  if (large) {
    addRow(0, 11);
    for (let i = 1; i <= 47; i++) addRow(i, i <= 34 ? 14 : 13);
    addRow(48, 11, true);
  } else {
    addRow(0, 2);
    addRow(1, 3);
    addRow(2, 2, true);
  }
  const refs = [
    ...users.map((user) => source("users", user)),
    ...input.map((row) => source("studySet", row._id as ObjectId)),
  ];
  const ids = new Map(refs.map((ref) => [key(ref), createUuidV7()]));
  const keep = refs[2],
    archive = refs.at(-1)!;
  ids.set(key(archive), ids.get(key(keep))!);
  const lookup = (ref: LegacyAliasKey) => ids.get(key(ref)) ?? null;
  // Capture approval once; mutating input later must invalidate the declaration.
  const expectedArchiveSha256 = createHash("sha256")
    .update(EJSON.stringify(input.at(-1), { relaxed: false }), "utf8")
    .digest("hex");
  const options = () => ({
    lookup,
    canonicalUserIds: users.map((user) => lookup(source("users", user))!),
    emptyDuplicates: [{ keep, archive, expectedArchiveSha256 }],
    importedAt,
  });
  return { input, ids, refs, users, keep, archive, lookup, options };
}
