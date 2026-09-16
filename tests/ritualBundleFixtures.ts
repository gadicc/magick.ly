import path from "node:path";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import sharp from "sharp";
import { user } from "../src/db/schema/auth";
import {
  templeMemberships,
  temples,
  userGroupGrants,
  userGroups,
} from "../src/db/schema/memberships";
import {
  ritualBundleAssets,
  ritualBundlePublicationIntents,
  ritualBundles,
} from "../src/db/schema/ritualBundles";
import {
  legacyRitualCompiledArchives,
  ritualCompiledArtifacts,
  ritualRevisions,
  ritualScopeKind,
  rituals,
} from "../src/db/schema/rituals";
import { userAccess } from "../src/db/schema/userProfile";
import type { PrivateRitualImageCatalog } from "../src/files/privateRitualImageCatalog";
import { createStaticRitualImageCatalog } from "../src/files/staticRitualImageCatalog";
import { createUuidV7 } from "../src/lib/ids";
import type { RitualRenderDescriptorV1 } from "../src/offline/permissionContract";
import { prepareRitualBundle } from "../src/offline/prepareRitualBundle";
import { createRitualAssetPlan } from "../src/offline/ritualAssetPlan";
import {
  bundleTextSha256 as hash,
  type RitualBundlePublicationClaim,
  type RitualBundleStorageReceiptV1,
  ritualBundleRequestHash,
} from "../src/offline/ritualBundlePublication";
import { deriveRitualPublicationIdentity } from "../src/offline/ritualPublicationIdentity";
import { createRitualRenderDescriptor } from "../src/offline/ritualRenderDescriptor";

export const bundleSchema = {
  user,
  userAccess,
  temples,
  templeMemberships,
  userGroups,
  userGroupGrants,
  rituals,
  ritualScopeKind,
  ritualRevisions,
  ritualCompiledArtifacts,
  legacyRitualCompiledArchives,
  ritualBundlePublicationIntents,
  ritualBundleAssets,
  ritualBundles,
};
export const BUNDLE_FIXTURE_TIME = Date.parse("2026-09-13T12:00:00.123Z");
export const BUNDLE_FIXTURE_POLICY = "magickli-read-bundle-policy-v1";
type Database = Pick<
  PgDatabase<PgQueryResultHKT>,
  "insert" | "delete" | "update"
>;

export async function clearRitualBundleFixture(db: Database) {
  await db.delete(ritualBundles);
  await db.delete(ritualBundleAssets);
  await db.delete(ritualBundlePublicationIntents);
  await db
    .update(rituals)
    .set({ currentRevisionId: null, currentCompiledArtifactId: null });
  await db.delete(ritualCompiledArtifacts);
  await db.delete(legacyRitualCompiledArchives);
  await db.delete(ritualRevisions);
  await db.delete(rituals);
  await db.delete(templeMemberships);
  await db.delete(userGroupGrants);
  await db.delete(temples);
  await db.delete(userGroups);
  await db.delete(userAccess);
  await db.delete(user);
}

/** Synthetic grants and a real owned PNG/SVG (or image-free) preparation, without providers. */
export async function seedRitualBundleFixture(
  db: Database,
  options: {
    images?: boolean;
    scope?: "public" | "group" | "temple";
    minGrade?: number;
  } = {},
) {
  const actors = {
    creator: createUuidV7(),
    global: createUuidV7(),
    member: createUuidV7(),
    groupAdmin: createUuidV7(),
    gradeZero: createUuidV7(),
    gradeTwo: createUuidV7(),
    templeAdmin: createUuidV7(),
    otherAdmin: createUuidV7(),
    outsider: createUuidV7(),
  };
  await db.insert(user).values(
    Object.entries(actors).map(([name, id]) => ({
      id,
      name,
      email: `${name}@example.test`,
    })),
  );
  await db.insert(userAccess).values({ userId: actors.global, admin: true });
  const groupId = createUuidV7(),
    otherGroupId = createUuidV7(),
    templeId = createUuidV7(),
    otherTempleId = createUuidV7();
  await db.insert(userGroups).values([
    { id: groupId, name: "Synthetic group" },
    { id: otherGroupId, name: "Other group" },
  ]);
  await db.insert(temples).values([
    { id: templeId, name: "Synthetic temple", slug: "synthetic" },
    { id: otherTempleId, name: "Other temple", slug: "other" },
  ]);
  await db.insert(userGroupGrants).values([
    { userId: actors.member, groupId, member: true },
    { userId: actors.groupAdmin, groupId, admin: true },
    { userId: actors.otherAdmin, groupId: otherGroupId, admin: true },
  ]);
  await db.insert(templeMemberships).values(
    [
      { userId: actors.gradeZero, templeId, grade: 0 },
      { userId: actors.gradeTwo, templeId, grade: 2 },
      { userId: actors.templeAdmin, templeId, grade: 0, admin: true },
      {
        userId: actors.otherAdmin,
        templeId: otherTempleId,
        grade: 0,
        admin: true,
      },
    ].map((row) => ({ ...row, addedAt: new Date(BUNDLE_FIXTURE_TIME) })),
  );
  const scope = options.scope ?? "temple";
  const [shell] = await db
    .insert(rituals)
    .values({
      id: createUuidV7(),
      creatorId: actors.creator,
      title: "\uFEFF Synthetic e\u0301 é 🌍\r\n",
      scope,
      groupId: scope === "group" ? groupId : null,
      templeId: scope === "temple" ? templeId : null,
      minGrade: scope === "temple" ? (options.minGrade ?? 0) : null,
      version: 7,
    })
    .returning();
  const source = "\uFEFF p Synthetic exact source e\u0301 é 🌍\r\n";
  const [revision] = await db
    .insert(ritualRevisions)
    .values({
      id: createUuidV7(),
      ritualId: shell.id,
      authorId: actors.creator,
      source,
      sourceSha256: hash(source),
      sourceFormat: "pug",
      sourceFormatVersion: "1",
      createdAt: new Date(BUNDLE_FIXTURE_TIME),
      updatedAt: new Date(BUNDLE_FIXTURE_TIME),
    })
    .returning();
  // Keep the inserted source fixture, not PGlite's BOM-stripped text projection.
  revision.source = source;
  const children: unknown[] = [
    { type: "text", value: "exact e\u0301 é 🌍\r\n" },
  ];
  if (options.images !== false) {
    const png = await sharp({
      create: { width: 3, height: 2, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>';
    const raster = `data:image/png;base64,${png.toString("base64")}`;
    children.push(
      { type: "img", src: raster + "#first" },
      {
        type: "img",
        src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      },
      { type: "img", src: raster + "#second" },
    );
  }
  const contentJson = JSON.stringify({ children }, null, 2);
  const [artifact] = await db
    .insert(ritualCompiledArtifacts)
    .values({
      id: createUuidV7(),
      revisionId: revision.id,
      sourceSha256: revision.sourceSha256,
      compilerVersion: "synthetic-v1",
      outputFormat: "json-rich-text",
      outputFormatVersion: "1",
      transformations: [],
      contentJson,
      contentSha256: hash(contentJson),
      compiledAt: new Date(BUNDLE_FIXTURE_TIME),
    })
    .returning();
  const [parent] = await db
    .update(rituals)
    .set({
      currentRevisionId: revision.id,
      currentCompiledArtifactId: artifact.id,
    })
    .where(eq(rituals.id, shell.id))
    .returning();
  // PGlite's direct text codec strips an initial BOM, so preserve fixture input.
  parent.title = "\uFEFF Synthetic e\u0301 é 🌍\r\n";
  const prepared = await prepareRitualBundleFixture({
    ritualId: parent.id,
    title: parent.title,
    contentJson,
    descriptor: createRitualRenderDescriptor(parent, artifact),
  });
  return {
    actors,
    groupId,
    otherGroupId,
    templeId,
    otherTempleId,
    parent,
    revision,
    artifact,
    contentJson,
    prepared,
    dispose: () => prepared.dispose(),
  };
}

/**
 * Empty static catalog, asset plan and prepared bundle for one selection. An
 * operation ID derives the bundle identity the way the runtime builder does.
 */
export async function prepareRitualBundleFixture(options: {
  ritualId: string;
  title: string;
  contentJson: string;
  descriptor: RitualRenderDescriptorV1;
  privateCatalog?: PrivateRitualImageCatalog;
  operationId?: string;
  knownAppOrigins?: readonly string[];
}) {
  const catalog = await createStaticRitualImageCatalog({
    publicDirectory: path.resolve("public"),
    paths: [],
  });
  const plan = await createRitualAssetPlan(options.contentJson, {
    contentSha256: hash(options.contentJson),
    knownAppOrigins: [...(options.knownAppOrigins ?? [])],
    staticCatalog: catalog,
    privateCatalog: options.privateCatalog,
  });
  try {
    return await prepareRitualBundle({
      ritualId: options.ritualId,
      title: options.title,
      contentJson: options.contentJson,
      plan,
      descriptor: options.descriptor,
      identity: options.operationId
        ? deriveRitualPublicationIdentity(
            options.operationId,
            plan.metadata.assets.length,
          )
        : undefined,
    });
  } finally {
    plan.dispose();
    catalog.dispose();
  }
}
export type RitualBundleFixture = Awaited<
  ReturnType<typeof seedRitualBundleFixture>
>;

/** Trusted synthetic verifier results; provider behavior is tested separately. */
export function bundleStorageReceipts(
  claim: RitualBundlePublicationClaim,
  verifiedAtMs = claim.claimStartedAtMs,
): RitualBundleStorageReceiptV1[] {
  return claim.assets.map((row) => ({
    profile: "magickli-ritual-bundle-object-receipt-v1",
    operationId: claim.operationId,
    bundleId: claim.bundleId,
    assetKey: row.key,
    claimId: claim.claimId,
    storageProvider: row.storageProvider,
    bucket: row.bucket,
    objectKey: row.objectKey,
    sha256: row.sha256,
    byteSize: row.byteSize,
    mime: row.mime,
    verifiedAtMs,
  }));
}

/** Valid stored records for reader/decoder tests; does not insert or grant publication. */
export function ritualBundleFixtureRecords(
  fixture: RitualBundleFixture,
  options: { completed?: boolean; actorId?: string; nowMs?: number } = {},
) {
  const { prepared, parent } = fixture;
  const time = options.nowMs ?? BUNDLE_FIXTURE_TIME;
  const operationId = createUuidV7(),
    claimId = createUuidV7();
  const { sha256: planSha256, ...plan } = prepared.plan;
  const intent: typeof ritualBundlePublicationIntents.$inferSelect = {
    operationId,
    actorId: options.actorId ?? fixture.actors.creator,
    bundleId: prepared.manifest.bundleId,
    ritualId: parent.id,
    currentRevisionId: parent.currentRevisionId!,
    currentCompiledArtifactId: parent.currentCompiledArtifactId,
    parentVersion: parent.version,
    descriptorSha256: prepared.manifest.descriptor.descriptorSha256,
    contentSha256: prepared.manifest.descriptor.contentSha256,
    publicationPolicyId: BUNDLE_FIXTURE_POLICY,
    manifestJson: prepared.manifestJson,
    manifestSha256: prepared.manifestSha256,
    planJson: JSON.stringify(plan),
    planSha256,
    requestHash: "",
    createdAt: new Date(time),
    expiresAt: new Date(time + 86_400_000),
    claimId,
    claimStartedAt: new Date(time),
    claimExpiresAt: new Date(time + 120_000),
    completedAt: options.completed ? new Date(time) : null,
  };
  intent.requestHash = ritualBundleRequestHash(intent);
  const rows: (typeof ritualBundleAssets.$inferSelect)[] =
    prepared.manifest.assets.map((asset, assetIndex) => ({
      operationId,
      bundleId: intent.bundleId,
      ritualId: intent.ritualId,
      key: asset.key,
      assetIndex,
      reference: asset.reference,
      sha256: asset.sha256,
      mime: asset.mime,
      byteSize: asset.bytes,
      storageProvider: "r2-private",
      bucket: "synthetic-private",
      objectKey: `bundles/${intent.bundleId}/${asset.key}`,
      receiptJson: null,
      receiptSha256: null,
      verifiedAt: null,
    }));
  const claim: RitualBundlePublicationClaim = {
    operationId,
    actorId: intent.actorId,
    bundleId: intent.bundleId,
    ritualId: intent.ritualId,
    manifestSha256: intent.manifestSha256,
    claimId,
    claimStartedAtMs: time,
    claimExpiresAtMs: time + 120_000,
    intentExpiresAtMs: intent.expiresAt.getTime(),
    assets: rows.map(
      ({ receiptJson: _j, receiptSha256: _h, verifiedAt: _t, ...row }) => row,
    ),
  };
  if (options.completed)
    for (const [index, receipt] of bundleStorageReceipts(claim).entries()) {
      const receiptJson = JSON.stringify(receipt);
      Object.assign(rows[index], {
        receiptJson,
        receiptSha256: hash(receiptJson),
        verifiedAt: new Date(time),
      });
    }
  const marker = options.completed
    ? {
        bundleId: intent.bundleId,
        operationId,
        ritualId: intent.ritualId,
        currentRevisionId: intent.currentRevisionId,
        publishedAt: new Date(time),
      }
    : undefined;
  return { intent, rows, marker, claim };
}
