import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema/index";
import { createUuidV7 } from "../lib/ids";
import { createSqlRitualFileRepository } from "./repository";

vi.mock("server-only", () => ({}));
vi.mock("../db/neonFull", () => ({ db: {} }));

const h = await createMemoryPgliteHarness({ schema });
const db = drizzle(h.client, { schema });
afterAll(() => h.client.close());

const ids = {
  actor: createUuidV7(),
  ritual: createUuidV7(),
  operation: createUuidV7(),
  attachment: createUuidV7(),
  file: createUuidV7(),
};
const bytes = new Uint8Array([1, 2, 3, 4]);
const digest = createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-09-13T10:00:00.000Z");

beforeEach(async () => {
  await h.client.exec(
    "TRUNCATE TABLE auth_user,loom_files,rituals,ritual_upload_intents CASCADE",
  );
  await db.insert(schema.user).values({
    id: ids.actor,
    name: "Uploader",
    email: "uploader@example.test",
  });
  await db.insert(schema.rituals).values({
    id: ids.ritual,
    creatorId: ids.actor,
    title: "Synthetic ritual",
    scope: "public",
  });
  await db.insert(schema.ritualUploadIntents).values({
    operationId: ids.operation,
    actorId: ids.actor,
    ritualId: ids.ritual,
    requestHash: "a".repeat(64),
    filename: "private.png",
    byteSize: bytes.length,
    contentType: "image/png",
    sha256: digest,
    fileId: ids.file,
    attachmentId: ids.attachment,
    stagingProvider: "r2",
    stagingBucket: "private-files",
    stagingObjectKey: `ritual-staging/${ids.operation}`,
    canonicalProvider: "r2",
    canonicalBucket: "private-files",
    canonicalObjectKey: `ritual-files/${ids.file}/${digest}`,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    claimId: createUuidV7(),
    claimStartedAt: now,
    claimExpiresAt: new Date(now.getTime() + 30_000),
    completedAt: new Date(now.getTime() + 1_000),
  });
  await db.insert(schema.loomFilesTable).values({
    id: ids.file,
    sha256: digest,
    byteSize: bytes.length,
    originalFilename: "private.png",
    contentType: "image/png",
    detectedContentType: "image/png",
    kind: "image",
    storageProvider: "r2",
    bucket: "private-files",
    objectKey: `ritual-files/${ids.file}/${digest}`,
    ownerType: "user",
    ownerId: ids.actor,
    visibility: "private",
    imageMeta: { format: "png", width: 1, height: 1 },
    audioMeta: null,
    meta: {},
  });
  await db.insert(schema.ritualFileLinks).values({
    id: ids.attachment,
    operationId: ids.operation,
    ritualId: ids.ritual,
    fileId: ids.file,
    uploaderId: ids.actor,
    createdAt: now,
  });
});

describe("SQL ritual file repository", () => {
  it("returns only the exact finalized private attachment binding", async () => {
    const repository = createSqlRitualFileRepository(db);
    await expect(repository.findById?.(ids.file)).resolves.toMatchObject({
      id: ids.file,
      ritualId: ids.ritual,
      attachmentId: ids.attachment,
      operationId: ids.operation,
      visibility: "private",
      storageProvider: "r2",
    });
    await expect(repository.findBySha256(digest)).resolves.toBeNull();
  });

  it("withholds removed links and nonprivate or inconsistent rows", async () => {
    const repository = createSqlRitualFileRepository(db);
    await db
      .update(schema.ritualFileLinks)
      .set({ deletedAt: new Date(now.getTime() + 2_000) })
      .where(eq(schema.ritualFileLinks.id, ids.attachment));
    await expect(repository.findById?.(ids.file)).resolves.toBeNull();

    await db
      .update(schema.ritualFileLinks)
      .set({ deletedAt: null })
      .where(eq(schema.ritualFileLinks.id, ids.attachment));
    await db
      .update(schema.loomFilesTable)
      .set({ visibility: "public" })
      .where(eq(schema.loomFilesTable.id, ids.file));
    await expect(repository.findById?.(ids.file)).resolves.toBeNull();
  });

  it("withholds uncompleted intents and invalid lookup IDs", async () => {
    const repository = createSqlRitualFileRepository(db);
    await db
      .update(schema.ritualUploadIntents)
      .set({ completedAt: null })
      .where(eq(schema.ritualUploadIntents.operationId, ids.operation));
    await expect(repository.findById?.(ids.file)).resolves.toBeNull();
    await expect(repository.findById?.("invalid")).resolves.toBeNull();
  });

  it("accepts only the explicitly configured finalized provider", async () => {
    await db
      .update(schema.ritualUploadIntents)
      .set({ stagingProvider: "minio", canonicalProvider: "minio" })
      .where(eq(schema.ritualUploadIntents.operationId, ids.operation));
    await db
      .update(schema.loomFilesTable)
      .set({ storageProvider: "minio" })
      .where(eq(schema.loomFilesTable.id, ids.file));
    await expect(
      createSqlRitualFileRepository(db, {
        storageProvider: "minio",
      }).findById?.(ids.file),
    ).resolves.toMatchObject({
      id: ids.file,
      storageProvider: "minio",
    });
    await expect(
      createSqlRitualFileRepository(db).findById?.(ids.file),
    ).resolves.toBeNull();
  });
});
