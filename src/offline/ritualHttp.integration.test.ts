import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  BUNDLE_FIXTURE_POLICY,
  BUNDLE_FIXTURE_TIME,
  bundleSchema,
  clearRitualBundleFixture,
  type RitualBundleFixture,
  ritualBundleFixtureRecords,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import { userGroupGrants } from "../db/schema/memberships";
import {
  ritualBundleAssets,
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../db/schema/ritualBundles";
import { readRitualBundleAsset } from "./readRitualBundleAsset";
import { createRitualHttpHandlers } from "./ritualHttp";
import { createSqlRitualPermissionChecker } from "./sqlPermissionCheck";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({ schema: bundleSchema });
const db = drizzle(harness.client, { schema: bundleSchema });
const ROUTE_ALIAS = "0123456789abcdef01234567";
let fixture: RitualBundleFixture;
let records: ReturnType<typeof ritualBundleFixtureRecords>;

beforeAll(async () => {
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db, { scope: "group" });
  records = ritualBundleFixtureRecords(fixture, { completed: true });
  await db.insert(ritualBundlePublicationIntents).values(records.intent);
  if (records.rows.length)
    await db.insert(ritualBundleAssets).values(records.rows);
  await db.insert(ritualBundles).values(records.marker!);
});

afterAll(async () => {
  fixture.dispose();
  await harness.client.close();
});

function services(actorId: string) {
  const actor = async () => actorId;
  const reader = createSqlRitualBundleReader(db, actor, {
    acceptedPublicationPolicyIds: [BUNDLE_FIXTURE_POLICY],
  });
  return createRitualHttpHandlers({
    resolveRouteAlias: async (alias) =>
      alias === ROUTE_ALIAS ? fixture.parent.id : null,
    checkPermission: createSqlRitualPermissionChecker(db, actor, {
      now: () => BUNDLE_FIXTURE_TIME,
    }),
    getManifest: reader.getManifest,
    readAsset: (input, signal) =>
      readRitualBundleAsset(
        reader,
        {
          readAsset: async (asset) =>
            fixture.prepared.copyBytes(asset.assetKey),
        },
        input,
        { signal },
      ),
  });
}

it("delivers one current SQL permission and manifest envelope", async () => {
  const actorId = fixture.actors.creator;
  const body = {
    version: 1,
    requestId: "019947c5-abcd-7000-8000-000000000001",
    expectedActorId: actorId,
    ritualId: fixture.parent.id,
  };
  const response = await services(actorId).permission(
    new Request("https://synthetic.example/api/rituals/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const delivery = await response.json();
  expect(delivery).toMatchObject({
    version: 1,
    requestId: body.requestId,
    ownerId: actorId,
    ritualId: fixture.parent.id,
    permission: {
      kind: "granted",
      ownerId: actorId,
      rendered: { kind: "available" },
    },
    bundle: {
      bundleId: records.intent.bundleId,
      manifestSha256: records.intent.manifestSha256,
    },
  });
  expect(delivery.bundle.manifestJson).toBe(records.intent.manifestJson);
});

it("echoes only an alias resolved to the requested canonical ritual", async () => {
  const actorId = fixture.actors.creator;
  const body = {
    version: 1,
    requestId: "019947c5-abcd-7000-8000-000000000002",
    expectedActorId: actorId,
    ritualId: fixture.parent.id,
  };
  const response = await services(actorId).permission(
    new Request("https://synthetic.example/api/rituals/permission", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Magickli-Ritual-Alias": ROUTE_ALIAS,
      },
      body: JSON.stringify(body),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ritualId: fixture.parent.id,
    routeAlias: ROUTE_ALIAS,
  });
});

it("does not renew an editor lease when access is revoked during manifest lookup", async () => {
  const actorId = fixture.actors.groupAdmin;
  const actor = async () => actorId;
  const grants = await db
    .select()
    .from(userGroupGrants)
    .where(eq(userGroupGrants.userId, actorId));
  const reader = createSqlRitualBundleReader(db, actor, {
    acceptedPublicationPolicyIds: [BUNDLE_FIXTURE_POLICY],
  });
  const handlers = createRitualHttpHandlers({
    resolveRouteAlias: async () => null,
    checkPermission: createSqlRitualPermissionChecker(db, actor, {
      now: () => BUNDLE_FIXTURE_TIME,
    }),
    getManifest: async (input) => {
      const manifest = await reader.getManifest(input);
      expect(manifest).not.toBeNull();
      await db
        .delete(userGroupGrants)
        .where(eq(userGroupGrants.userId, actorId));
      return manifest;
    },
    readAsset: async () => null,
  });
  try {
    const response = await handlers.permission(
      new Request("https://synthetic.example/api/rituals/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 1,
          requestId: "019947c5-abcd-7000-8000-000000000003",
          expectedActorId: actorId,
          ritualId: fixture.parent.id,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      permission: { kind: "denied" },
      bundle: null,
    });
  } finally {
    await db.insert(userGroupGrants).values(grants);
  }
});

it("returns exact bytes only through a current SQL asset binding", async () => {
  const actorId = fixture.actors.creator;
  const row = records.rows[0];
  const path = `/api/rituals/assets/${fixture.parent.id}/${records.intent.bundleId}/${row.key}`;
  const response = await services(actorId).asset(
    new Request(`https://synthetic.example${path}`, {
      headers: { "X-Magickli-Expected-Actor": actorId },
    }),
    {
      expectedActorId: actorId,
      ritualId: fixture.parent.id,
      bundleId: records.intent.bundleId,
      assetKey: row.key,
    },
  );
  const expected = fixture.prepared.copyBytes(row.key)!;
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-content-sha256")).toBe(row.sha256);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);

  const denied = await services(fixture.actors.outsider).asset(
    new Request(`https://synthetic.example${path}`, {
      headers: { "X-Magickli-Expected-Actor": fixture.actors.outsider },
    }),
    {
      expectedActorId: fixture.actors.outsider,
      ritualId: fixture.parent.id,
      bundleId: records.intent.bundleId,
      assetKey: row.key,
    },
  );
  expect(denied.status).toBe(404);
});
