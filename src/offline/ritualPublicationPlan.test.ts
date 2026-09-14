import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLegacyRitualImageCatalog,
  type LegacyRitualImageSource,
} from "../files/legacyRitualImageCatalog";
import type { RitualFileRecord } from "../files/repository";
import { formatRitualFileLocator } from "../files/ritualFileLocator";
import { createUuidV7 } from "../lib/ids";
import { deriveRitualPublicationIdentity } from "./ritualPublicationIdentity";
import { createRitualPublicationPlanBuilder } from "./ritualPublicationPlan";
import { createRitualRenderDescriptor } from "./ritualRenderDescriptor";

vi.mock("server-only", () => ({}));
vi.mock("../files/generatedRitualImageCatalog", () => ({
  createGeneratedRitualImageCatalog: vi.fn(),
}));
vi.mock("../files/legacyRitualImageCatalog", async (original) => {
  const module =
    await original<typeof import("../files/legacyRitualImageCatalog")>();
  return {
    ...module,
    createLegacyRitualImageCatalog: vi.fn(
      module.createLegacyRitualImageCatalog,
    ),
  };
});

let root: string;
let publicDirectory: string;
let bytes: Uint8Array;
const ids = {
  operation: createUuidV7(),
  actor: createUuidV7(),
  ritual: createUuidV7(),
  revision: createUuidV7(),
  artifact: createUuidV7(),
  attachment: createUuidV7(),
  file: createUuidV7(),
};
const locator = {
  ritualId: ids.ritual,
  attachmentId: ids.attachment,
  fileId: ids.file,
};
const source = formatRitualFileLocator(locator);
const contentJson = JSON.stringify({
  children: [{ type: "img", src: source }],
});
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const selection = {
  ritualId: ids.ritual,
  title: "Private image ritual",
  contentJson,
  currentRevisionId: ids.revision,
  currentCompiledArtifactId: ids.artifact,
  version: 4,
  descriptor: createRitualRenderDescriptor(
    {
      id: ids.ritual,
      currentRevisionId: ids.revision,
      currentCompiledArtifactId: ids.artifact,
      version: 4,
    },
    { contentSha256: hash(contentJson) },
  ),
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "ritual-publication-plan-"));
  publicDirectory = path.join(root, "public");
  await fs.mkdir(publicDirectory);
  bytes = Uint8Array.from(
    await sharp({
      create: { width: 3, height: 2, channels: 4, background: "red" },
    })
      .png()
      .toBuffer(),
  );
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function record(): RitualFileRecord {
  return {
    id: ids.file,
    ritualId: ids.ritual,
    attachmentId: ids.attachment,
    operationId: createUuidV7(),
    audioMeta: null,
    bucket: "private-files",
    byteSize: bytes.length,
    contentType: "image/png",
    detectedContentType: "image/png",
    imageMeta: { format: "png", width: 3, height: 2 },
    kind: "image",
    meta: {},
    objectKey: `ritual-files/${ids.file}`,
    originalFilename: "private.png",
    ownerId: ids.actor,
    ownerType: "user",
    sha256: hash(bytes),
    storageProvider: "r2",
    visibility: "private",
  };
}

describe("ritual publication plan runtime", () => {
  it("captures an authorized private locator into deterministic prepared evidence", async () => {
    const read = vi.fn(async () => ({
      record: record(),
      bytes: bytes.slice(),
    }));
    const build = createRitualPublicationPlanBuilder({
      publicDirectory,
      environment: {},
      readAuthorizedPrivateFile: read,
      loadLegacySources: async () => [],
    });
    const prepared = await build({ selection, operationId: ids.operation });
    try {
      expect(read).toHaveBeenCalledWith(locator);
      expect(prepared.manifest.assets).toHaveLength(1);
      expect(prepared.manifest.assets[0]).toMatchObject({
        reference: source,
        sha256: hash(bytes),
        mime: "image/png",
        bytes: bytes.length,
      });
      expect(prepared.plan.privateCatalogSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(prepared.manifest.bundleId).toBe(
        deriveRitualPublicationIdentity(ids.operation, 1).bundleId,
      );
    } finally {
      prepared.dispose();
    }
  });

  it("fails closed when the current private file cannot be authorized", async () => {
    const build = createRitualPublicationPlanBuilder({
      publicDirectory,
      environment: {},
      readAuthorizedPrivateFile: async () => null,
      loadLegacySources: async () => [],
    });
    await expect(
      build({ selection, operationId: ids.operation }),
    ).rejects.toMatchObject({
      code: "INCOMPLETE",
    });
  });

  it("routes legacy publication capture through the fixed replacement credentials", async () => {
    const legacySha256 = "a".repeat(64);
    const legacyContentJson = JSON.stringify({
      children: [{ type: "img", src: `/api/file2?sha256=${legacySha256}` }],
    });
    const legacySelection = {
      ...selection,
      contentJson: legacyContentJson,
      descriptor: createRitualRenderDescriptor(
        {
          id: selection.ritualId,
          currentRevisionId: selection.currentRevisionId,
          currentCompiledArtifactId: selection.currentCompiledArtifactId,
          version: selection.version,
        },
        { contentSha256: hash(legacyContentJson) },
      ),
    };
    const source = { relocation: {} } as LegacyRitualImageSource;
    const stop = new Error("catalog wiring inspected");
    vi.mocked(createLegacyRitualImageCatalog).mockRejectedValueOnce(stop);
    const loadLegacySources = vi.fn(async () => [source]);
    const build = createRitualPublicationPlanBuilder({
      publicDirectory,
      environment: {
        FILES_STORAGE_PROVIDER: "cloudflare-r2",
        FILES_S3_REGION: "auto",
        FILES_S3_FORCE_PATH_STYLE: "true",
        FILES_S3_ENDPOINT:
          "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
        FILES_S3_BUCKET: "magickli-files-production",
        FILES_S3_ACCESS_KEY_ID: "NEWEXAMPLE",
        FILES_S3_SECRET_ACCESS_KEY: "new-synthetic-only",
      },
      readAuthorizedPrivateFile: async () => null,
      loadLegacySources,
    });

    await expect(
      build({ selection: legacySelection, operationId: ids.operation }),
    ).rejects.toBe(stop);
    expect(loadLegacySources).toHaveBeenCalledWith([legacySha256]);
    expect(createLegacyRitualImageCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [source],
        storage: [
          expect.objectContaining({
            bucket: "magickli-files-production",
            region: "auto",
          }),
        ],
      }),
    );
  });
});
