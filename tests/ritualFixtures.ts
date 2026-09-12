import { ObjectId } from "bson";
import type { LegacyAliasKey } from "../src/db/legacyIds";
import { createUuidV7 } from "../src/lib/ids";

export const sourceKey = (ref: LegacyAliasKey) =>
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
/** Invented source only; includes CRLF, combining Unicode, grade zero and a known orphan. */
export function fixture() {
  const oid = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));
  const users = [oid(1), oid(2)];
  const group = oid(3),
    temple = oid(4),
    orphan = oid(5);
  const ritualIds = [oid(16), oid(17), oid(18)];
  const revisionIds = [32, 33, 34, 35, 36, 37].map(oid);
  const rituals: Record<string, unknown>[] = ritualIds.map((_id, i) => ({
    _id,
    title: `Synthetic ritual ${i}`,
    userId: i === 2 ? orphan : users[i],
    docRevisionId: revisionIds[i * 2 + 1].toHexString(),
    ...(i === 0
      ? { minGrade: 0 }
      : i === 1
        ? { groupId: group }
        : { templeId: temple, minGrade: 0 }),
    createdAt: new Date("2020-01-01T00:00:00.123Z"),
    updatedAt: new Date("2025-01-01T00:00:00.002Z"),
    __updatedAt: 1_700_000_000_001,
    doc: {
      children: [
        {
          type: "task",
          value: "Synthetic stored output",
          forMe: true,
          custom: { marked: false },
        },
      ],
      forMe: false,
    },
  }));
  const revisions: Record<string, unknown>[] = revisionIds.map((_id, i) => ({
    _id,
    docId: ritualIds[Math.floor(i / 2)],
    userId: users[i % 2],
    text: `p Synthetic source ${i}\r\n  | e\u0301 \u{1F30D}\r\n`,
    createdAt: new Date(
      i % 2 ? "2025-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.000Z",
    ),
    updatedAt: new Date(
      i % 2 ? "2025-01-01T00:00:00.000Z" : "2020-01-01T00:00:00.001Z",
    ),
    __updatedAt: 1_700_000_000_000 + i,
  }));
  const primaries = [
    ...users.map((id) => source("users", id)),
    source("userGroups", group),
    source("temples", temple),
    ...ritualIds.map((id) => source("docs", id)),
    ...revisionIds.map((id) => source("docRevisions", id)),
  ];
  const ids = new Map(primaries.map((ref) => [sourceKey(ref), createUuidV7()]));
  const lookup = (ref: LegacyAliasKey) => ids.get(sourceKey(ref)) ?? null;
  const options = () => ({
    lookup,
    canonicalUserIds: users.map((id) => lookup(source("users", id))!),
    canonicalGroupIds: [lookup(source("userGroups", group))!],
    canonicalTempleIds: [lookup(source("temples", temple))!],
    importedAt,
    unresolvedCreators: [
      {
        ritual: source("docs", ritualIds[2]),
        creator: source("users", orphan),
      },
    ],
  });
  return {
    input: { rituals, revisions },
    options,
    ids,
    lookup,
    primaries,
    users,
    group,
    temple,
    orphan,
    ritualIds,
    revisionIds,
  };
}
