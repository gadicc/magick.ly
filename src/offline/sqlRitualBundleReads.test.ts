import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
  ritualBundleFixtureRecords,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import { user } from "../db/schema/auth";
import { templeMemberships, userGroupGrants } from "../db/schema/memberships";
import {
  ritualBundleAssets as assets,
  ritualBundles as bundles,
  ritualBundlePublicationIntents as intents,
} from "../db/schema/ritualBundles";
import { ritualCompiledArtifacts, rituals } from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { RITUAL_SVG_LIMITS } from "../files/validateRitualSvg";
import { createUuidV7 } from "../lib/ids";
import {
  bundleTextSha256,
  ritualBundleRequestHash,
} from "./ritualBundlePublication";
import { decodeRitualBundleRecords } from "./ritualBundleRecords";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({ schema: bundleSchema });
const queries: string[] = [];
const db = drizzle(harness.client, {
  schema: bundleSchema,
  logger: { logQuery: (query) => queries.push(query) },
});
afterAll(() => harness.client.close());
afterEach(() => vi.restoreAllMocks());
let fixture: Awaited<ReturnType<typeof seedRitualBundleFixture>>;
let saved: ReturnType<typeof ritualBundleFixtureRecords>;

beforeEach(async () => {
  fixture?.dispose();
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db, { scope: "group" });
  saved = ritualBundleFixtureRecords(fixture, { completed: true });
  await insert(saved);
  queries.length = 0;
});
afterAll(() => fixture?.dispose());

async function insert(value: typeof saved) {
  await db.insert(intents).values(value.intent);
  if (value.rows.length) await db.insert(assets).values(value.rows);
  if (value.marker) await db.insert(bundles).values(value.marker);
}
const input = (who: keyof typeof fixture.actors = "creator") => ({
  expectedActorId: fixture.actors[who],
  ritualId: fixture.parent.id,
});
const reader = (
  who: keyof typeof fixture.actors | null = "creator",
  database: SqlRitualReadDatabase = db,
  policies: readonly string[] = [saved.intent.publicationPolicyId],
) =>
  createSqlRitualBundleReader(
    database,
    async () => (who === null ? null : fixture.actors[who]),
    {
      acceptedPublicationPolicyIds: policies,
    },
  );
const assetInput = () => ({
  ...input(),
  bundleId: saved.intent.bundleId,
  assetKey: saved.rows[0].key,
});

type MutablePlan = {
  [key: string]: unknown;
  assets: Record<string, unknown>[];
  occurrences: Record<string, unknown>[];
  issues: unknown[];
};
function updatePlan(value: typeof saved, mutate: (plan: MutablePlan) => void) {
  const plan = JSON.parse(value.intent.planJson);
  mutate(plan);
  value.intent.planJson = JSON.stringify(plan);
  value.intent.planSha256 = bundleTextSha256(value.intent.planJson);
  value.intent.requestHash = ritualBundleRequestHash(value.intent);
}
function updateReceipt(
  row: (typeof saved.rows)[number],
  mutate: (receipt: Record<string, unknown>) => void,
) {
  const receipt = JSON.parse(row.receiptJson!);
  mutate(receipt);
  row.receiptJson = JSON.stringify(receipt);
  row.receiptSha256 = bundleTextSha256(row.receiptJson);
}
function freshPublication(
  value: typeof saved,
  offset = 1,
  policy = value.intent.publicationPolicyId,
) {
  const next = structuredClone(value);
  next.intent.operationId = createUuidV7();
  next.intent.bundleId = createUuidV7();
  next.intent.publicationPolicyId = policy;
  next.intent.completedAt = new Date(
    next.intent.completedAt!.getTime() + offset,
  );
  next.marker = {
    ...next.marker!,
    operationId: next.intent.operationId,
    bundleId: next.intent.bundleId,
    publishedAt: next.intent.completedAt,
  };
  const manifest = JSON.parse(next.intent.manifestJson);
  manifest.bundleId = next.intent.bundleId;
  next.intent.manifestJson = JSON.stringify(manifest);
  next.intent.manifestSha256 = bundleTextSha256(next.intent.manifestJson);
  next.intent.requestHash = ritualBundleRequestHash(next.intent);
  for (const row of next.rows) {
    row.operationId = next.intent.operationId;
    row.bundleId = next.intent.bundleId;
    row.objectKey = `bundles/${row.bundleId}/${row.key}`;
    updateReceipt(row, (receipt) =>
      Object.assign(receipt, {
        operationId: row.operationId,
        bundleId: row.bundleId,
        objectKey: row.objectKey,
      }),
    );
  }
  return next;
}

describe("completed bundle current-access reads", () => {
  it("preserves completed historical v4/v2 publications after the private-file upgrade", async () => {
    const historical = structuredClone(saved);
    updatePlan(historical, (plan) => {
      plan.profile = "magickli-ritual-asset-plan-v4";
      plan.inventoryProfile = "magickli-jrt-assets-v2";
      delete plan.privateCatalogSha256;
    });
    await db
      .update(intents)
      .set(historical.intent)
      .where(eq(intents.operationId, saved.intent.operationId));
    const result = await reader().getManifest(input());
    expect(result?.manifest.bundleId).toBe(saved.intent.bundleId);
    expect((await reader().getAsset(assetInput()))?.location).toEqual({
      provider: saved.rows[0].storageProvider,
      bucket: saved.rows[0].bucket,
      objectKey: saved.rows[0].objectKey,
    });
    const [persisted] = await db
      .select()
      .from(intents)
      .where(eq(intents.operationId, saved.intent.operationId));
    expect(persisted.planJson).toBe(historical.intent.planJson);
    expect(persisted.planSha256).toBe(historical.intent.planSha256);
  });

  it("rejects mixed historical/current plan contracts at the SQL boundary", async () => {
    const mutations = [
      (plan: MutablePlan) => {
        plan.profile = "magickli-ritual-asset-plan-v4";
      },
      (plan: MutablePlan) => {
        plan.inventoryProfile = "magickli-jrt-assets-v2";
      },
      (plan: MutablePlan) => {
        delete plan.privateCatalogSha256;
      },
      (plan: MutablePlan) => {
        plan.profile = "magickli-ritual-asset-plan-v4";
        plan.inventoryProfile = "magickli-jrt-assets-v2";
      },
    ];
    for (const mutate of mutations) {
      const invalid = structuredClone(saved);
      updatePlan(invalid, mutate);
      await expect(
        db
          .update(intents)
          .set(invalid.intent)
          .where(eq(intents.operationId, saved.intent.operationId)),
      ).rejects.toThrow();
    }
    expect((await reader().getManifest(input()))?.manifest.bundleId).toBe(
      saved.intent.bundleId,
    );
  });

  it("treats expired, noncanonical and removed signed-in identities as unavailable", async () => {
    const missing = createUuidV7();
    for (const actor of [
      null,
      "invalid",
      fixture.actors.creator.toUpperCase(),
      missing,
    ]) {
      queries.length = 0;
      const service = createSqlRitualBundleReader(db, async () => actor, {
        acceptedPublicationPolicyIds: [saved.intent.publicationPolicyId],
      });
      expect(
        await service.getManifest({
          ...input(),
          expectedActorId:
            actor === missing ? missing : input().expectedActorId,
        }),
      ).toBeNull();
      if (actor !== missing) expect(queries).toEqual([]);
    }
    await db
      .delete(userGroupGrants)
      .where(eq(userGroupGrants.userId, fixture.actors.member));
    await db.delete(user).where(eq(user.id, fixture.actors.member));
    expect(await reader("member").getManifest(input("member"))).toBeNull();
  });
  it("rejects malformed requests without invoking identity verification or SQL", async () => {
    const verify = vi.fn(async () => fixture.actors.creator);
    const service = createSqlRitualBundleReader(db, verify, {
      acceptedPublicationPolicyIds: [saved.intent.publicationPolicyId],
    });
    const hostile = {
      ...input(),
      get bundleId() {
        throw new Error("must not invoke");
      },
    };
    for (const request of [
      null,
      [],
      {},
      "invalid",
      { ...input(), extra: true },
      { ...input(), ritualId: "invalid" },
      { ...input(), bundleId: "" },
      { ...input(), [Symbol("secret")]: 1 },
      hostile,
      Object.create(input()),
      Object.defineProperty({ ...input() }, "bundleId", {
        value: createUuidV7(),
        enumerable: false,
      }),
    ])
      expect(
        await service.getManifest(
          request as Parameters<typeof service.getManifest>[0],
        ),
      ).toBeNull();
    for (const request of [
      input(),
      { ...assetInput(), assetKey: "invalid" },
      { ...assetInput(), bundleId: undefined },
    ])
      expect(
        await service.getAsset(
          request as Parameters<typeof service.getAsset>[0],
        ),
      ).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });
  it("snapshots accepted policies and fails closed for empty or invalid configuration", async () => {
    const policies = [saved.intent.publicationPolicyId];
    const service = reader("creator", db, policies);
    policies[0] = "changed";
    expect(await service.getManifest(input())).not.toBeNull();
    queries.length = 0;
    expect(await reader("creator", db, []).getManifest(input())).toBeNull();
    expect(queries).toEqual([]);
    for (const invalid of [
      ["bad policy"],
      new Array(1),
      new Array(33).fill("valid"),
    ])
      expect(() => reader("creator", db, invalid)).toThrow(RangeError);
  });
  it("returns null for safe operational failures without exposing raw diagnostics", async () => {
    const fail = async () => {
      throw new Error("private diagnostic sentinel");
    };
    expect(
      await createSqlRitualBundleReader(db, fail, {
        acceptedPublicationPolicyIds: [saved.intent.publicationPolicyId],
      }).getManifest(input()),
    ).toBeNull();
    const broken: SqlRitualReadDatabase = { transaction: fail };
    expect(await reader("creator", broken).getAsset(assetInput())).toBeNull();
  });
  it.each(["creator", "global", "member", "groupAdmin"] as const)(
    "allows current group access for %s",
    async (who) => {
      const result = await reader(who).getManifest(input(who));
      expect(result?.manifestJson).toBe(saved.intent.manifestJson);
      expect(result?.manifestSha256).toBe(saved.intent.manifestSha256);
    },
  );
  it.each([
    "outsider",
    "otherAdmin",
    "gradeZero",
    "gradeTwo",
    "templeAdmin",
  ] as const)(
    "rejects unrelated grants for %s before output selection",
    async (who) => {
      expect(await reader(who).getManifest(input(who))).toBeNull();
      expect(
        queries.some(
          (query) =>
            query.includes('from "ritual_compiled_artifacts"') ||
            query.includes('from "legacy_ritual_compiled_archives"') ||
            query.includes('from "ritual_bundles"'),
        ),
      ).toBe(false);
    },
  );
  it("requires a current signed-in canonical owner even for a public ritual", async () => {
    await db
      .update(rituals)
      .set({ scope: "public", groupId: null })
      .where(eq(rituals.id, fixture.parent.id));
    expect(
      await reader("outsider").getManifest(input("outsider")),
    ).not.toBeNull();
    queries.length = 0;
    expect(await reader(null).getManifest(input())).toBeNull();
    expect(queries).toEqual([]);
  });
  it("preserves grade zero and distinguishes higher-grade reads from temple administration", async () => {
    await db
      .update(rituals)
      .set({
        scope: "temple",
        groupId: null,
        templeId: fixture.templeId,
        minGrade: 0,
      })
      .where(eq(rituals.id, fixture.parent.id));
    expect(
      await reader("gradeZero").getManifest(input("gradeZero")),
    ).not.toBeNull();
    await db
      .update(rituals)
      .set({ minGrade: 2 })
      .where(eq(rituals.id, fixture.parent.id));
    expect(
      await reader("gradeZero").getManifest(input("gradeZero")),
    ).toBeNull();
    expect(
      await reader("gradeTwo").getManifest(input("gradeTwo")),
    ).not.toBeNull();
    expect(
      await reader("templeAdmin").getManifest(input("templeAdmin")),
    ).not.toBeNull();
  });
  it("reauthenticates each call and snapshots requests before session verification", async () => {
    let actor = fixture.actors.creator;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = vi.fn(async () => {
      await held;
      return actor;
    });
    const service = createSqlRitualBundleReader(db, session, {
      acceptedPublicationPolicyIds: [saved.intent.publicationPolicyId],
    });
    const mutable = input();
    const pending = service.getManifest(mutable);
    mutable.expectedActorId = fixture.actors.outsider;
    mutable.ritualId = createUuidV7();
    release();
    expect(await pending).not.toBeNull();
    actor = fixture.actors.outsider;
    queries.length = 0;
    expect(await service.getManifest(input())).toBeNull();
    expect(queries).toEqual([]);
    expect(session).toHaveBeenCalledTimes(2);
  });
  it("uses one read-only repeatable-read snapshot and projects no source or private evidence", async () => {
    const transaction = vi.spyOn(db, "transaction");
    const result = await reader().getManifest(input());
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    expect(Object.keys(result!)).toEqual([
      "manifestJson",
      "manifestSha256",
      "manifest",
    ]);
    expect(result?.manifest.renderedJson).toBe(fixture.contentJson);
    expect(result?.manifest.title).toBe(fixture.prepared.manifest.title);
    const serialized = JSON.stringify(result);
    for (const privateField of [
      "planJson",
      "storageProvider",
      "objectKey",
      "receiptJson",
      "sourceSha256",
      "claimId",
    ])
      expect(serialized).not.toContain(`\"${privateField}\"`);
    expect(
      queries.some((query) => /\b(insert|update|delete)\b/i.test(query)),
    ).toBe(false);
    expect(
      queries.some((query) => query.includes('"ritual_revisions"."source"')),
    ).toBe(false);
  });
  it("returns independent server-only location bindings for exactly the selected asset", async () => {
    const result = await reader().getAsset(assetInput());
    expect(result).toMatchObject({
      expectedActorId: fixture.actors.creator,
      operationId: saved.intent.operationId,
      ritualId: fixture.parent.id,
      bundleId: saved.intent.bundleId,
      assetKey: saved.rows[0].key,
      sha256: saved.rows[0].sha256,
      byteSize: saved.rows[0].byteSize,
      location: {
        provider: saved.rows[0].storageProvider,
        bucket: saved.rows[0].bucket,
        objectKey: saved.rows[0].objectKey,
      },
      receiptSha256: saved.rows[0].receiptSha256,
    });
    result!.location.objectKey = "changed";
    result!.descriptor.contentSha256 = "changed";
    expect((await reader().getAsset(assetInput()))?.location.objectKey).toBe(
      saved.rows[0].objectKey,
    );
    for (const changes of [
      { assetKey: createUuidV7() },
      { bundleId: createUuidV7() },
      { ritualId: createUuidV7() },
    ])
      expect(
        await reader().getAsset({ ...assetInput(), ...changes }),
      ).toBeNull();
  });
  it("preserves exact opaque Unicode/BOM location strings without normalization", async () => {
    const row = structuredClone(saved.rows[0]);
    row.storageProvider = "\uFEFFr2-private";
    row.bucket = "\uFEFF synthetic-bucket";
    row.objectKey = "\uFEFF bundle/e\u0301 é 🌍\r\n";
    updateReceipt(row, (receipt) =>
      Object.assign(receipt, {
        storageProvider: row.storageProvider,
        bucket: row.bucket,
        objectKey: row.objectKey,
      }),
    );
    await db
      .update(assets)
      .set(row)
      .where(and(eq(assets.bundleId, row.bundleId), eq(assets.key, row.key)));
    expect((await reader().getAsset(assetInput()))?.location).toEqual({
      provider: row.storageProvider,
      bucket: row.bucket,
      objectKey: row.objectKey,
    });
  });
  it("hides an old manifest when a different current artifact has identical output", async () => {
    const next = { ...fixture.artifact, id: createUuidV7() };
    await db.insert(ritualCompiledArtifacts).values(next);
    await db
      .update(rituals)
      .set({ currentCompiledArtifactId: next.id })
      .where(eq(rituals.id, fixture.parent.id));
    expect(await reader().getManifest(input())).toBeNull();
  });
  it.each(["global", "group", "temple"])(
    "reloads %s grants after revocation",
    async (kind) => {
      const who =
        kind === "global" ? "global" : kind === "group" ? "member" : "gradeTwo";
      if (kind === "temple")
        await db
          .update(rituals)
          .set({
            scope: "temple",
            groupId: null,
            templeId: fixture.templeId,
            minGrade: 2,
          })
          .where(eq(rituals.id, fixture.parent.id));
      const service = reader(who);
      expect(await service.getManifest(input(who))).not.toBeNull();
      if (kind === "global")
        await db
          .update(userAccess)
          .set({ admin: false })
          .where(eq(userAccess.userId, fixture.actors.global));
      else if (kind === "group")
        await db
          .delete(userGroupGrants)
          .where(eq(userGroupGrants.userId, fixture.actors.member));
      else
        await db
          .delete(templeMemberships)
          .where(eq(templeMemberships.userId, fixture.actors.gradeTwo));
      expect(await service.getManifest(input(who))).toBeNull();
    },
  );
  it.each(["title", "version", "selection"])(
    "hides a bundle after current %s changes",
    async (kind) => {
      await db
        .update(rituals)
        .set(
          kind === "title"
            ? { title: "Changed title" }
            : kind === "version"
              ? { version: saved.intent.parentVersion + 1 }
              : { currentCompiledArtifactId: null, currentRevisionId: null },
        )
        .where(eq(rituals.id, fixture.parent.id));
      expect(await reader().getManifest(input())).toBeNull();
    },
  );
  it("selects deterministic newest accepted current publication, with explicit bundle selection", async () => {
    const next = freshPublication(saved);
    await insert(next);
    expect((await reader().getManifest(input()))?.manifest.bundleId).toBe(
      next.intent.bundleId,
    );
    expect(
      (
        await reader().getManifest({
          ...input(),
          bundleId: saved.intent.bundleId,
        })
      )?.manifest.bundleId,
    ).toBe(saved.intent.bundleId);
    const ignored = freshPublication(saved, 2, "future-policy-v2");
    await insert(ignored);
    expect((await reader().getManifest(input()))?.manifest.bundleId).toBe(
      next.intent.bundleId,
    );
    expect(
      (
        await reader("creator", db, [
          ignored.intent.publicationPolicyId,
        ]).getManifest(input())
      )?.manifest.bundleId,
    ).toBe(ignored.intent.bundleId);
    expect(
      await reader().getManifest({
        ...input(),
        bundleId: ignored.intent.bundleId,
      }),
    ).toBeNull();
  });
  it("does not fall back past a newer completed marker with incomplete asset evidence", async () => {
    const next = freshPublication(saved);
    for (const row of next.rows)
      Object.assign(row, {
        receiptJson: null,
        receiptSha256: null,
        verifiedAt: null,
      });
    await insert(next);
    expect(await reader().getManifest(input())).toBeNull();
    expect(
      (
        await reader().getManifest({
          ...input(),
          bundleId: saved.intent.bundleId,
        })
      )?.manifest.bundleId,
    ).toBe(saved.intent.bundleId);
  });
  it("breaks equal publication timestamps by canonical bundle ID", async () => {
    const next = freshPublication(saved, 0);
    await insert(next);
    const expected = [saved.intent.bundleId, next.intent.bundleId]
      .sort()
      .reverse()[0];
    expect((await reader().getManifest(input()))?.manifest.bundleId).toBe(
      expected,
    );
  });
  it("requires every reserved asset even when looking up one intact asset", async () => {
    expect(saved.rows.length).toBeGreaterThan(1);
    await db
      .delete(assets)
      .where(
        and(
          eq(assets.bundleId, saved.intent.bundleId),
          eq(assets.key, saved.rows[1].key),
        ),
      );
    expect(await reader().getManifest(input())).toBeNull();
    expect(await reader().getAsset(assetInput())).toBeNull();
  });
  it("hides deleted markers and rejects their durable completion evidence as pending", async () => {
    await db.delete(bundles).where(eq(bundles.bundleId, saved.intent.bundleId));
    expect(await reader().getManifest(input())).toBeNull();
    expect(
      await decodeRitualBundleRecords(saved.intent, saved.rows),
    ).toBeNull();
  });
});

describe("stored bundle evidence", () => {
  it("fails closed on malformed/sparse input and malformed coherently hashed plan text", async () => {
    for (const [intent, rows] of [
      [null, []],
      [saved.intent, null],
      [saved.intent, new Array(513)],
      [saved.intent, new Array(saved.rows.length)],
    ] as const)
      expect(
        await decodeRitualBundleRecords(
          intent as typeof saved.intent,
          rows as typeof saved.rows,
          saved.marker,
        ),
      ).toBeNull();
    const value = structuredClone(saved);
    value.intent.planJson = "{";
    value.intent.planSha256 = bundleTextSha256(value.intent.planJson);
    value.intent.requestHash = ritualBundleRequestHash(value.intent);
    expect(
      await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
    ).toBeNull();
  });
  it("retains completion evidence after deleting an image-free marker", async () => {
    fixture.dispose();
    await clearRitualBundleFixture(db);
    fixture = await seedRitualBundleFixture(db, {
      images: false,
      scope: "group",
    });
    saved = ritualBundleFixtureRecords(fixture, { completed: true });
    await insert(saved);
    expect(saved.rows).toEqual([]);
    expect(await reader().getManifest(input())).not.toBeNull();
    await db.delete(bundles);
    expect(await reader().getManifest(input())).toBeNull();
    expect(await decodeRitualBundleRecords(saved.intent, [])).toBeNull();
    saved.intent.completedAt = null;
    expect(
      await decodeRitualBundleRecords(saved.intent, [], saved.marker),
    ).toBeNull();
    expect(await decodeRitualBundleRecords(saved.intent, [])).not.toBeNull();
  });
  it("uses actual SVG metadata budgets, including more than sixteen embedded images", async () => {
    const value = structuredClone(saved);
    const embedded = {
      contentType: "image/png",
      sha256: "a".repeat(64),
      byteSize: 1,
      width: 1,
      frameHeight: 1,
      frames: 1,
      decodedPixels: 1,
    };
    updatePlan(value, (plan) => {
      const svg = plan.assets.find((asset) => asset.validationKind === "svg")!;
      svg.embeddedRasters = Array.from(
        { length: RITUAL_SVG_LIMITS.embeddedImages },
        () => ({ ...embedded }),
      );
    });
    expect(
      await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
    ).not.toBeNull();
    updatePlan(value, (plan) => {
      const svg = plan.assets.find((asset) => asset.validationKind === "svg")!;
      svg.embeddedRasters = [
        { ...embedded, byteSize: RITUAL_SVG_LIMITS.embeddedBytes },
      ];
    });
    expect(
      await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
    ).not.toBeNull();
    updatePlan(value, (plan) => {
      const svg = plan.assets.find((asset) => asset.validationKind === "svg")!;
      (svg.embeddedRasters as unknown[]).push(embedded);
    });
    expect(
      await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
    ).toBeNull();
  });
  it.each([
    ["element bound", { elements: RITUAL_SVG_LIMITS.elements + 1 }],
    ["reference bound", { localReferences: RITUAL_SVG_LIMITS.references + 1 }],
    [
      "expanded element bound",
      { expandedElements: RITUAL_SVG_LIMITS.expandedElements + 1 },
    ],
    [
      "embedded count",
      {
        embeddedRasters: Array.from(
          { length: RITUAL_SVG_LIMITS.embeddedImages + 1 },
          () => ({}),
        ),
      },
    ],
    ["malformed embedded image", { embeddedRasters: [null] }],
    [
      "invalid embedded MIME",
      {
        embeddedRasters: [
          {
            contentType: "image/svg+xml",
            sha256: "a".repeat(64),
            byteSize: 1,
            width: 1,
            frameHeight: 1,
            frames: 1,
            decodedPixels: 1,
          },
        ],
      },
    ],
    [
      "aggregate embedded pixels",
      {
        embeddedRasters: Array.from({ length: 2 }, () => ({
          contentType: "image/png",
          sha256: "a".repeat(64),
          byteSize: 1,
          width: 8000,
          frameHeight: 8000,
          frames: 1,
          decodedPixels: 64000000,
        })),
      },
    ],
  ])(
    "rejects SVG %s beyond actual validation facts",
    async (_name, changes) => {
      const value = structuredClone(saved);
      updatePlan(value, (plan) =>
        Object.assign(
          plan.assets.find((asset) => asset.validationKind === "svg")!,
          changes,
        ),
      );
      expect(
        await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
      ).toBeNull();
    },
  );
  it("accepts complete records and independently owned reservations", async () => {
    const result = await decodeRitualBundleRecords(
      saved.intent,
      saved.rows,
      saved.marker,
    );
    expect(result?.manifest).toEqual(JSON.parse(saved.intent.manifestJson));
    expect(result?.reservations).toHaveLength(saved.rows.length);
    result!.reservations[0].objectKey = "mutated";
    expect(saved.rows[0].objectKey).not.toBe("mutated");
  });
  it("accepts all-null pending reservations but never a partial receipt set", async () => {
    const pending = structuredClone(saved);
    pending.intent.completedAt = null;
    for (const row of pending.rows)
      Object.assign(row, {
        receiptJson: null,
        receiptSha256: null,
        verifiedAt: null,
      });
    expect(
      await decodeRitualBundleRecords(pending.intent, pending.rows),
    ).not.toBeNull();
    pending.rows[0] = saved.rows[0];
    expect(
      await decodeRitualBundleRecords(pending.intent, pending.rows),
    ).toBeNull();
  });
  it("snapshots dates and nested row values before asynchronous manifest hashing", async () => {
    const mutable = structuredClone(saved);
    const result = decodeRitualBundleRecords(
      mutable.intent,
      mutable.rows,
      mutable.marker,
    );
    mutable.intent.completedAt!.setTime(0);
    mutable.rows[0].receiptJson = "corrupt";
    mutable.marker!.publishedAt.setTime(0);
    expect(await result).not.toBeNull();
  });
  it.each([
    [
      "request hash",
      (v: typeof saved) => {
        v.intent.requestHash = "a".repeat(64);
      },
    ],
    [
      "manifest bytes",
      (v: typeof saved) => {
        v.intent.manifestJson += " ";
      },
    ],
    [
      "plan hash",
      (v: typeof saved) => {
        v.intent.planSha256 = "a".repeat(64);
      },
    ],
    [
      "cross-user alias",
      (v: typeof saved) => {
        v.intent.actorId = createUuidV7();
      },
    ],
    [
      "invalid current artifact",
      (v: typeof saved) => {
        v.intent.currentCompiledArtifactId = "invalid";
      },
    ],
    [
      "descriptor mismatch",
      (v: typeof saved) => {
        v.intent.parentVersion++;
        v.intent.requestHash = ritualBundleRequestHash(v.intent);
      },
    ],
    [
      "completion timestamp mismatch",
      (v: typeof saved) => {
        v.intent.completedAt = new Date(v.intent.completedAt!.getTime() + 1);
      },
    ],
    [
      "absent completion timestamp",
      (v: typeof saved) => {
        v.intent.completedAt = null;
      },
    ],
    [
      "marker parent mismatch",
      (v: typeof saved) => {
        v.marker!.ritualId = createUuidV7();
      },
    ],
    [
      "marker revision mismatch",
      (v: typeof saved) => {
        v.marker!.currentRevisionId = createUuidV7();
      },
    ],
    [
      "missing asset",
      (v: typeof saved) => {
        v.rows.pop();
      },
    ],
    [
      "out of order assets",
      (v: typeof saved) => {
        v.rows.reverse();
      },
    ],
    [
      "cross-parent asset",
      (v: typeof saved) => {
        v.rows[0].ritualId = createUuidV7();
      },
    ],
    [
      "wrong asset digest",
      (v: typeof saved) => {
        v.rows[0].sha256 = "a".repeat(64);
      },
    ],
    [
      "unverified receipt",
      (v: typeof saved) => {
        v.rows[0].receiptSha256 = null;
      },
    ],
    [
      "receipt Date mismatch",
      (v: typeof saved) => {
        v.rows[0].verifiedAt = new Date(0);
      },
    ],
    [
      "receipt claim mismatch",
      (v: typeof saved) => {
        updateReceipt(v.rows[0], (r) => {
          r.claimId = createUuidV7();
        });
      },
    ],
    [
      "receipt after completion",
      (v: typeof saved) => {
        const t = v.marker!.publishedAt.getTime() + 1;
        v.rows[0].verifiedAt = new Date(t);
        updateReceipt(v.rows[0], (r) => {
          r.verifiedAtMs = t;
        });
      },
    ],
    [
      "location NUL",
      (v: typeof saved) => {
        v.rows[0].objectKey = "bad\0key";
      },
    ],
    [
      "blank provider",
      (v: typeof saved) => {
        v.rows[0].storageProvider = " ";
      },
    ],
    [
      "overlong key",
      (v: typeof saved) => {
        v.rows[0].objectKey = "é".repeat(513);
      },
    ],
    [
      "duplicate location",
      (v: typeof saved) => {
        const a = v.rows[0];
        Object.assign(v.rows[1], {
          storageProvider: a.storageProvider,
          bucket: a.bucket,
          objectKey: a.objectKey,
        });
      },
    ],
    [
      "partial claim",
      (v: typeof saved) => {
        v.intent.claimExpiresAt = null;
      },
    ],
    [
      "overlong claim",
      (v: typeof saved) => {
        v.intent.claimExpiresAt = new Date(
          v.intent.claimStartedAt!.getTime() + 120001,
        );
      },
    ],
    [
      "overlong intent",
      (v: typeof saved) => {
        v.intent.expiresAt = new Date(v.intent.createdAt.getTime() + 86400001);
      },
    ],
  ] as const)("rejects %s", async (_name, mutate) => {
    const value = structuredClone(saved);
    mutate(value);
    expect(
      await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
    ).toBeNull();
  });
  it.each([
    [
      "future profile",
      (p: MutablePlan) => {
        p.profile = "future-v9";
      },
    ],
    [
      "future inventory",
      (p: MutablePlan) => {
        p.inventoryProfile = "future-v9";
      },
    ],
    [
      "incomplete resolution",
      (p: MutablePlan) => {
        p.resolutionComplete = false;
      },
    ],
    [
      "stored diagnostics",
      (p: MutablePlan) => {
        p.issues.push({ code: "unresolved", path: [0] });
      },
    ],
    [
      "self hash",
      (p: MutablePlan) => {
        p.sha256 = "a".repeat(64);
      },
    ],
    [
      "unbound optional catalog",
      (p: MutablePlan) => {
        delete p.legacyCatalogSha256;
      },
    ],
    [
      "asset count",
      (p: MutablePlan) => {
        p.assets.pop();
      },
    ],
    [
      "asset reference",
      (p: MutablePlan) => {
        p.assets[0].networkReference += "?changed";
      },
    ],
    [
      "asset MIME",
      (p: MutablePlan) => {
        p.assets[0].mime = "image/jpeg";
      },
    ],
    [
      "asset dimensions",
      (p: MutablePlan) => {
        p.assets[0].width = 0;
      },
    ],
    [
      "aggregate pixel arithmetic",
      (p: MutablePlan) => {
        p.assets[0].decodedPixels = Number(p.assets[0].decodedPixels) + 1;
      },
    ],
    [
      "missing provenance",
      (p: MutablePlan) => {
        p.assets[0].provenance = null;
      },
    ],
    [
      "unrecognized provenance",
      (p: MutablePlan) => {
        (p.assets[0].provenance as Record<string, unknown>).kind = "future";
      },
    ],
    [
      "occurrence count",
      (p: MutablePlan) => {
        p.occurrences.pop();
      },
    ],
    [
      "occurrence path",
      (p: MutablePlan) => {
        p.occurrences[0].path = [999];
      },
    ],
    [
      "occurrence fragment",
      (p: MutablePlan) => {
        p.occurrences[0].displayFragment += "changed";
      },
    ],
    [
      "occurrence asset",
      (p: MutablePlan) => {
        p.occurrences[0].assetIndex = null;
      },
    ],
  ] as const)(
    "rejects coherently rehashed plan with %s drift",
    async (_name, mutate) => {
      const value = structuredClone(saved);
      updatePlan(value, mutate);
      expect(
        await decodeRitualBundleRecords(value.intent, value.rows, value.marker),
      ).toBeNull();
    },
  );
});
