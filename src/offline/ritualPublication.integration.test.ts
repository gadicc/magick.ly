import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
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
  bundleStorageReceipts,
  clearRitualBundleFixture,
  type RitualBundleFixture,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import {
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../db/schema/ritualBundles";
import { createUuidV7 } from "../lib/ids";
import { createRitualPublicationService } from "./ritualPublicationService";
import { createSqlRitualBundlePublisher } from "./sqlRitualBundlePublications";
import { createSqlRitualPublicationSelectionReader } from "./sqlRitualPublicationSelection";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({ schema: bundleSchema });
const { db } = harness;
let fixture: RitualBundleFixture;
let actorId: string | null;

beforeEach(async () => {
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db);
  actorId = fixture.actors.creator;
});
afterEach(() => fixture.dispose());
afterAll(() => harness.client.close());

describe("complete SQL ritual publication pipeline", () => {
  it("persists intent before provider work, publishes exact receipts and replays", async () => {
    const operationId = createUuidV7();
    const events: string[] = [];
    const publisher = createSqlRitualBundlePublisher(db, async () => actorId, {
      publicationPolicyId: BUNDLE_FIXTURE_POLICY,
      locations: ({ bundleId, asset }) => ({
        storageProvider: "r2:synthetic",
        bucket: "private-bucket",
        objectKey: `ritual-bundles/${bundleId}/${asset.key}`,
      }),
      now: () => BUNDLE_FIXTURE_TIME,
    });
    const publish = createRitualPublicationService({
      loadSelection: createSqlRitualPublicationSelectionReader(
        db,
        async () => actorId,
      ),
      buildPrepared: async () => fixture.prepared,
      publisher,
      storage: {
        ensureAsset: vi.fn(async ({ claim, assetKey }) => {
          events.push("provider");
          const intents = await db
            .select()
            .from(ritualBundlePublicationIntents);
          expect(intents).toHaveLength(1);
          expect(intents[0].claimId).toBe(claim.claimId);
          return bundleStorageReceipts(claim).find(
            (receipt) => receipt.assetKey === assetKey,
          )!;
        }),
      },
    });
    const request = {
      version: 1,
      operationId,
      expectedActorId: actorId,
      ritualId: fixture.parent.id,
      expectedRevisionId: fixture.parent.currentRevisionId,
      expectedVersion: fixture.parent.version,
    };
    const first = await publish(request);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(events).toEqual(["provider", "provider"]);
    expect(await db.select().from(ritualBundles)).toHaveLength(1);
    events.length = 0;
    await expect(publish(request)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      receipt: first.ok ? first.receipt : {},
    });
    expect(events).toEqual([]);
  });
});
