import { ObjectId } from "bson";
import type {
  LegacyImportCollections,
  LegacyImportConfigV1,
} from "../src/migration/prepareLegacyImport";
import { fixture as ritualFixture } from "./ritualFixtures";
import { fixture as studyFixture } from "./studyFixtures";

export const importSecret = "SYNTHETIC_AUTH_SECRET_MUST_BE_DISCARDED";

/** Invented full-domain source with reviewed duplicate/orphan dispositions. */
export function legacyImportFixture() {
  const ritual = ritualFixture();
  const study = studyFixture();
  const users = ritual.users.map((_id, index) => ({
    _id,
    ...(index === 0 ? { id: _id.toHexString() } : {}),
    name: { givenName: "Synthetic", familyName: `Reader ${index}` },
    displayName: `Local reader ${index}`,
    emails: [{ value: `READER${index}@example.test`, verified: true }],
    photos: [{ value: "https://example.test/avatar.png" }],
    services: [
      {
        service: "google",
        id: `subject-${index}`,
        accessToken: importSecret,
        refreshToken: importSecret,
        profile: {
          provider: "google",
          id: `subject-${index}`,
          displayName: `Provider reader ${index}`,
          name: { givenName: "Synthetic", familyName: `Reader ${index}` },
          emails: [{ value: `reader${index}@example.test`, verified: true }],
          photos: [{ value: "https://example.test/provider.png" }],
          _raw: importSecret,
          _json: { private: importSecret },
        },
      },
    ],
    admin: index === 0,
    groupIds: index === 0 ? [ritual.group.toHexString()] : [],
    groupAdminIds: index === 1 ? [ritual.group] : [],
    ...(index === 0 ? { discourseId: Number.MAX_SAFE_INTEGER } : {}),
  }));
  const accounts: Record<string, unknown>[] = users.map((user, index) => ({
    _id: new ObjectId((200 + index).toString(16).padStart(24, "0")),
    userId: user._id,
    type: "oidc",
    provider: "google",
    providerAccountId: `subject-${index}`,
    access_token: importSecret,
    id_token: importSecret,
    refresh_token: importSecret,
    token_type: importSecret,
    scope: importSecret,
    expires_at: 1700000000,
  }));
  accounts.push({
    _id: "old-google-strategy",
    name: "google",
    type: "oauth2",
    oauth2: { clientSecret: importSecret },
  });
  const input: LegacyImportCollections = {
    users,
    accounts,
    sessions: [{ _id: importSecret, sessionToken: importSecret }],
    userGroups: [{ _id: ritual.group, name: "Synthetic group" }],
    temples: [
      {
        _id: ritual.temple,
        name: "Synthetic temple",
        slug: "synthetic-temple",
        joinPass: "preserved-private-invitation",
      },
    ],
    templeMemberships: [
      {
        _id: new ObjectId("000000000000000000000300"),
        userId: ritual.users[0],
        templeId: ritual.temple,
        grade: 0,
        admin: true,
        addedAt: new Date("2020-01-01T00:00:00.123Z"),
      },
    ],
    docs: ritual.input.rituals,
    docRevisions: ritual.input.revisions,
    studySet: study.input,
    files: [
      {
        _id: new ObjectId("000000000000000000000400"),
        sha256: "a".repeat(64),
        filename: "\uFEFF exact image.svg",
        mimeType: "image/svg+xml",
        size: 42,
        createdAt: new Date("2020-01-01T00:00:00.123Z"),
        type: "image",
        image: { format: "svg", size: 42, width: 8, height: 6 },
      },
    ],
  };
  const config: LegacyImportConfigV1 = {
    profile: "magickli-legacy-import-config-v1",
    files: {
      storageProvider: "synthetic-r2",
      sourceBucket: "synthetic-legacy",
      sourceObjectKeyPrefix: "synthetic-legacy/",
    },
    sourceForumOrigin: "https://forum.example.test",
    emptyStudyDuplicates: study.options().emptyDuplicates,
    unresolvedCreators: ritual.options().unresolvedCreators,
    receiptPolicy: "allow-reviewed-pre-bridge-absence",
  };
  let allocated = 0;
  const generateId = () =>
    `01993000-0000-7000-8000-${(++allocated).toString(16).padStart(12, "0")}`;
  const options = {
    importedAt: new Date("2026-09-13T12:34:56.789Z"),
    config,
    generateId,
  };
  return { input, options, ritual, study, users, accounts };
}
