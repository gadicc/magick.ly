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
  bundleSchema,
  clearRitualBundleFixture,
  type RitualBundleFixture,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import { rituals } from "../db/schema/rituals";
import { createUuidV7 } from "../lib/ids";
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

const request = () => ({
  expectedActorId: actorId!,
  ritualId: fixture.parent.id,
  expectedRevisionId: fixture.parent.currentRevisionId!,
  expectedVersion: fixture.parent.version,
});
const reader = () =>
  createSqlRitualPublicationSelectionReader(db, async () => actorId);

describe("SQL ritual publication selection", () => {
  it("returns the exact selected rendering only to its current editor", async () => {
    await expect(reader()(request())).resolves.toMatchObject({
      ritualId: fixture.parent.id,
      title: fixture.prepared.manifest.title,
      contentJson: fixture.contentJson,
      currentRevisionId: fixture.parent.currentRevisionId,
      version: fixture.parent.version,
      descriptor: fixture.prepared.manifest.descriptor,
    });
    actorId = fixture.actors.outsider;
    await expect(
      reader()({ ...request(), expectedActorId: actorId }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rechecks actor and current CAS state on every call", async () => {
    const load = reader();
    const original = request();
    await expect(load(original)).resolves.toBeTruthy();
    actorId = fixture.actors.global;
    await expect(load(original)).rejects.toMatchObject({
      code: "ACTOR_CHANGED",
    });
    actorId = fixture.actors.creator;
    await db
      .update(rituals)
      .set({ version: fixture.parent.version + 1 })
      .where(eq(rituals.id, fixture.parent.id));
    await expect(load(request())).rejects.toMatchObject({ code: "STALE" });
  });

  it("rejects malformed identities before session work", async () => {
    const actor = vi.fn(async () => actorId);
    const load = createSqlRitualPublicationSelectionReader(db, actor);
    await expect(
      load({ ...request(), ritualId: createUuidV7().toUpperCase() }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(actor).not.toHaveBeenCalled();
  });
});
