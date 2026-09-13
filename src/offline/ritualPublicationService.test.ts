import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type { PreparedRitualBundle } from "./prepareRitualBundle";
import type { RitualBundleStorageReceiptV1 } from "./ritualBundlePublication";
import { createRitualPublicationService } from "./ritualPublicationService";
import type { ReservedRitualBundle } from "./sqlRitualBundlePublications";
import type { RitualPublicationSelection } from "./sqlRitualPublicationSelection";

vi.mock("server-only", () => ({}));

const ids = {
  operation: createUuidV7(),
  actor: createUuidV7(),
  ritual: createUuidV7(),
  revision: createUuidV7(),
  artifact: createUuidV7(),
  bundle: createUuidV7(),
  claim: createUuidV7(),
  assets: [createUuidV7(), createUuidV7()],
};
const sha = createHash("sha256").update("publication").digest("hex");
const selection: RitualPublicationSelection = {
  ritualId: ids.ritual,
  title: "Published ritual",
  contentJson: "{}",
  currentRevisionId: ids.revision,
  currentCompiledArtifactId: ids.artifact,
  version: 3,
  descriptor: {
    descriptorSha256: sha,
    contentSha256: sha,
    outputFormat: "json-rich-text",
    outputFormatVersion: "1",
  },
};
const request = {
  version: 1 as const,
  operationId: ids.operation,
  expectedActorId: ids.actor,
  ritualId: ids.ritual,
  expectedRevisionId: ids.revision,
  expectedVersion: 3,
};
const reservations = ids.assets.map((key, assetIndex) => ({
  operationId: ids.operation,
  bundleId: ids.bundle,
  ritualId: ids.ritual,
  key,
  assetIndex,
  reference: `/asset-${assetIndex}.png`,
  sha256: sha,
  mime: "image/png" as const,
  byteSize: 3,
  storageProvider: "r2:synthetic",
  bucket: "private-bucket",
  objectKey: `ritual-bundles/${ids.bundle}/${key}`,
}));
const claim = {
  operationId: ids.operation,
  actorId: ids.actor,
  bundleId: ids.bundle,
  ritualId: ids.ritual,
  manifestSha256: sha,
  claimId: ids.claim,
  claimStartedAtMs: 1,
  claimExpiresAtMs: 10_000,
  intentExpiresAtMs: 20_000,
  assets: reservations,
};
const receipt = {
  operationId: ids.operation,
  bundleId: ids.bundle,
  ritualId: ids.ritual,
  manifestSha256: sha,
  descriptorSha256: sha,
  publishedAtMs: 2,
};
const publicReceipt = {
  operationId: receipt.operationId,
  bundleId: receipt.bundleId,
  ritualId: receipt.ritualId,
  publishedAtMs: receipt.publishedAtMs,
};
const reserved: ReservedRitualBundle = {
  operationId: ids.operation,
  actorId: ids.actor,
  bundleId: ids.bundle,
  ritualId: ids.ritual,
  manifestJson: "{}",
  manifestSha256: sha,
  planJson: "{}",
  planSha256: sha,
  publicationPolicyId: "private-v1",
  intentExpiresAtMs: 20_000,
  assets: reservations,
};

function prepared(copies: Uint8Array[]): PreparedRitualBundle {
  return {
    kind: "prepared",
    manifest: {} as PreparedRitualBundle["manifest"],
    manifestJson: "{}",
    manifestSha256: sha,
    plan: {} as PreparedRitualBundle["plan"],
    copyBytes(key) {
      const index = ids.assets.indexOf(key);
      const value = Uint8Array.from([index + 1, 2, 3]);
      copies.push(value);
      return value;
    },
    dispose: vi.fn(),
  };
}

function services() {
  const copies: Uint8Array[] = [];
  const value = prepared(copies);
  const loadSelection = vi.fn(async () => structuredClone(selection));
  type Dependencies = Parameters<typeof createRitualPublicationService>[0];
  const initiate = vi.fn<Dependencies["publisher"]["initiate"]>(async () => ({
    kind: "reserved" as const,
    replayed: false,
    reservation: reserved,
  }));
  const claimOperation = vi.fn<Dependencies["publisher"]["claim"]>(
    async () => ({
      kind: "claimed" as const,
      claim,
      reservation: reserved,
    }),
  );
  const publisher = {
    initiate,
    claim: claimOperation,
    publish: vi.fn(async () => receipt),
    releaseClaim: vi.fn(async () => {}),
  };
  const storage = {
    ensureAsset: vi.fn(
      async ({ assetKey }: { assetKey: string }) =>
        ({
          profile: "magickli-ritual-bundle-object-receipt-v1",
          operationId: ids.operation,
          bundleId: ids.bundle,
          assetKey,
          claimId: ids.claim,
          storageProvider: "r2:synthetic",
          bucket: "private-bucket",
          objectKey: `ritual-bundles/${ids.bundle}/${assetKey}`,
          sha256: sha,
          mime: "image/png",
          byteSize: 3,
          verifiedAtMs: 2,
        }) satisfies RitualBundleStorageReceiptV1,
    ),
  };
  return {
    copies,
    value,
    loadSelection,
    publisher,
    storage,
    publish: createRitualPublicationService({
      loadSelection,
      buildPrepared: vi.fn(async () => value),
      publisher,
      storage,
    }),
  };
}

describe("ritual publication orchestration", () => {
  it("reserves before object work and rechecks editor policy before every mutation", async () => {
    const s = services();
    await expect(s.publish(request)).resolves.toEqual({
      ok: true,
      state: "completed",
      replayed: false,
      receipt: publicReceipt,
    });
    expect(s.publisher.initiate).toHaveBeenCalledBefore(s.publisher.claim);
    expect(s.publisher.claim).toHaveBeenCalledBefore(s.storage.ensureAsset);
    expect(s.loadSelection).toHaveBeenCalledTimes(5);
    expect(s.storage.ensureAsset).toHaveBeenCalledTimes(2);
    expect(s.publisher.publish).toHaveBeenCalledTimes(1);
    expect(s.copies.every((bytes) => bytes.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(s.value.dispose).toHaveBeenCalledTimes(1);
  });

  it("stops between provider writes when the current editor grant is revoked", async () => {
    const s = services();
    s.loadSelection.mockImplementation(async () => {
      if (s.loadSelection.mock.calls.length === 4)
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      return structuredClone(selection);
    });
    await expect(s.publish(request)).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      retryable: false,
    });
    expect(s.storage.ensureAsset).toHaveBeenCalledTimes(1);
    expect(s.publisher.publish).not.toHaveBeenCalled();
    expect(s.publisher.releaseClaim).toHaveBeenCalledWith(
      claim,
      expect.any(AbortSignal),
    );
  });

  it("returns a completed replay without claiming or touching storage", async () => {
    const s = services();
    s.publisher.initiate.mockResolvedValueOnce({
      kind: "completed",
      receipt,
    });
    await expect(s.publish(request)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      receipt: publicReceipt,
    });
    expect(s.publisher.claim).not.toHaveBeenCalled();
    expect(s.storage.ensureAsset).not.toHaveBeenCalled();
  });

  it("rejects malformed input before loading policy", async () => {
    const s = services();
    await expect(s.publish({ ...request, extra: true })).resolves.toMatchObject(
      {
        ok: false,
        code: "INVALID_REQUEST",
      },
    );
    expect(s.loadSelection).not.toHaveBeenCalled();
  });
});
