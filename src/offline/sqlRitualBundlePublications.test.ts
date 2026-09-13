import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  type Mock,
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
import { templeMemberships, userGroupGrants } from "../db/schema/memberships";
import {
  ritualBundleAssets as assets,
  ritualBundlePublicationIntents as intents,
  ritualBundles as markers,
} from "../db/schema/ritualBundles";
import {
  ritualCompiledArtifacts,
  ritualRevisions,
  rituals,
} from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import { prepareRitualBundle } from "./prepareRitualBundle";
import { bundleTextSha256 as hash } from "./ritualBundlePublication";
import {
  createSqlRitualBundlePublisher,
  type RitualBundleOperation,
  type SqlRitualBundlePublicationDatabase,
} from "./sqlRitualBundlePublications";

vi.mock("server-only", () => ({}));
const h = await createMemoryPgliteHarness({ schema: bundleSchema });
const { db } = h;
let fixture: RitualBundleFixture;
let actorId: string | null;
let time: number;
let request: RitualBundleOperation;
let locations: Mock<
  Parameters<typeof createSqlRitualBundlePublisher>[2]["locations"]
>;
const extraPrepared: (typeof fixture.prepared)[] = [];
const publisher = (
  options: Partial<Parameters<typeof createSqlRitualBundlePublisher>[2]> = {},
  database: SqlRitualBundlePublicationDatabase = db,
  actor = async () => actorId,
) =>
  createSqlRitualBundlePublisher(database, actor, {
    publicationPolicyId: BUNDLE_FIXTURE_POLICY,
    locations,
    now: () => time,
    ...options,
  });
const state = async () => ({
  intents: await db.select().from(intents),
  assets: await db.select().from(assets),
  markers: await db.select().from(markers),
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db);
  actorId = fixture.actors.creator;
  time = BUNDLE_FIXTURE_TIME;
  request = { operationId: createUuidV7(), expectedActorId: actorId };
  locations = vi.fn(({ bundleId, asset }) => ({
    storageProvider: "r2-private",
    bucket: "synthetic-private",
    objectKey: `bundles/${bundleId}/${asset.key}`,
  }));
});
afterEach(() => {
  fixture.dispose();
  for (const value of extraPrepared.splice(0)) value.dispose();
});
afterAll(() => h.client.close());

async function start(service = publisher()) {
  const reserved = await service.initiate(request, fixture.prepared);
  expect(reserved.kind).toBe("reserved");
  const claimed = await service.claim(request);
  if (claimed.kind !== "claimed") throw new Error("Expected synthetic claim");
  return { service, claim: claimed.claim, reservation: claimed.reservation };
}

async function freshPrepared() {
  const previous = fixture.prepared;
  const value = await prepareRitualBundle({
    ritualId: fixture.parent.id,
    title: fixture.parent.title,
    contentJson: fixture.contentJson,
    descriptor: previous.manifest.descriptor,
    plan: {
      metadata: previous.plan,
      copyBytes: (index) =>
        previous.copyBytes(previous.manifest.assets[index].key),
      dispose() {},
    },
  });
  extraPrepared.push(value);
  return value;
}

async function setScope(scope: "public" | "group" | "temple", minGrade = 0) {
  await db
    .update(rituals)
    .set({
      scope,
      groupId: scope === "group" ? fixture.groupId : null,
      templeId: scope === "temple" ? fixture.templeId : null,
      minGrade: scope === "temple" ? minGrade : null,
    })
    .where(eq(rituals.id, fixture.parent.id));
}

it("reserves real PNG/SVG bytes before I/O, allocates once and atomically completes exact receipts", async () => {
  const service = publisher();
  const first = await service.initiate(request, fixture.prepared);
  const second = await service.initiate(request, fixture.prepared);
  expect(first.kind).toBe("reserved");
  expect(second).toEqual({ ...first, replayed: true });
  expect(locations).toHaveBeenCalledTimes(2);
  expect((await state()).markers).toEqual([]);
  const claimed = await service.claim(request);
  if (claimed.kind !== "claimed") throw new Error("Expected claim");
  expect(claimed.claim.assets.map((row) => row.mime)).toEqual([
    "image/png",
    "image/svg+xml",
  ]);
  expect(claimed.reservation.manifestJson).toBe(fixture.prepared.manifestJson);
  const receipts = bundleStorageReceipts(claimed.claim).reverse();
  const result = await service.publish(claimed.claim, receipts);
  const saved = await state();
  expect(saved.intents).toHaveLength(1);
  expect(saved.assets).toHaveLength(2);
  expect(saved.markers).toHaveLength(1);
  expect(saved.intents[0].completedAt?.getTime()).toBe(time);
  expect(saved.markers[0].publishedAt.getTime()).toBe(result.publishedAtMs);
  for (const row of saved.assets) {
    expect(row.receiptSha256).toBe(hash(row.receiptJson!));
    expect(JSON.parse(row.receiptJson!)).toEqual(
      receipts.find((entry) => entry.assetKey === row.key),
    );
  }
  expect(await service.initiate(request, fixture.prepared)).toEqual({
    kind: "completed",
    receipt: result,
  });
  expect(await service.claim(request)).toEqual({
    kind: "completed",
    receipt: result,
  });
  expect(await service.publish(claimed.claim, receipts)).toEqual(result);
  expect(locations).toHaveBeenCalledTimes(2);
});

it.each([
  ["public", "outsider", 0, true],
  ["group", "member", 0, true],
  ["group", "groupAdmin", 0, true],
  ["group", "creator", 0, true],
  ["group", "global", 0, true],
  ["group", "otherAdmin", 0, false],
  ["group", "outsider", 0, false],
  ["temple", "gradeZero", 0, true],
  ["temple", "gradeTwo", 2, true],
  ["temple", "gradeZero", 2, false],
  ["temple", "templeAdmin", 9, true],
  ["temple", "creator", 9, true],
  ["temple", "global", 9, true],
  ["temple", "otherAdmin", 0, false],
  ["temple", "outsider", 0, false],
] as const)(
  "reloads current read policy for %s/%s at grade %i",
  async (scope, role, grade, allowed) => {
    await setScope(scope, grade);
    actorId = fixture.actors[role];
    request.expectedActorId = actorId;
    if (allowed) {
      const { service, claim } = await start();
      await expect(
        service.publish(claim, bundleStorageReceipts(claim)),
      ).resolves.toMatchObject({ ritualId: fixture.parent.id });
    } else {
      await expect(
        publisher().initiate(request, fixture.prepared),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(locations).not.toHaveBeenCalled();
      expect(await state()).toEqual({ intents: [], assets: [], markers: [] });
    }
  },
);

it.each([null, "invalid", "550e8400-e29b-41d4-a716-446655440000"])(
  "rejects unverified actor %s before reserving",
  async (actor) => {
    actorId = actor;
    await expect(
      publisher().initiate(request, fixture.prepared),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(locations).not.toHaveBeenCalled();
    expect((await state()).intents).toEqual([]);
  },
);

it("requires a persisted actor and rejects request/session/owner mismatches", async () => {
  actorId = createUuidV7();
  request.expectedActorId = actorId;
  await expect(
    publisher().initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  actorId = fixture.actors.creator;
  await expect(
    publisher().initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "ACTOR_CHANGED" });
  request.expectedActorId = actorId;
  await publisher().initiate(request, fixture.prepared);
  actorId = fixture.actors.global;
  request.expectedActorId = actorId;
  await expect(publisher().claim(request)).rejects.toMatchObject({
    code: "ACTOR_CHANGED",
  });
  expect((await state()).intents).toHaveLength(1);
});

it.each(["operationId", "expectedActorId"] as const)(
  "rejects invalid %s before actor resolution",
  async (field) => {
    const actor = vi.fn(async () => actorId);
    await expect(
      publisher({}, db, actor).initiate(
        { ...request, [field]: "invalid" },
        fixture.prepared,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(actor).not.toHaveBeenCalled();
  },
);

it("snapshots request, prepared metadata and constructor policy before asynchronous work", async () => {
  const mutable = {
    ...fixture.prepared,
    manifest: structuredClone(fixture.prepared.manifest),
    plan: structuredClone(fixture.prepared.plan),
  };
  const original = { ...request };
  const options: Parameters<typeof createSqlRitualBundlePublisher>[2] = {
    publicationPolicyId: BUNDLE_FIXTURE_POLICY,
    locations,
    now: () => time,
  };
  const service = createSqlRitualBundlePublisher(
    db,
    async () => actorId,
    options,
  );
  const promise = service.initiate(request, mutable);
  request.operationId = createUuidV7();
  request.expectedActorId = fixture.actors.outsider;
  Reflect.set(mutable.manifest, "ritualId", createUuidV7());
  Reflect.set(mutable.plan, "contentSha256", "0".repeat(64));
  mutable.manifestJson = "{}";
  options.publicationPolicyId = "changed-policy";
  options.locations = vi.fn(() => {
    throw new Error("late factory");
  });
  const result = await promise;
  expect(result.kind).toBe("reserved");
  const row = (await state()).intents[0];
  expect(row.operationId).toBe(original.operationId);
  expect(row.actorId).toBe(original.expectedActorId);
  expect(row.manifestJson).toBe(fixture.prepared.manifestJson);
  expect(row.publicationPolicyId).toBe(BUNDLE_FIXTURE_POLICY);
});

it("serializes competing claims, fences replacements and ignores stale releases", async () => {
  const service = publisher();
  await service.initiate(request, fixture.prepared);
  const attempts = await Promise.allSettled([
    service.claim(request),
    service.claim(request),
  ]);
  expect(attempts.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  const won = attempts.find((row) => row.status === "fulfilled")!;
  if (won.status !== "fulfilled" || won.value.kind !== "claimed")
    throw new Error("Expected claim");
  const stale = won.value.claim;
  expect(attempts.find((row) => row.status === "rejected")).toMatchObject({
    reason: { code: "BUSY" },
  });
  time = stale.claimExpiresAtMs;
  const next = await service.claim(request);
  if (next.kind !== "claimed") throw new Error("Expected replacement");
  expect(next.claim.claimId).not.toBe(stale.claimId);
  await service.releaseClaim(stale);
  expect((await state()).intents[0].claimId).toBe(next.claim.claimId);
  await expect(
    service.publish(stale, bundleStorageReceipts(stale)),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  await service.releaseClaim(next.claim);
  expect((await state()).intents[0].claimId).toBeNull();
  const third = await service.claim(request);
  expect(third.kind).toBe("claimed");
});

it("clips the claim to immutable intent expiry and refuses future or expired operations", async () => {
  const service = publisher({ intentDurationMs: 1000 });
  await service.initiate(request, fixture.prepared);
  time += 900;
  const found = await service.claim(request);
  if (found.kind !== "claimed") throw new Error("Expected claim");
  expect(found.claim.claimExpiresAtMs).toBe(BUNDLE_FIXTURE_TIME + 1000);
  time = BUNDLE_FIXTURE_TIME + 1000;
  await expect(service.claim(request)).rejects.toMatchObject({
    code: "EXPIRED",
  });
  await expect(
    service.initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "EXPIRED" });
  await expect(
    service.publish(found.claim, bundleStorageReceipts(found.claim)),
  ).rejects.toMatchObject({ code: "EXPIRED" });
  time = BUNDLE_FIXTURE_TIME - 1;
  await expect(service.claim(request)).rejects.toMatchObject({
    code: "EXPIRED",
  });
});

it.each(["missing", "duplicate", "extra", "wrong-type"])(
  "rejects %s receipt collections without partial completion",
  async (kind) => {
    const { service, claim } = await start();
    const receipts = bundleStorageReceipts(claim);
    const input =
      kind === "missing"
        ? receipts.slice(1)
        : kind === "duplicate"
          ? [receipts[0], receipts[0]]
          : kind === "extra"
            ? [...receipts, receipts[0]]
            : {};
    const before = await state();
    await expect(service.publish(claim, input as never)).rejects.toMatchObject({
      code: "INCOMPLETE",
    });
    expect(await state()).toEqual(before);
  },
);

it.each([
  "profile",
  "operationId",
  "bundleId",
  "assetKey",
  "claimId",
  "storageProvider",
  "bucket",
  "objectKey",
  "sha256",
  "byteSize",
  "mime",
])("rejects altered storage receipt %s atomically", async (field) => {
  const { service, claim } = await start();
  const receipts = bundleStorageReceipts(claim);
  Reflect.set(
    receipts[1],
    field,
    field === "byteSize" ? receipts[1].byteSize + 1 : "wrong",
  );
  await expect(service.publish(claim, receipts)).rejects.toMatchObject({
    code: "INCOMPLETE",
  });
  const saved = await state();
  expect(saved.assets.every((row) => row.receiptJson === null)).toBe(true);
  expect(saved.intents[0].completedAt).toBeNull();
  expect(saved.markers).toEqual([]);
});

it.each(["before", "at-expiry", "future", "fractional"])(
  "rejects %s verification timestamps",
  async (kind) => {
    const { service, claim } = await start();
    const stamp =
      kind === "before"
        ? claim.claimStartedAtMs - 1
        : kind === "at-expiry"
          ? claim.claimExpiresAtMs
          : kind === "future"
            ? time + 1
            : time + 0.5;
    await expect(
      service.publish(claim, bundleStorageReceipts(claim, stamp)),
    ).rejects.toMatchObject({ code: "INCOMPLETE" });
    expect((await state()).markers).toEqual([]);
  },
);

it.each([
  "bundleId",
  "manifestSha256",
  "claimStartedAtMs",
  "claimExpiresAtMs",
  "intentExpiresAtMs",
  "assets",
])("requires the whole current claim: %s", async (field) => {
  const { service, claim } = await start();
  const altered = structuredClone(claim);
  Reflect.set(
    altered,
    field,
    field === "assets"
      ? []
      : typeof Reflect.get(altered, field) === "number"
        ? Reflect.get(altered, field) + 1
        : createUuidV7(),
  );
  await expect(
    service.publish(altered, bundleStorageReceipts(claim)),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  await service.releaseClaim(altered);
  expect((await state()).intents[0].claimId).toBe(claim.claimId);
});

it("snapshots receipt and claim inputs before session resolution", async () => {
  const { claim } = await start();
  const mutable = structuredClone(claim),
    receipts = bundleStorageReceipts(claim);
  let resume!: () => void;
  const barrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const service = publisher({}, db, async () => {
    await barrier;
    return actorId;
  });
  const promise = service.publish(mutable, receipts);
  mutable.assets[0].objectKey = "late";
  mutable.claimId = createUuidV7();
  receipts[0].sha256 = "a".repeat(64);
  resume();
  await expect(promise).resolves.toMatchObject({ bundleId: claim.bundleId });
});

it.each(["title", "version", "content", "artifact", "revision", "policy"])(
  "rejects a changed current %s on resume and publish",
  async (kind) => {
    const { service, claim } = await start();
    if (kind === "title") await db.update(rituals).set({ title: "new title" });
    if (kind === "version")
      await db.update(rituals).set({ version: fixture.parent.version + 1 });
    if (kind === "content")
      await db.update(ritualCompiledArtifacts).set({
        contentJson: '{"children":[]}',
        contentSha256: hash('{"children":[]}'),
      });
    if (kind === "artifact") {
      const [next] = await db
        .insert(ritualCompiledArtifacts)
        .values({ ...fixture.artifact, id: createUuidV7() })
        .returning();
      await db.update(rituals).set({ currentCompiledArtifactId: next.id });
    }
    if (kind === "revision") {
      const [next] = await db
        .insert(ritualRevisions)
        .values({ ...fixture.revision, id: createUuidV7() })
        .returning();
      const [compiled] = await db
        .insert(ritualCompiledArtifacts)
        .values({
          ...fixture.artifact,
          id: createUuidV7(),
          revisionId: next.id,
        })
        .returning();
      await db.update(rituals).set({
        currentRevisionId: next.id,
        currentCompiledArtifactId: compiled.id,
      });
    }
    const changed =
      kind === "policy"
        ? publisher({ publicationPolicyId: "new-policy" })
        : service;
    await expect(changed.claim(request)).rejects.toMatchObject({
      code: "STALE",
    });
    await expect(
      changed.publish(claim, bundleStorageReceipts(claim)),
    ).rejects.toMatchObject({ code: "STALE" });
    expect((await state()).markers).toEqual([]);
  },
);

it.each(["temple", "group", "global", "creator"])(
  "reloads revocation of %s authority after provider work",
  async (kind) => {
    if (kind === "group") await setScope("group");
    const grantActor =
      fixture.actors[
        kind === "temple" ? "gradeZero" : kind === "group" ? "member" : kind
      ];
    actorId = grantActor;
    request.expectedActorId = grantActor;
    const { service, claim } = await start();
    if (kind === "temple")
      await db
        .delete(templeMemberships)
        .where(eq(templeMemberships.userId, grantActor));
    if (kind === "group")
      await db
        .delete(userGroupGrants)
        .where(eq(userGroupGrants.userId, grantActor));
    if (kind === "global")
      await db.delete(userAccess).where(eq(userAccess.userId, grantActor));
    if (kind === "creator") await db.update(rituals).set({ creatorId: null });
    await expect(
      service.publish(claim, bundleStorageReceipts(claim)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await state()).markers).toEqual([]);
  },
);

it("replays completed work after expiry only under current selection and access", async () => {
  actorId = fixture.actors.gradeZero;
  request.expectedActorId = actorId;
  const { service, claim } = await start();
  const result = await service.publish(claim, bundleStorageReceipts(claim));
  const before = await state();
  time += 86_400_001;
  expect(await service.claim(request)).toEqual({
    kind: "completed",
    receipt: result,
  });
  expect(await service.initiate(request, fixture.prepared)).toEqual({
    kind: "completed",
    receipt: result,
  });
  expect(await service.publish(claim, [])).toEqual(result);
  await service.releaseClaim(claim);
  expect(await state()).toEqual(before);
  await db
    .delete(templeMemberships)
    .where(eq(templeMemberships.userId, actorId));
  await expect(service.claim(request)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it.each([true, false])(
  "never recreates a removed completed marker (images=%s)",
  async (images) => {
    if (!images) {
      fixture.dispose();
      await clearRitualBundleFixture(db);
      fixture = await seedRitualBundleFixture(db, { images: false });
      actorId = fixture.actors.creator;
      request.expectedActorId = actorId;
    }
    const { service, claim } = await start();
    await service.publish(claim, bundleStorageReceipts(claim));
    await db.delete(markers);
    const before = await state();
    await expect(
      service.initiate(request, fixture.prepared),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(service.claim(request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await expect(
      service.publish(claim, bundleStorageReceipts(claim)),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await service.releaseClaim(claim);
    expect(await state()).toEqual(before);
  },
);

it.each(["missing-asset", "unverified-asset", "marker-without-completion"])(
  "refuses inconsistent publication records: %s",
  async (kind) => {
    const { service, claim } = await start();
    if (kind !== "marker-without-completion")
      await service.publish(claim, bundleStorageReceipts(claim));
    if (kind === "missing-asset")
      await db.delete(assets).where(eq(assets.key, claim.assets[0].key));
    if (kind === "unverified-asset")
      await db
        .update(assets)
        .set({ receiptJson: null, receiptSha256: null, verifiedAt: null });
    if (kind === "marker-without-completion")
      await db.insert(markers).values({
        bundleId: claim.bundleId,
        operationId: claim.operationId,
        ritualId: claim.ritualId,
        currentRevisionId: fixture.revision.id,
        publishedAt: new Date(time),
      });
    await expect(service.claim(request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  },
);

it("reserves identical content independently but rejects operation, bundle and destination collisions", async () => {
  const service = publisher();
  await service.initiate(request, fixture.prepared);
  const next = await freshPrepared();
  await expect(service.initiate(request, next)).rejects.toMatchObject({
    code: "OPERATION_CONFLICT",
  });
  await expect(
    service.initiate(
      { ...request, operationId: createUuidV7() },
      fixture.prepared,
    ),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  const second = { ...request, operationId: createUuidV7() };
  await service.initiate(second, next);
  expect((await state()).intents).toHaveLength(2);
  const rows = (await state()).assets;
  expect(new Set(rows.map((row) => row.sha256)).size).toBe(2);
  expect(rows).toHaveLength(4);
  const third = await freshPrepared();
  await expect(
    publisher({
      locations: () => ({
        storageProvider: rows[0].storageProvider,
        bucket: rows[0].bucket,
        objectKey: rows[0].objectKey,
      }),
    }).initiate({ ...request, operationId: createUuidV7() }, third),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect((await state()).intents).toHaveLength(2);
});

it.each(["rollback", "abort-before-commit", "lost-ack", "abort-after-commit"])(
  "handles %s without partial or duplicate publication",
  async (kind) => {
    const { claim } = await start();
    const signal = new AbortController();
    const fault: SqlRitualBundlePublicationDatabase = {
      transaction: async (work, config) => {
        const result = await db.transaction(async (tx) => {
          const value = await work(tx);
          if (kind === "rollback")
            throw new Error("synthetic private database detail");
          if (kind === "abort-before-commit") {
            signal.abort();
            throw new Error("aborted commit");
          }
          return value;
        }, config);
        if (kind === "abort-after-commit") signal.abort();
        if (kind === "lost-ack")
          throw new Error("synthetic lost acknowledgement");
        return result;
      },
    };
    await expect(
      publisher({}, fault).publish(
        claim,
        bundleStorageReceipts(claim),
        signal.signal,
      ),
    ).rejects.toMatchObject({
      code: kind === "abort-after-commit" ? "ABORTED" : "UNAVAILABLE",
    });
    const committed = kind === "lost-ack" || kind === "abort-after-commit";
    const saved = await state();
    expect(saved.markers).toHaveLength(committed ? 1 : 0);
    expect(saved.assets.every((row) => row.receiptJson !== null)).toBe(
      committed,
    );
    const replayed = await publisher().publish(
      claim,
      bundleStorageReceipts(claim),
    );
    expect(replayed.bundleId).toBe(claim.bundleId);
    expect((await state()).markers).toHaveLength(1);
  },
);

it("checks cancellation before input work and after actor resolution", async () => {
  const actor = vi.fn(async () => actorId);
  await expect(
    publisher({}, db, actor).initiate(
      request,
      fixture.prepared,
      AbortSignal.abort(),
    ),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect(actor).not.toHaveBeenCalled();
  const controller = new AbortController();
  await expect(
    publisher({}, db, async () => {
      controller.abort();
      return actorId;
    }).initiate(request, fixture.prepared, controller.signal),
  ).rejects.toMatchObject({ code: "ABORTED" });
  expect((await state()).intents).toEqual([]);
});

it("rolls back receipt writes if the clock expires before the commit", async () => {
  const { claim } = await start();
  let calls = 0;
  await expect(
    publisher({
      now: () => (calls++ === 0 ? time : claim.claimExpiresAtMs),
    }).publish(claim, bundleStorageReceipts(claim)),
  ).rejects.toMatchObject({ code: "EXPIRED" });
  const saved = await state();
  expect(saved.assets.every((row) => row.receiptJson === null)).toBe(true);
  expect(saved.intents[0].completedAt).toBeNull();
  expect(saved.markers).toEqual([]);
});

/** Execute real SQL, then advance the synthetic clock before its await resumes. */
function afterSql<T extends object>(query: T, after: () => void): T {
  return new Proxy(query, {
    get(target, key) {
      const method = Reflect.get(target, key);
      if (typeof method !== "function") return method;
      if (key === "then")
        return (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(target as unknown as PromiseLike<unknown>)
            .then((value) => {
              after();
              return value;
            })
            .then(resolve, reject);
      return (...args: unknown[]) => {
        const value = Reflect.apply(method, target, args);
        return value && typeof value === "object"
          ? afterSql(value, after)
          : value;
      };
    },
  });
}
function clockAfterWrite(
  action: "insert" | "update",
  table: typeof intents | typeof assets | typeof markers,
  timeAfter: number,
): SqlRitualBundlePublicationDatabase {
  return {
    transaction: (work, config) =>
      db.transaction(
        (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                const method = Reflect.get(target, key);
                if (typeof method !== "function") return method;
                if (key !== action) return method.bind(target);
                return (selected: unknown, ...args: unknown[]) => {
                  const query = Reflect.apply(method, target, [
                    selected,
                    ...args,
                  ]);
                  return selected === table &&
                    query &&
                    typeof query === "object"
                    ? afterSql(query, () => {
                        time = timeAfter;
                      })
                    : query;
                };
              },
            }),
          ),
        config,
      ),
  };
}

it.each([
  ["initiate", "expiry"],
  ["initiate", "clock rollback"],
  ["claim", "expiry"],
  ["claim", "clock rollback"],
  ["publish", "expiry"],
  ["publish", "clock rollback"],
] as const)(
  "rolls back %s when %s crosses its final awaited write",
  async (phase, condition) => {
    const service = publisher();
    if (phase !== "initiate") await service.initiate(request, fixture.prepared);
    const current = phase === "publish" ? await service.claim(request) : null;
    if (current && current.kind !== "claimed")
      throw new Error("Expected synthetic claim");
    const deadline = phase === "initiate" ? time + 86_400_000 : time + 120_000;
    const database = clockAfterWrite(
      phase === "claim" ? "update" : "insert",
      phase === "initiate" ? assets : phase === "claim" ? intents : markers,
      condition === "expiry" ? deadline : time - 1,
    );
    const before = await state();
    const pending =
      phase === "initiate"
        ? publisher({}, database).initiate(request, fixture.prepared)
        : phase === "claim"
          ? publisher({}, database).claim(request)
          : publisher({}, database).publish(
              current!.claim,
              bundleStorageReceipts(current!.claim),
            );
    await expect(pending).rejects.toMatchObject({ code: "EXPIRED" });
    expect(await state()).toEqual(before);
  },
);

it("rejects expiry after an image-free reservation write without retaining an unusable intent", async () => {
  fixture.dispose();
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db, { images: false });
  actorId = fixture.actors.creator;
  request.expectedActorId = actorId;
  await expect(
    publisher(
      {},
      clockAfterWrite("insert", intents, time + 86_400_000),
    ).initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "EXPIRED" });
  expect(await state()).toEqual({ intents: [], assets: [], markers: [] });
});

it("keeps exact completed recovery available after intent and worker deadlines", async () => {
  const { service, claim } = await start();
  const receipt = await service.publish(claim, bundleStorageReceipts(claim));
  const before = await state();
  time = claim.intentExpiresAtMs + 1;
  expect(await service.initiate(request, fixture.prepared)).toEqual({
    kind: "completed",
    receipt,
  });
  expect(await service.claim(request)).toEqual({ kind: "completed", receipt });
  expect(await service.publish(claim, bundleStorageReceipts(claim))).toEqual(
    receipt,
  );
  expect(await state()).toEqual(before);
});

it.each(["55P03", "40P01", "23505", "40001", "unknown"])(
  "maps SQL failure %s without exposing private details",
  async (code) => {
    const database: SqlRitualBundlePublicationDatabase = {
      transaction: async () => {
        throw Object.assign(new Error("private SQL detail"), {
          cause: { code },
        });
      },
    };
    await expect(
      publisher({}, database).initiate(request, fixture.prepared),
    ).rejects.toMatchObject({
      code:
        code === "55P03" || code === "40P01"
          ? "BUSY"
          : code === "23505"
            ? "OPERATION_CONFLICT"
            : "UNAVAILABLE",
      message:
        code === "55P03" || code === "40P01"
          ? "BUSY"
          : code === "23505"
            ? "OPERATION_CONFLICT"
            : "UNAVAILABLE",
    });
  },
);

it.each([
  { publicationPolicyId: "" },
  { publicationPolicyId: "UPPERCASE" },
  { locations: null },
  { intentDurationMs: 0 },
  { intentDurationMs: -1 },
  { intentDurationMs: 86_400_001 },
  { claimDurationMs: 0 },
  { claimDurationMs: 120_001 },
  { claimDurationMs: 0.5 },
])("refuses unsupported timing/policy configuration (case %#)", (options) => {
  expect(() => publisher(options as never)).toThrow(
    "Invalid bundle publication configuration",
  );
});

it.each([
  null,
  [],
  {},
  { storageProvider: "r2-private", bucket: "synthetic-private", objectKey: "" },
  { storageProvider: " ", bucket: "synthetic-private", objectKey: "key" },
  {
    storageProvider: "r2-private",
    bucket: "synthetic-private",
    objectKey: "\ud800",
  },
  {
    storageProvider: "r2-private",
    bucket: "synthetic-private",
    objectKey: "nul\0key",
  },
  {
    storageProvider: "r2-private",
    bucket: "synthetic-private",
    objectKey: "é".repeat(513),
  },
])(
  "refuses an invalid destination before reservation (case %#)",
  async (destination) => {
    await expect(
      publisher({ locations: () => destination as never }).initiate(
        request,
        fixture.prepared,
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await state()).toEqual({ intents: [], assets: [], markers: [] });
  },
);

it("preserves opaque BOM/Unicode location fields across reservation replay and publication", async () => {
  const service = publisher({
    locations: ({ asset }) => ({
      storageProvider: "\uFEFFr2",
      bucket: "\uFEFFbucket",
      objectKey: `\uFEFFe\u0301/é/${asset.key}`,
    }),
  });
  const { claim } = await start(service);
  expect(claim.assets[0].storageProvider).toBe("\uFEFFr2");
  expect(claim.assets[0].bucket).toBe("\uFEFFbucket");
  expect(claim.assets[0].objectKey.startsWith("\uFEFFe\u0301/é/")).toBe(true);
  const result = await service.publish(claim, bundleStorageReceipts(claim));
  expect(await service.claim(request)).toEqual({
    kind: "completed",
    receipt: result,
  });
});

it.each(["kind", "plan-hash", "plan-budget", "manifest", "plan-facts"])(
  "rejects malformed prepared evidence: %s",
  async (kind) => {
    const supplied = {
      ...fixture.prepared,
      plan: structuredClone(fixture.prepared.plan),
    };
    if (kind === "kind") Reflect.set(supplied, "kind", "ready");
    if (kind === "plan-hash")
      Reflect.set(supplied.plan, "sha256", "a".repeat(64));
    if (kind === "plan-budget")
      Reflect.set(supplied.plan, "extra", "x".repeat(16 * 1024 * 1024));
    if (kind === "manifest") supplied.manifestJson = "{}";
    if (kind === "plan-facts") {
      Reflect.set(supplied.plan.assets[0], "width", 0);
      const { sha256: _sha, ...identity } = supplied.plan;
      Reflect.set(supplied.plan, "sha256", hash(JSON.stringify(identity)));
    }
    await expect(publisher().initiate(request, supplied)).rejects.toMatchObject(
      { code: "INVALID_REQUEST" },
    );
    expect((await state()).intents).toEqual([]);
  },
);

it("requires an existing active claim and rejects its expiry before intent expiry", async () => {
  const { service, claim } = await start();
  time = claim.claimExpiresAtMs;
  await expect(
    service.publish(claim, bundleStorageReceipts(claim)),
  ).rejects.toMatchObject({ code: "EXPIRED" });
  await service.releaseClaim(claim);
  await expect(
    service.publish(claim, bundleStorageReceipts(claim)),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const unknown = { ...request, operationId: createUuidV7() };
  await expect(service.claim(unknown)).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(
    service.releaseClaim({ ...claim, operationId: unknown.operationId }),
  ).resolves.toBeUndefined();
});

it("does not expose a deleted parent or an unfinished current shell", async () => {
  const service = publisher();
  await service.initiate(request, fixture.prepared);
  await db
    .update(rituals)
    .set({ currentRevisionId: null, currentCompiledArtifactId: null });
  await expect(service.claim(request)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await db.delete(ritualCompiledArtifacts);
  await db.delete(ritualRevisions);
  await db.delete(rituals);
  await expect(service.claim(request)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect((await state()).intents).toHaveLength(1);
  expect((await state()).markers).toEqual([]);
});

it("rolls back a new intent if its otherwise valid destination batch collides with an earlier operation", async () => {
  await publisher().initiate(request, fixture.prepared);
  const first = (await state()).assets[0];
  const next = await freshPrepared();
  let calls = 0;
  const service = publisher({
    locations: ({ asset }) => ({
      storageProvider: first.storageProvider,
      bucket: first.bucket,
      objectKey: calls++ === 0 ? first.objectKey : `new/${asset.key}`,
    }),
  });
  await expect(
    service.initiate({ ...request, operationId: createUuidV7() }, next),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  expect((await state()).intents).toHaveLength(1);
  expect((await state()).assets).toHaveLength(2);
});

it.each([NaN, -1, 0.5, 8_640_000_000_000_000])(
  "rejects unusable current clock %s before persistence",
  async (value) => {
    await expect(
      publisher({ now: () => value }).initiate(request, fixture.prepared),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await state()).intents).toEqual([]);
  },
);

it("projects unexpected actor/provider failures without leaking exception details", async () => {
  await expect(
    publisher({}, db, async () => {
      throw new Error("synthetic private auth detail");
    }).initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  await expect(
    publisher({
      locations: () => {
        throw new Error("synthetic private provider detail");
      },
    }).initiate(request, fixture.prepared),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", message: "UNAVAILABLE" });
  expect((await state()).intents).toEqual([]);
});
