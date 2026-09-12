import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type {
  OfflineAccount,
  PendingPermissionCheck,
  PermissionReply,
} from "./lease";
import { OfflineRitualRepository } from "./repository";
import type {
  OfflineClockObservation,
  OfflineRuntimeState,
} from "./runtimeState";
import {
  type RitualBundle,
  RitualOfflineDatabase,
  type StoredAsset,
} from "./storage";

const A = "01993000-0000-7000-8000-000000000001";
const R = "01993000-0000-7000-8000-000000000010";
const R2 = "01993000-0000-7000-8000-000000000011";
const START = 2_000_000_000_000;
const dbs: RitualOfflineDatabase[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function fixture() {
  const db = new RitualOfflineDatabase(`runtime-${createUuidV7()}`, {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  dbs.push(db);
  let now = START;
  return {
    db,
    repo: new OfflineRitualRepository(db, () => now),
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
  };
}
function grant(
  pending: PendingPermissionCheck,
  duration = 1000,
  sourceEdit = true,
): PermissionReply {
  return {
    kind: "granted",
    ownerId: A,
    ritualId: pending.ritualId,
    requestId: pending.requestId,
    grant: {
      version: 1,
      leaseId: createUuidV7(),
      ownerId: A,
      ritualId: pending.ritualId,
      checkedAtMs: pending.startedAtMs,
      respondedAtMs: pending.startedAtMs,
      expiresAtMs: pending.startedAtMs + duration,
      sourceEdit,
    },
  };
}
async function install(
  f: ReturnType<typeof fixture>,
  account: OfflineAccount,
  ritualId = R,
  duration = 1000,
) {
  const check = await f.repo.beginCheck(account, ritualId);
  const bundle: RitualBundle = {
    version: 1,
    ownerId: A,
    ritualId,
    bundleId: createUuidV7(),
    title: "Synthetic private title",
    renderedJson: '["p",{},"synthetic"]',
    renderedSha256: await hash('["p",{},"synthetic"]'),
    rendererFormat: "jrt-v1",
    assets: [
      {
        key: "image",
        reference: "/protected/synthetic",
        sha256: await hash("image"),
        bytes: 5,
        mime: "image/png",
        purpose: "read",
      },
    ],
  };
  const assets: StoredAsset[] = bundle.assets.map((entry) => ({
    ...entry,
    ownerId: A,
    ritualId,
    bundleId: bundle.bundleId,
    blob: new Blob(["image"], { type: "image/png" }),
  }));
  const reply = grant(check, duration);
  await f.repo.acceptPermission(check, reply, bundle.bundleId);
  expect(await f.repo.installBundle(check, bundle, assets)).toBe(true);
  return { bundle, assets, check, reply };
}
function observation(
  state: OfflineRuntimeState,
  at = state.observedAtMs,
): OfflineClockObservation {
  return {
    account: state.account!,
    observedAtMs: at,
    leases: state.resources.map(({ ritualId, leaseId, bundleLeaseId }) => ({
      ritualId,
      leaseId,
      bundleLeaseId,
    })),
  };
}

describe("safe offline runtime inspection", () => {
  it("has no authority at cold start and exposes only requested metadata", async () => {
    const f = fixture();
    expect(await f.repo.runtimeState([R])).toEqual({
      account: null,
      cleanupPending: false,
      observedAtMs: START,
      resources: [],
    });
    const account = await f.repo.activateAccount(A);
    await install(f, account);
    await install(f, account, R2);
    const state = await f.repo.runtimeState([R, R]);
    expect(state.resources).toHaveLength(1);
    expect(state.resources[0]).toMatchObject({
      ritualId: R,
      read: true,
      sourceEdit: true,
      readDeadlineMs: START + 1000,
      sourceDeadlineMs: START + 1000,
    });
    expect(Object.keys(state.resources[0]).sort()).toEqual(
      [
        "ritualId",
        "read",
        "sourceEdit",
        "readDeadlineMs",
        "sourceDeadlineMs",
        "leaseId",
        "bundleLeaseId",
      ].sort(),
    );
    expect(JSON.stringify(state)).not.toContain("Synthetic private title");
  });
  it("does not advertise a bundle for a source-only permission check", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    const check = await f.repo.beginCheck(account, R);
    await f.repo.acceptPermission(check, grant(check));
    expect((await f.repo.runtimeState([R])).resources[0]).toMatchObject({
      read: false,
      readDeadlineMs: null,
      sourceEdit: true,
      sourceDeadlineMs: START + 1000,
      bundleLeaseId: null,
    });
  });
  it("uses the old bundle deadline after a new check-only grant", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    await install(f, account);
    f.now += 100;
    const check = await f.repo.beginCheck(account, R);
    await f.repo.acceptPermission(check, grant(check, 2000));
    expect((await f.repo.runtimeState([R])).resources[0]).toMatchObject({
      read: true,
      readDeadlineMs: START + 1000,
      sourceDeadlineMs: START + 2100,
    });
    f.now = START + 1000;
    expect((await f.repo.runtimeState([R])).resources[0]).toMatchObject({
      read: false,
      sourceEdit: true,
      readDeadlineMs: null,
    });
    expect(await f.db.bundles.count()).toBe(0);
  });
  it.each(["absent", "owner", "ritual", "bundle", "metadata", "blob"])(
    "never advertises Ready with %s read asset evidence",
    async (issue) => {
      const f = fixture();
      const account = await f.repo.activateAccount(A);
      const data = await install(f, account);
      const key: [string, string, string, string] = [
        A,
        R,
        data.bundle.bundleId,
        "image",
      ];
      if (issue === "absent") await f.db.assets.delete(key);
      else {
        const stored = data.assets[0];
        // Reading hooks simulate malformed persisted evidence without changing its lookup key.
        f.db.assets.hook("reading", (row) =>
          row
            ? {
                ...row,
                ...(issue === "owner"
                  ? { ownerId: createUuidV7() }
                  : issue === "ritual"
                    ? { ritualId: R2 }
                    : issue === "bundle"
                      ? { bundleId: createUuidV7() }
                      : issue === "metadata"
                        ? { sha256: "0".repeat(64) }
                        : { blob: new Blob(["bad"], { type: stored.mime }) }),
              }
            : row,
        );
      }
      expect((await f.repo.runtimeState([R])).resources[0]).toMatchObject({
        read: false,
        readDeadlineMs: null,
        sourceEdit: true,
      });
    },
  );
  it("sweeps expired unviewed downloads without deleting unique drafts", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    await install(f, account, R);
    await install(f, account, R2, 5000);
    const draft = {
      ownerId: A,
      ritualId: R,
      id: createUuidV7(),
      source: "unique text",
      savedSource: "",
      expectedRevisionId: createUuidV7(),
      expectedVersion: 1,
      updatedAtMs: f.now,
    };
    await f.repo.preserveDraft(draft, null);
    f.now += 1000;
    expect((await f.repo.runtimeState([R2])).resources[0].read).toBe(true);
    expect(await f.db.bundles.get([A, R])).toBeUndefined();
    expect(await f.db.drafts.count()).toBe(1);
    expect(await f.repo.readDraft(account, R, draft.id)).toBeNull();
    expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
  });
  it("latches an actual high observation and ignores it after a corrected fresh grant", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    await install(f, account);
    const old = observation(await f.repo.runtimeState([R]), START + 500);
    f.now = START + 100;
    expect((await f.repo.runtimeState([R], old)).resources[0]).toMatchObject({
      read: false,
      sourceEdit: false,
    });
    expect((await f.db.authorizations.get([A, R]))?.lock).toBe(
      "clock-rollback",
    );
    const fresh = await install(f, account);
    const state = await f.repo.runtimeState([R], old);
    expect(state.resources[0]).toMatchObject({
      read: true,
      sourceEdit: true,
      readDeadlineMs: START + 1100,
    });
    expect(state.resources[0].leaseId).not.toBe(old.leases[0].leaseId);
    expect((await f.db.authorizations.get([A, R]))?.grant).toEqual(
      fresh.reply.kind === "granted" ? fresh.reply.grant : null,
    );
  });
  it("matches the bundle's independent old lease without poisoning the newer source grant", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    await install(f, account);
    const old = observation(await f.repo.runtimeState([R]), START + 500);
    f.now = START + 100;
    const check = await f.repo.beginCheck(account, R);
    await f.repo.acceptPermission(check, grant(check, 2000));
    const state = await f.repo.runtimeState([R], old);
    expect(state.resources[0]).toMatchObject({
      read: false,
      sourceEdit: true,
      sourceDeadlineMs: START + 2100,
    });
    expect((await f.db.authorizations.get([A, R]))?.lock).toBeNull();
    expect(await f.db.bundles.count()).toBe(0);
  });
  it("never applies old-epoch observations to a reauthenticated account", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    await install(f, account);
    const old = observation(await f.repo.runtimeState([R]), START + 900);
    await f.repo.signOut(account);
    const next = await f.repo.activateAccount(A);
    await install(f, next);
    expect((await f.repo.runtimeState([R], old)).resources[0].read).toBe(true);
  });
  it("reports pending cleanup with no identity/rights and malformed active identities fail closed", async () => {
    const f = fixture();
    await f.db.device.put({ key: "active", account: null, cleanupOwnerId: A });
    expect(await f.repo.runtimeState([R])).toMatchObject({
      account: null,
      cleanupPending: true,
      resources: [],
    });
    await f.db.device.put({
      key: "active",
      account: { ownerId: A, epoch: "malformed" },
      cleanupOwnerId: null,
    });
    await expect(f.repo.runtimeState([R])).rejects.toMatchObject({
      code: "ACCOUNT",
    });
  });
  it("rejects malformed requested identities or observations before touching storage", async () => {
    const f = fixture();
    await expect(async () =>
      f.repo.runtimeState(["bad"]),
    ).rejects.toMatchObject({ code: "INVALID" });
    const account = await f.repo.activateAccount(A);
    await expect(async () =>
      f.repo.runtimeState([R], { account, observedAtMs: -1, leases: [] }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

it("expires an unviewed bundle's original lease despite a fresh source-only grant, preserving unique work", async () => {
  const f = fixture();
  const account = await f.repo.activateAccount(A);
  await install(f, account);
  const draft = {
    ownerId: A,
    ritualId: R,
    id: createUuidV7(),
    source: "Unique unviewed draft",
    savedSource: "",
    expectedRevisionId: createUuidV7(),
    expectedVersion: 1,
    updatedAtMs: f.now,
  };
  await f.repo.preserveDraft(draft, null);
  const command = {
    version: 2 as const,
    kind: "save" as const,
    operationId: createUuidV7(),
    expectedActorId: A,
    ritualId: R,
    expectedRevisionId: draft.expectedRevisionId,
    expectedVersion: 1,
    source: draft.source,
  };
  await f.repo.enqueueSave(account, command);
  f.now += 100;
  const check = await f.repo.beginCheck(account, R);
  await f.repo.acceptPermission(check, grant(check, 2000));
  f.now = START + 1000;
  expect(await f.repo.runtimeState([])).toMatchObject({
    account,
    resources: [],
  });
  expect(await f.db.bundles.count()).toBe(0);
  expect(await f.db.assets.count()).toBe(0);
  expect(await f.db.drafts.count()).toBe(1);
  expect(await f.db.outbox.count()).toBe(1);
  expect((await f.repo.runtimeState([R])).resources[0]).toMatchObject({
    read: false,
    sourceEdit: true,
    sourceDeadlineMs: START + 2100,
  });
  expect((await f.repo.readDraft(account, R, draft.id))?.source).toBe(
    draft.source,
  );
});
