import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BUNDLE_FIXTURE_POLICY,
  BUNDLE_FIXTURE_TIME,
  bundleSchema,
  clearRitualBundleFixture,
  type RitualBundleFixture,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import { prepareRitualBundle } from "./prepareRitualBundle";
import { deriveRitualPublicationIdentity } from "./ritualPublicationIdentity";
import { createSqlRitualBundlePublisher } from "./sqlRitualBundlePublications";
import {
  createSqlRitualPublicationBackfillReader,
  createSqlRitualPublicationGlobalAdminChecker,
} from "./sqlRitualPublicationBackfill";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({ schema: bundleSchema });
const { db } = harness;
let fixture: RitualBundleFixture;
let actorId: string | null;

beforeEach(async () => {
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db, { images: false });
  actorId = fixture.actors.global;
});
afterEach(() => fixture.dispose());
afterAll(() => harness.client.close());

const reader = () =>
  createSqlRitualPublicationBackfillReader(db, async () => actorId, {
    publicationPolicyId: BUNDLE_FIXTURE_POLICY,
    now: () => BUNDLE_FIXTURE_TIME,
  });

async function reserve(operationId: string, ownerId: string) {
  const prepared = await prepareRitualBundle({
    ritualId: fixture.parent.id,
    title: fixture.prepared.manifest.title,
    contentJson: fixture.contentJson,
    descriptor: fixture.prepared.manifest.descriptor,
    plan: {
      metadata: fixture.prepared.plan,
      copyBytes: () => null,
      dispose: () => {},
    },
    identity: deriveRitualPublicationIdentity(operationId, 0),
  });
  try {
    await createSqlRitualBundlePublisher(db, async () => ownerId, {
      publicationPolicyId: BUNDLE_FIXTURE_POLICY,
      locations: ({ bundleId, asset }) => ({
        storageProvider: "r2:synthetic",
        bucket: "private-bucket",
        objectKey: `ritual-bundles/${bundleId}/${asset.key}`,
      }),
      now: () => BUNDLE_FIXTURE_TIME,
    }).initiate({ operationId, expectedActorId: ownerId }, prepared);
  } finally {
    prepared.dispose();
  }
}

describe("SQL ritual publication backfill discovery", () => {
  it("returns a bounded current-selection page only to a global admin", async () => {
    await expect(
      reader()({ expectedActorId: actorId!, afterRitualId: null }),
    ).resolves.toEqual({
      exhausted: true,
      candidates: [
        {
          ritualId: fixture.parent.id,
          currentRevisionId: fixture.parent.currentRevisionId,
          currentCompiledArtifactId: fixture.parent.currentCompiledArtifactId,
          version: fixture.parent.version,
          pendingOperationIds: [],
        },
      ],
    });
    actorId = fixture.actors.creator;
    await expect(
      reader()({ expectedActorId: actorId, afterRitualId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("discovers the stable operation of an unexpired matching SQL intent", async () => {
    const operationId = createUuidV7();
    await reserve(operationId, actorId!);
    const page = await reader()({
      expectedActorId: actorId!,
      afterRitualId: null,
    });
    expect(page.candidates[0].pendingOperationIds).toEqual([operationId]);
  });

  it("never offers another actor's publication intent for replay", async () => {
    await reserve(createUuidV7(), fixture.actors.creator);
    const page = await reader()({
      expectedActorId: actorId!,
      afterRitualId: null,
    });
    expect(page.candidates[0].pendingOperationIds).toEqual([]);
  });

  it("reads at most two matching own intents per candidate", async () => {
    const operationIds = [createUuidV7(), createUuidV7(), createUuidV7()];
    for (const operationId of operationIds)
      await reserve(operationId, actorId!);
    const page = await reader()({
      expectedActorId: actorId!,
      afterRitualId: null,
    });
    expect(page.candidates[0].pendingOperationIds).toEqual(
      operationIds.sort().slice(0, 2),
    );
  });

  it("rechecks the global grant independently before later backfill work", async () => {
    const authorize = createSqlRitualPublicationGlobalAdminChecker(
      db,
      async () => actorId,
    );
    await expect(authorize(actorId!)).resolves.toBeUndefined();
    await db
      .delete(userAccess)
      .where(eq(userAccess.userId, fixture.actors.global));
    await expect(authorize(actorId!)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
