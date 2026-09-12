import { ObjectId } from "bson";
import type { LegacyAliasKey } from "../src/db/legacyIds";
import { createUuidV7 } from "../src/lib/ids";
import { normalizeLegacyAuth } from "../src/migration/normalizeLegacyAuth";
import { legacyProviderAlias } from "../src/migration/planBetterAuthImport";

export const importedAt = new Date("2026-08-01T12:00:00.000Z");
export const sourceKey = (source: LegacyAliasKey) => JSON.stringify(source);
export function fixture() {
  const first = new ObjectId("111111111111111111111111");
  const second = new ObjectId("222222222222222222222222");
  const users = [
    {
      _id: first,
      id: first.toHexString(),
      name: { givenName: "Synthetic", familyName: "Editor" },
      email: "Editor@Example.test",
      emailVerified: null,
      admin: true,
      emails: [{ value: "secondary@example.test", verified: true }],
      createdAt: new Date("2020-01-02T03:04:05.000Z"),
      __updatedAt: 1_600_000_000_000,
      services: [
        {
          service: "google",
          id: "subject-editor",
          profile: {
            emails: [{ value: "Editor@Example.test", verified: true }],
          },
        },
      ],
    },
    {
      _id: second,
      name: "Synthetic Reader",
      email: "reader@example.test",
      emailVerified: null,
      services: [
        {
          service: "google",
          id: "subject-reader",
          profile: {
            emails: [{ value: "reader@example.test", verified: true }],
          },
        },
      ],
    },
  ];
  const normalized = normalizeLegacyAuth({
    users,
    accounts: [
      {
        _id: new ObjectId("333333333333333333333333"),
        userId: first.toHexString(),
        provider: "google",
        providerAccountId: "subject-editor",
        type: "oidc",
        access_token: "obsolete-private-token",
      },
      { _id: "old-strategy", type: "oauth2", name: "google", oauth2: {} },
    ],
    sessions: [
      {
        _id: "obsolete-session-token",
        userId: first,
        token: "obsolete-private-token",
      },
    ],
  });
  const ids = new Map<string, string>();
  for (const user of normalized.users)
    ids.set(sourceKey(user.source), createUuidV7());
  for (const account of normalized.accounts)
    ids.set(sourceKey(legacyProviderAlias(account)), createUuidV7());
  const lookup = (source: LegacyAliasKey) => ids.get(sourceKey(source)) ?? null;
  return { normalized, ids, lookup };
}
