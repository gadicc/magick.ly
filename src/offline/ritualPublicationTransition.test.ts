import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import sharp from "sharp";
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
  prepareRitualBundleFixture,
  type RitualBundleFixture,
  seedRitualBundleFixture,
} from "../../tests/ritualBundleFixtures";
import {
  ritualBundlePublicationIntents as intents,
  ritualBundles as markers,
} from "../db/schema/ritualBundles";
import {
  ritualCompiledArtifacts,
  ritualRevisions,
  rituals,
} from "../db/schema/rituals";
import {
  createPrivateRitualImageCatalog,
  type PrivateRitualImageCatalog,
} from "../files/privateRitualImageCatalog";
import { formatRitualFileLocator } from "../files/ritualFileLocator";
import { createUuidV7 } from "../lib/ids";
import { parseRitualBundleManifest } from "./ritualBundleManifest";
import { createRitualPublicationService } from "./ritualPublicationService";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";
import { createSqlRitualBundlePublisher } from "./sqlRitualBundlePublications";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";
import { createSqlRitualPublicationSelectionReader } from "./sqlRitualPublicationSelection";

vi.mock("server-only", () => ({}));
// Catalogs and plans embed the current validator identity. Swapping it between
// steps reproduces a deployment that upgraded the image validator while
// publications from the previous build were pending or unacknowledged.
const validation = vi.hoisted(() => ({ current: "" }));
vi.mock("../files/ritualImageValidationIdentity", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../files/ritualImageValidationIdentity")
  >()),
  getRitualImageValidationSha256: async () => validation.current,
}));

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const BEFORE = sha("validator identity before the upgrade");
const AFTER = sha("validator identity after the upgrade");
const h = await createMemoryPgliteHarness({ schema: bundleSchema });
const { db } = h;
let fixture: RitualBundleFixture;
let actorId: string;
let time: number;
let current: {
  parent: RitualBundleFixture["parent"];
  contentJson: string;
  descriptor: RitualBundleFixture["prepared"]["manifest"]["descriptor"];
  privateCatalog?: PrivateRitualImageCatalog;
};
const disposables: { dispose(): void }[] = [];
const locations = ({
  bundleId,
  asset,
}: {
  bundleId: string;
  asset: { key: string };
}) => ({
  storageProvider: "r2-private",
  bucket: "synthetic-private",
  objectKey: `bundles/${bundleId}/${asset.key}`,
});
const publisher = () =>
  createSqlRitualBundlePublisher(db, async () => actorId, {
    publicationPolicyId: BUNDLE_FIXTURE_POLICY,
    locations,
    now: () => time,
  });
const reader = () =>
  createSqlRitualBundleReader(db, async () => actorId, {
    acceptedPublicationPolicyIds: [BUNDLE_FIXTURE_POLICY],
  });
const request = (operationId: string) => ({
  version: 1,
  operationId,
  expectedActorId: actorId,
  ritualId: current.parent.id,
  expectedRevisionId: current.parent.currentRevisionId,
  expectedVersion: current.parent.version,
});
const state = async () => ({
  intents: await db.select().from(intents),
  markers: await db.select().from(markers),
});
const storedPlan = async (operationId: string) => {
  const [row] = await db
    .select({ planJson: intents.planJson })
    .from(intents)
    .where(eq(intents.operationId, operationId));
  return JSON.parse(row.planJson);
};

beforeEach(async () => {
  validation.current = BEFORE;
  await clearRitualBundleFixture(db);
  fixture = await seedRitualBundleFixture(db);
  actorId = fixture.actors.creator;
  time = BUNDLE_FIXTURE_TIME;
  current = {
    parent: fixture.parent,
    contentJson: fixture.contentJson,
    descriptor: fixture.prepared.manifest.descriptor,
  };
});
afterEach(() => {
  fixture.dispose();
  for (const value of disposables.splice(0)) value.dispose();
});
afterAll(() => h.client.close());

/** Mirrors the runtime plan builder: identities derive from the operation. */
async function prepare(operationId: string, title = current.parent.title) {
  const prepared = await prepareRitualBundleFixture({
    ritualId: current.parent.id,
    title,
    contentJson: current.contentJson,
    descriptor: current.descriptor,
    privateCatalog: current.privateCatalog,
    operationId,
  });
  disposables.push(prepared);
  return prepared;
}
function service(ensureAsset = vi.fn()) {
  // The service zero-fills each buffer after upload; keep a copy per call.
  const uploads: Uint8Array[] = [];
  ensureAsset.mockImplementation(async ({ claim, assetKey, bytes }) => {
    uploads.push(Uint8Array.from(bytes ?? []));
    return bundleStorageReceipts(claim).find(
      (row) => row.assetKey === assetKey,
    )!;
  });
  return {
    ensureAsset,
    uploads,
    publish: createRitualPublicationService({
      loadSelection: createSqlRitualPublicationSelectionReader(
        db,
        async () => actorId,
      ),
      buildPrepared: ({ operationId }) => prepare(operationId),
      publisher: publisher(),
      storage: { ensureAsset },
    }),
  };
}
/** A synthetic save: a new revision and compiled artifact become current. */
async function save(contentJson: string) {
  const source = `﻿ p Saved ${time}\r\n`;
  const [revision] = await db
    .insert(ritualRevisions)
    .values({
      ...fixture.revision,
      id: createUuidV7(),
      source,
      sourceSha256: sha(source),
    })
    .returning();
  const [artifact] = await db
    .insert(ritualCompiledArtifacts)
    .values({
      ...fixture.artifact,
      id: createUuidV7(),
      revisionId: revision.id,
      sourceSha256: revision.sourceSha256,
      contentJson,
      contentSha256: sha(contentJson),
    })
    .returning();
  const [parent] = await db
    .update(rituals)
    .set({
      currentRevisionId: revision.id,
      currentCompiledArtifactId: artifact.id,
      version: current.parent.version + 1,
    })
    .where(eq(rituals.id, current.parent.id))
    .returning();
  // PGlite's direct text codec strips the fixture title's leading BOM.
  parent.title = fixture.parent.title;
  current = {
    ...current,
    parent,
    contentJson,
    descriptor: createRitualRenderDescriptor(parent, artifact),
  };
}
/** A finalized private upload, validated by the catalog like any other. */
async function uploaded() {
  const bytes = Uint8Array.from(
    await sharp({
      create: { width: 5, height: 4, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer(),
  );
  const locator = {
    ritualId: current.parent.id,
    attachmentId: createUuidV7(),
    fileId: createUuidV7(),
  };
  const reference = formatRitualFileLocator(locator);
  const catalog = await createPrivateRitualImageCatalog({
    references: [reference],
    readAuthorized: async () => ({
      record: {
        id: locator.fileId,
        ritualId: locator.ritualId,
        attachmentId: locator.attachmentId,
        operationId: createUuidV7(),
        audioMeta: null,
        bucket: "private-files",
        byteSize: bytes.length,
        contentType: "image/png",
        detectedContentType: "image/png",
        imageMeta: { format: "png", width: 5, height: 4 },
        kind: "image",
        meta: {},
        objectKey: `ritual-files/${locator.fileId}`,
        originalFilename: "upload.png",
        ownerId: actorId,
        ownerType: "user",
        sha256: sha(bytes),
        storageProvider: "r2",
        visibility: "private",
      },
      bytes: bytes.slice(),
    }),
  });
  disposables.push(catalog);
  expect(catalog.metadata.entries[0]).toMatchObject({
    kind: "available",
    mime: "image/png",
  });
  return { reference, bytes, catalog };
}

describe("publication across a validator identity change", () => {
  it("keeps an earlier publication readable through the SQL reader and the manifest contract", async () => {
    const operationId = createUuidV7();
    const before = await service().publish(request(operationId));
    if (!before.ok) throw new Error(before.code);
    expect(before.replayed).toBe(false);
    expect((await storedPlan(operationId)).validationSha256).toBe(BEFORE);

    validation.current = AFTER;
    const found = await reader().getManifest({
      expectedActorId: actorId,
      ritualId: current.parent.id,
    });
    if (!found) throw new Error("Expected a readable manifest");
    expect(found.manifest.bundleId).toBe(before.receipt.bundleId);
    expect(found.manifest.assets.length).toBeGreaterThan(0);
    const assets = await Promise.all(
      found.manifest.assets.map((asset) =>
        reader().getAsset({
          expectedActorId: actorId,
          ritualId: current.parent.id,
          bundleId: found.manifest.bundleId,
          assetKey: asset.key,
        }),
      ),
    );
    expect(assets).toEqual(
      found.manifest.assets.map((asset) =>
        expect.objectContaining({
          sha256: asset.sha256,
          location: expect.objectContaining({
            objectKey: `bundles/${found.manifest.bundleId}/${asset.key}`,
          }),
        }),
      ),
    );
    // The download contract validates the stored manifest without the plan.
    await expect(
      parseRitualBundleManifest(found.manifestJson, {
        manifestSha256: found.manifestSha256,
        bundleId: found.manifest.bundleId,
        ritualId: current.parent.id,
        descriptor: found.manifest.descriptor,
      }),
    ).resolves.toMatchObject({ bundleId: found.manifest.bundleId });
  });

  it("publishes a newly validated upload and save under the new identity", async () => {
    validation.current = AFTER;
    const image = await uploaded();
    current.privateCatalog = image.catalog;
    await save(
      JSON.stringify({
        children: [
          { type: "text", value: "after the upgrade" },
          { type: "img", src: image.reference },
        ],
      }),
    );
    const operationId = createUuidV7();
    const { publish, uploads } = service();
    expect(await publish(request(operationId))).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(uploads).toEqual([image.bytes]);
    const plan = await storedPlan(operationId);
    expect(plan.validationSha256).toBe(AFTER);
    expect(plan.assets[0]).toMatchObject({
      sha256: sha(image.bytes),
      provenance: { kind: "private-ritual", ritualId: current.parent.id },
    });
    expect((await state()).markers).toHaveLength(1);
  });

  it("replays a pending reservation whose plan provenance changed and completes it", async () => {
    const operationId = createUuidV7();
    const operation = { operationId, expectedActorId: actorId };
    const before = await prepare(operationId);
    expect(await publisher().initiate(operation, before)).toMatchObject({
      kind: "reserved",
      replayed: false,
    });

    validation.current = AFTER;
    const after = await prepare(operationId);
    expect(after.manifestSha256).toBe(before.manifestSha256);
    expect(after.plan.validationSha256).toBe(AFTER);
    expect(after.plan.sha256).not.toBe(before.plan.sha256);
    const sql = publisher();
    expect(await sql.initiate(operation, after)).toMatchObject({
      kind: "reserved",
      replayed: true,
      reservation: {
        bundleId: before.manifest.bundleId,
        planSha256: before.plan.sha256,
      },
    });
    const claimed = await sql.claim(operation);
    if (claimed.kind !== "claimed") throw new Error("Expected a claim");
    const receipt = await sql.publish(
      claimed.claim,
      bundleStorageReceipts(claimed.claim),
    );
    expect(receipt.bundleId).toBe(before.manifest.bundleId);
    const saved = await state();
    expect(saved.intents).toHaveLength(1);
    expect(saved.markers).toHaveLength(1);
    // The reservation keeps the provenance it was validated under.
    expect((await storedPlan(operationId)).validationSha256).toBe(BEFORE);
  });

  it("returns the original receipt when a completed publication's acknowledgement was lost", async () => {
    const operationId = createUuidV7();
    const first = await service().publish(request(operationId));
    if (!first.ok) throw new Error(first.code);
    expect(first.replayed).toBe(false);

    validation.current = AFTER;
    const { publish, ensureAsset } = service();
    expect(await publish(request(operationId))).toEqual({
      ok: true,
      state: "completed",
      replayed: true,
      receipt: first.receipt,
    });
    expect(ensureAsset).not.toHaveBeenCalled();
    const after = await prepare(operationId);
    expect(after.plan.sha256).not.toBe((await storedPlan(operationId)).sha256);
    expect(
      await publisher().initiate(
        { operationId, expectedActorId: actorId },
        after,
      ),
    ).toMatchObject({
      kind: "completed",
      receipt: { bundleId: first.receipt.bundleId },
    });
    expect((await state()).markers).toHaveLength(1);
  });

  it("still rejects a reused operation for different content", async () => {
    validation.current = AFTER;
    const operationId = createUuidV7();
    const operation = { operationId, expectedActorId: actorId };
    await publisher().initiate(operation, await prepare(operationId));
    await expect(
      publisher().initiate(
        operation,
        await prepare(operationId, "Renamed after reservation"),
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    expect((await state()).intents).toHaveLength(1);
  });
});
