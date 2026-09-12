import { ObjectId } from "bson";
import type { LegacyAliasKey } from "../src/db/legacyIds";
import { createUuidV7 } from "../src/lib/ids";
import type { LegacyMembershipInput } from "../src/migration/planLegacyMembershipImport";

export const importedAt = new Date("2026-09-12T12:00:00.000Z");
export const sourceKey = (source: LegacyAliasKey) =>
  JSON.stringify([
    source.sourceSystem,
    source.entityType,
    source.legacyIdType,
    source.legacyIdValue,
  ]);
export function source(
  entityType: string,
  id: ObjectId | string,
): LegacyAliasKey {
  return {
    sourceSystem: "mongodb",
    entityType,
    legacyIdType: typeof id === "string" ? "string" : "objectid",
    legacyIdValue: typeof id === "string" ? id : id.toHexString(),
  };
}

/** Entirely invented data; the fixture deliberately includes an admin-only group edge. */
export function fixture() {
  const users = [1, 2, 3].map(
    (i) => new ObjectId(`20000000000000000000000${i}`),
  );
  const group = new ObjectId("100000000000000000000001");
  const temple = new ObjectId("300000000000000000000001");
  const memberships = [1, 2, 3].map(
    (i) => new ObjectId(`40000000000000000000000${i}`),
  );
  const input: LegacyMembershipInput = {
    users: [
      {
        source: source("users", users[0]),
        groupIds: [group.toHexString(), group],
        groupAdminIds: [],
      },
      {
        source: source("users", users[1]),
        groupAdminIds: [group.toHexString()],
      },
      { source: source("users", users[2]) },
    ],
    groups: [
      { _id: group, name: "Synthetic Group", __updatedAt: 1_700_000_000_000 },
    ],
    temples: [
      {
        _id: temple,
        name: "Synthetic Temple",
        slug: "Temple-Example",
        joinPass: "synthetic-invitation-only",
        updatedAt: new Date("2025-03-04T05:06:07Z"),
      },
    ],
    memberships: memberships.map((_id, i) => ({
      _id,
      userId: users[i],
      templeId: temple,
      grade: i,
      admin: i === 1,
      motto: i === 0 ? "" : "Synthetic motto",
      addedAt: new Date("2020-01-02T03:04:05.678Z"),
      ...(i === 0
        ? {}
        : {
            memberSince: i === 1 ? new Date("2019-06-07T08:09:10.111Z") : null,
          }),
    })),
  };
  const primaries = [
    ...users.map((id) => source("users", id)),
    source("userGroups", group),
    source("temples", temple),
    ...memberships.map((id) => source("templeMemberships", id)),
  ];
  const ids = new Map(primaries.map((ref) => [sourceKey(ref), createUuidV7()]));
  const lookup = (ref: LegacyAliasKey) => ids.get(sourceKey(ref)) ?? null;
  const options = () => ({
    lookup,
    importedAt,
    canonicalUserIds: users.map((id) => lookup(source("users", id))!),
  });
  return {
    input,
    users,
    group,
    temple,
    memberships,
    primaries,
    ids,
    lookup,
    options,
  };
}
