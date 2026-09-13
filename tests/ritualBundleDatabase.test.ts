import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import * as auth from "../src/db/schema/auth";
import * as membership from "../src/db/schema/memberships";
import {
  ritualBundleAssets as assets,
  ritualBundles as bundles,
  ritualBundlePublicationIntents as intents,
} from "../src/db/schema/ritualBundles";
import * as ritual from "../src/db/schema/rituals";
import { createUuidV7 } from "../src/lib/ids";

const h = await createMemoryPgliteHarness({
  schema: { ...auth, ...membership, ...ritual, intents, assets, bundles },
});
const { db } = h;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const now = new Date("2026-09-13T12:00:00.123Z");
const v4 = "550e8400-e29b-41d4-a716-446655440000";
let actorId: string;
let ritualId: string;
let revisionId: string;
afterAll(() => h.client.close());
beforeEach(async () => {
  await db.delete(bundles);
  await db.delete(assets);
  await db.delete(intents);
  await db.update(ritual.rituals).set({
    currentRevisionId: null,
    currentCompiledArtifactId: null,
  });
  await db.delete(ritual.ritualCompiledArtifacts);
  await db.delete(ritual.ritualRevisions);
  await db.delete(ritual.rituals);
  await db.delete(auth.user);
  actorId = createUuidV7();
  ritualId = createUuidV7();
  revisionId = createUuidV7();
  await db.insert(auth.user).values({
    id: actorId,
    name: "Synthetic publisher",
    email: "publisher@example.test",
  });
  await db.insert(ritual.rituals).values({
    id: ritualId,
    title: "Synthetic ritual",
    scope: "public",
  });
  await db.insert(ritual.ritualRevisions).values({
    id: revisionId,
    ritualId,
    authorId: actorId,
    source: "p Synthetic source",
    sourceSha256: hash("p Synthetic source"),
    sourceFormat: "pug",
    sourceFormatVersion: "legacy-unknown",
    createdAt: now,
    updatedAt: now,
  });
});

function intent(
  overrides: Partial<typeof intents.$inferInsert> = {},
): typeof intents.$inferInsert {
  const bundleId = createUuidV7();
  const contentSha256 = hash('{"children":[]}');
  const descriptorSha256 = hash("synthetic descriptor");
  const manifestJson = JSON.stringify({
    version: 1,
    bundleId,
    ritualId,
    descriptor: {
      descriptorSha256,
      contentSha256,
      outputFormat: "json-rich-text",
      outputFormatVersion: "1",
    },
    title: "\uFEFF Exact e\u0301 é 🌍\r\n",
    renderedJson: '{"children":[]}',
    assets: [],
    occurrences: [],
  });
  const planJson = JSON.stringify({
    profile: "magickli-ritual-asset-plan-v4",
    inventoryProfile: "magickli-jrt-assets-v2",
    contentSha256,
    resolutionComplete: true,
    assets: [],
    occurrences: [],
    issues: [],
  });
  return {
    operationId: createUuidV7(),
    actorId,
    bundleId,
    ritualId,
    currentRevisionId: revisionId,
    currentCompiledArtifactId: null,
    parentVersion: 0,
    descriptorSha256,
    contentSha256,
    publicationPolicyId: "magickli-read-bundle-policy-v1",
    manifestJson,
    manifestSha256: hash(manifestJson),
    planJson,
    planSha256: hash(planJson),
    requestHash: hash("synthetic request"),
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

function asset(
  parent: typeof intents.$inferInsert,
  overrides: Partial<typeof assets.$inferInsert> = {},
): typeof assets.$inferInsert {
  const key = createUuidV7();
  return {
    operationId: parent.operationId,
    bundleId: parent.bundleId,
    ritualId: parent.ritualId,
    key,
    assetIndex: 0,
    reference: "/pics/synthetic.svg?exact=%C3%A9",
    sha256: hash("synthetic bytes"),
    mime: "image/svg+xml",
    byteSize: 100,
    storageProvider: "r2-private",
    bucket: "synthetic-private",
    objectKey: `bundles/${parent.bundleId}/${key}`,
    ...overrides,
  };
}

function receipt(row: typeof assets.$inferInsert) {
  const value = {
    profile: "magickli-ritual-bundle-object-receipt-v1",
    operationId: row.operationId,
    bundleId: row.bundleId,
    assetKey: row.key,
    claimId: createUuidV7(),
    storageProvider: row.storageProvider,
    bucket: row.bucket,
    objectKey: row.objectKey,
    sha256: row.sha256,
    byteSize: row.byteSize,
    mime: row.mime,
    verifiedAtMs: now.getTime(),
  };
  const receiptJson = JSON.stringify(value);
  return { receiptJson, receiptSha256: hash(receiptJson), verifiedAt: now };
}

function marker(parent: typeof intents.$inferInsert) {
  return {
    operationId: parent.operationId,
    bundleId: parent.bundleId,
    ritualId: parent.ritualId,
    currentRevisionId: parent.currentRevisionId,
    publishedAt: now,
  };
}

async function constraint(
  query: PromiseLike<unknown>,
  name: string,
  code = "23514",
) {
  let caught: unknown;
  try {
    await query;
  } catch (error) {
    caught = error;
  }
  let failure = caught as {
    cause?: unknown;
    constraint?: string;
    code?: string;
  };
  while (failure?.cause) failure = failure.cause as typeof failure;
  expect(failure).toMatchObject({ code, constraint: name });
}

it("preserves exact manifest/plan/receipt text and dates without completing a reservation", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  const row = asset(parent);
  await db.insert(assets).values(row);
  const [saved] = await db.select().from(intents);
  expect(saved.manifestJson).toBe(parent.manifestJson);
  expect(saved.planJson).toBe(parent.planJson);
  expect(saved.createdAt).toEqual(now);
  expect(saved.currentCompiledArtifactId).toBeNull();
  expect(saved.parentVersion).toBe(0);
  expect(saved.claimId).toBeNull();
  expect((await db.select().from(assets))[0].receiptJson).toBeNull();
  expect(await db.select().from(bundles)).toEqual([]);
  const verified = receipt(row);
  await db.update(assets).set(verified).where(eq(assets.key, row.key));
  expect((await db.select().from(assets))[0]).toMatchObject(verified);
  expect(await db.select().from(bundles)).toEqual([]);
  await db.update(intents).set({
    claimId: JSON.parse(verified.receiptJson).claimId,
    claimStartedAt: now,
    claimExpiresAt: new Date(now.getTime() + 120_000),
    completedAt: now,
  });
  await db.insert(bundles).values(marker(parent));
  expect(await db.select().from(bundles)).toEqual([marker(parent)]);
});

it("reserves identical hashes independently in different bundles and at different references", async () => {
  const a = intent();
  const b = intent();
  await db.insert(intents).values([a, b]);
  const first = asset(a);
  const second = asset(a, {
    assetIndex: 1,
    reference: first.reference + "&other=1",
  });
  const third = asset(b);
  await db.insert(assets).values([first, second, third]);
  expect((await db.select().from(assets)).map((row) => row.sha256)).toEqual([
    first.sha256,
    first.sha256,
    first.sha256,
  ]);
});

it("binds reservations to the complete operation/bundle/ritual tuple", async () => {
  const a = intent();
  const b = intent();
  await db.insert(intents).values([a, b]);
  for (const patch of [
    { operationId: b.operationId },
    { bundleId: b.bundleId },
    { ritualId: createUuidV7() },
  ])
    await constraint(
      db.insert(assets).values(asset(a, patch)),
      "ritual_bundle_assets_intent_binding",
      "23503",
    );
  expect(await db.select().from(assets)).toEqual([]);
});

it("enforces asset keys, order and exact destination uniqueness", async () => {
  const parent = intent();
  const other = intent();
  await db.insert(intents).values([parent, other]);
  const first = asset(parent);
  await db.insert(assets).values(first);
  await constraint(
    db.insert(assets).values(asset(parent, { key: first.key, assetIndex: 1 })),
    "ritual_bundle_assets_bundle_key",
    "23505",
  );
  await constraint(
    db.insert(assets).values(asset(parent)),
    "ritual_bundle_assets_operation_index",
    "23505",
  );
  await constraint(
    db.insert(assets).values(asset(other, { objectKey: first.objectKey })),
    "ritual_bundle_assets_destination",
    "23505",
  );
  await db.insert(assets).values(
    asset(other, {
      objectKey: first.objectKey,
      bucket: "other-private",
    }),
  );
});

it.each(["manifest", "plan"] as const)(
  "checks exact %s text hashes",
  async (kind) => {
    const parent = intent();
    await db.insert(intents).values(parent);
    const jsonField = kind === "manifest" ? "manifestJson" : "planJson";
    await constraint(
      db.update(intents).set({ [jsonField]: parent[jsonField] + " " }),
      `ritual_bundle_intents_${kind}_hash`,
    );
    await constraint(
      db.update(intents).set({
        [kind === "manifest" ? "manifestSha256" : "planSha256"]: "a".repeat(64),
      }),
      `ritual_bundle_intents_${kind}_hash`,
    );
  },
);

it.each([
  ["version", 2],
  ["bundleId", "wrong"],
  ["ritualId", "wrong"],
  ["descriptor", {}],
  ["descriptor", null],
])("rejects manifest envelope mismatch: %s", async (field, value) => {
  const parent = intent();
  const manifest = JSON.parse(parent.manifestJson);
  manifest[field as string] = value;
  const manifestJson = JSON.stringify(manifest);
  await constraint(
    db
      .insert(intents)
      .values({ ...parent, manifestJson, manifestSha256: hash(manifestJson) }),
    "ritual_bundle_intents_manifest",
  );
});

it.each([
  ["profile", "old"],
  ["inventoryProfile", "old"],
  ["resolutionComplete", false],
  ["issues", [{ code: "unresolved" }]],
  ["contentSha256", "a".repeat(64)],
  ["sha256", "a".repeat(64)],
])(
  "rejects incompatible/incomplete plan evidence: %s",
  async (field, value) => {
    const parent = intent();
    const plan = JSON.parse(parent.planJson);
    plan[field as string] = value;
    const planJson = JSON.stringify(plan);
    await constraint(
      db
        .insert(intents)
        .values({ ...parent, planJson, planSha256: hash(planJson) }),
      "ritual_bundle_intents_plan",
    );
  },
);

it.each(["manifest", "plan"] as const)(
  "rejects missing or oversized %s metadata",
  async (kind) => {
    const parent = intent();
    for (const json of ["{}", "[]", " ".repeat(16 * 1024 * 1024) + "{}"])
      await constraint(
        db.insert(intents).values({
          ...parent,
          [kind === "manifest" ? "manifestJson" : "planJson"]: json,
          [kind === "manifest" ? "manifestSha256" : "planSha256"]: hash(json),
        }),
        `ritual_bundle_intents_${kind}`,
      );
  },
);

it.each([
  { parentVersion: -1 },
  { parentVersion: Number.MAX_SAFE_INTEGER + 1 },
  { requestHash: "INVALID" },
  { descriptorSha256: "INVALID" },
  { publicationPolicyId: "" },
  { publicationPolicyId: "NOT-AN-APPROVED-POLICY" },
  { publicationPolicyId: "a".repeat(129) },
])("rejects unsafe publication identity (case %#)", async (patch) => {
  await constraint(
    db.insert(intents).values(intent(patch)),
    "ritual_bundle_intents_identity",
  );
});

it("retains historical domain references but requires a canonical actor and UUIDv7 IDs", async () => {
  const parent = intent({
    currentRevisionId: createUuidV7(),
    currentCompiledArtifactId: createUuidV7(),
  });
  await db.insert(intents).values(parent);
  await constraint(
    db.insert(intents).values(intent({ actorId: createUuidV7() })),
    "ritual_bundle_publication_intents_actor_id_auth_user_id_fk",
    "23503",
  );
  for (const [field, name] of [
    ["operationId", "operation_id"],
    ["currentRevisionId", "current_revision_id"],
    ["currentCompiledArtifactId", "current_compiled_artifact_id"],
  ] as const)
    await constraint(
      db.insert(intents).values(intent({ [field]: v4 })),
      `ritual_bundle_intents_${name}_v7`,
    );
});

it("enforces fixed intent and complete bounded claim windows", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  for (const expiresAt of [now, new Date(now.getTime() + 86_400_001)])
    await constraint(
      db.update(intents).set({ expiresAt }),
      "ritual_bundle_intents_expiry",
    );
  const claimId = createUuidV7();
  const end = new Date(now.getTime() + 120_000);
  for (const patch of [
    { claimId },
    { claimStartedAt: now },
    { claimExpiresAt: end },
    { claimId, claimStartedAt: now, claimExpiresAt: now },
    {
      claimId,
      claimStartedAt: new Date(now.getTime() - 1),
      claimExpiresAt: end,
    },
    {
      claimId,
      claimStartedAt: now,
      claimExpiresAt: new Date(end.getTime() + 1),
    },
    {
      claimId,
      claimStartedAt: parent.expiresAt,
      claimExpiresAt: new Date(parent.expiresAt.getTime() + 1),
    },
  ])
    await constraint(
      db.update(intents).set(patch),
      "ritual_bundle_intents_claim",
    );
  await db
    .update(intents)
    .set({ claimId, claimStartedAt: now, claimExpiresAt: end });
  expect((await db.select().from(intents))[0]).toMatchObject({
    claimId,
    claimStartedAt: now,
    claimExpiresAt: end,
  });
  await db
    .update(intents)
    .set({ claimId: null, claimStartedAt: null, claimExpiresAt: null });
});

it("retains completion evidence after marker deletion and ties its timestamp to the claim", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  await constraint(
    db.update(intents).set({ completedAt: now }),
    "ritual_bundle_intents_completion",
  );
  const claim = {
    claimId: createUuidV7(),
    claimStartedAt: now,
    claimExpiresAt: new Date(now.getTime() + 120_000),
  };
  await db.update(intents).set(claim);
  for (const completedAt of [
    new Date(now.getTime() - 1),
    claim.claimExpiresAt,
    new Date(parent.expiresAt.getTime() + 1),
  ])
    await constraint(
      db.update(intents).set({ completedAt }),
      "ritual_bundle_intents_completion",
    );
  await db.update(intents).set({ completedAt: now });
  await db.insert(bundles).values(marker(parent));
  await db.delete(bundles);
  expect((await db.select().from(intents))[0].completedAt).toEqual(now);
  await constraint(
    db.update(intents).set({
      claimId: null,
      claimStartedAt: null,
      claimExpiresAt: null,
    }),
    "ritual_bundle_intents_completion",
  );
});

it.each([
  { key: v4 },
  { assetIndex: -1 },
  { assetIndex: 512 },
  { reference: "" },
  { reference: "/pics/image.svg#fragment" },
  { reference: "é".repeat(524_289) },
  { sha256: "INVALID" },
])("rejects invalid asset identity (case %#)", async (patch) => {
  const parent = intent();
  await db.insert(intents).values(parent);
  await constraint(
    db.insert(assets).values(asset(parent, patch)),
    patch.key ? "ritual_bundle_assets_key_v7" : "ritual_bundle_assets_identity",
  );
});

it.each([
  { mime: "image/svg+xml", byteSize: 4 * 1024 * 1024 + 1 },
  { mime: "image/png", byteSize: 20 * 1024 * 1024 + 1 },
  { mime: "text/html", byteSize: 10 },
  { byteSize: 0 },
])("rejects unsupported asset type/size (case %#)", async (patch) => {
  const parent = intent();
  await db.insert(intents).values(parent);
  await constraint(
    db.insert(assets).values(asset(parent, patch as never)),
    "ritual_bundle_assets_bytes",
  );
});

it.each([
  { storageProvider: " " },
  { storageProvider: "é".repeat(65) },
  { bucket: " " },
  { bucket: "a".repeat(256) },
  { objectKey: "" },
  { objectKey: "é".repeat(513) },
])("rejects invalid destination bounds (case %#)", async (patch) => {
  const parent = intent();
  await db.insert(intents).values(parent);
  await constraint(
    db.insert(assets).values(asset(parent, patch)),
    "ritual_bundle_assets_destination_nonempty",
  );
});

it("stores all accepted image kinds at their upper byte bounds", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  for (const [assetIndex, mime] of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ].entries())
    await db.insert(assets).values(
      asset(parent, {
        assetIndex,
        mime: mime as typeof assets.$inferInsert.mime,
        byteSize: (mime === "image/svg+xml" ? 4 : 20) * 1024 * 1024,
      }),
    );
  expect(await db.select().from(assets)).toHaveLength(5);
});

it("requires complete receipt triplets and exact receipt text hashes", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  const row = asset(parent);
  await db.insert(assets).values(row);
  const full = receipt(row);
  for (const patch of [
    { receiptJson: full.receiptJson },
    { receiptSha256: full.receiptSha256 },
    { verifiedAt: full.verifiedAt },
    { ...full, verifiedAt: null },
  ])
    await constraint(
      db.update(assets).set(patch),
      "ritual_bundle_assets_receipt",
    );
  await constraint(
    db.update(assets).set({ ...full, receiptSha256: "a".repeat(64) }),
    "ritual_bundle_assets_receipt_hash",
  );
  const padded = full.receiptJson + " ".repeat(16 * 1024);
  await constraint(
    db
      .update(assets)
      .set({ ...full, receiptJson: padded, receiptSha256: hash(padded) }),
    "ritual_bundle_assets_receipt",
  );
});

it.each([
  "profile",
  "operationId",
  "bundleId",
  "assetKey",
  "storageProvider",
  "bucket",
  "objectKey",
  "sha256",
  "mime",
  "byteSize",
  "verifiedAtMs",
])("binds receipt %s to its exact reserved row", async (field) => {
  const parent = intent();
  await db.insert(intents).values(parent);
  const row = asset(parent);
  await db.insert(assets).values(row);
  const full = receipt(row);
  const value = JSON.parse(full.receiptJson);
  value[field] = typeof value[field] === "number" ? value[field] + 1 : "wrong";
  const receiptJson = JSON.stringify(value);
  await constraint(
    db
      .update(assets)
      .set({ ...full, receiptJson, receiptSha256: hash(receiptJson) }),
    "ritual_bundle_assets_receipt_binding",
  );
  delete value[field];
  const missing = JSON.stringify(value);
  await constraint(
    db
      .update(assets)
      .set({ ...full, receiptJson: missing, receiptSha256: hash(missing) }),
    "ritual_bundle_assets_receipt_binding",
  );
});

it("binds completed markers to their intent and an owned source revision", async () => {
  const parent = intent();
  await db.insert(intents).values(parent);
  for (const patch of [
    { operationId: createUuidV7() },
    { bundleId: createUuidV7() },
    { currentRevisionId: createUuidV7() },
  ])
    await constraint(
      db.insert(bundles).values({ ...marker(parent), ...patch }),
      "ritual_bundles_intent_binding",
      "23503",
    );
  const otherRitual = createUuidV7();
  await db
    .insert(ritual.rituals)
    .values({ id: otherRitual, title: "Other", scope: "public" });
  const historical = intent({ currentRevisionId: createUuidV7() });
  await db.insert(intents).values(historical);
  await db.insert(ritual.ritualRevisions).values({
    id: historical.currentRevisionId,
    ritualId: otherRitual,
    authorId: actorId,
    source: "other",
    sourceSha256: hash("other"),
    sourceFormat: "pug",
    sourceFormatVersion: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  await constraint(
    db.insert(bundles).values(marker(historical)),
    "ritual_bundles_own_revision",
    "23503",
  );
  await db.insert(bundles).values(marker(parent));
  await constraint(
    db
      .delete(ritual.ritualRevisions)
      .where(eq(ritual.ritualRevisions.id, revisionId)),
    "ritual_bundles_own_revision",
    "23503",
  );
  await expect(db.delete(intents)).rejects.toThrow();
});

it("rolls back reservations, verified receipts and completion together", async () => {
  await expect(
    db.transaction(async (tx) => {
      const parent = intent();
      await tx.insert(intents).values(parent);
      const row = asset(parent);
      await tx.insert(assets).values({ ...row, ...receipt(row) });
      await tx.insert(bundles).values(marker(parent));
      await tx
        .insert(assets)
        .values(asset(parent, { assetIndex: 1, objectKey: row.objectKey }));
    }),
  ).rejects.toThrow();
  expect(await db.select().from(intents)).toEqual([]);
  expect(await db.select().from(assets)).toEqual([]);
  expect(await db.select().from(bundles)).toEqual([]);
});
