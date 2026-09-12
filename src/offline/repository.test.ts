import Dexie from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SqlRitualWriteRequest,
  SqlRitualWriteResult,
} from "../doc/sqlWriteContract";
import { createUuidV7 } from "../lib/ids";
import {
  type OfflineAccount,
  type PendingPermissionCheck,
  type PermissionReply,
  OFFLINE_AUTHORIZATION_WINDOW_MS as WINDOW,
} from "./lease";
import { OfflineRitualRepository } from "./repository";
import {
  type AssetManifestEntry,
  type DraftInput,
  type RitualBundle,
  RitualOfflineDatabase,
  type StoredAsset,
} from "./storage";

const A = "01993000-0000-7000-8000-000000000001";
const B = "01993000-0000-7000-8000-000000000002";
const R = "01993000-0000-7000-8000-000000000010";
const R2 = "01993000-0000-7000-8000-000000000011";
const REV = "01993000-0000-7000-8000-000000000020";
const START = 2_000_000_000_000;
const instances: RitualOfflineDatabase[] = [];
afterEach(async () => {
  for (const db of instances.splice(0)) db.close();
});
async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}
function fixture() {
  const options = { indexedDB: new IDBFactory(), IDBKeyRange };
  const name = `synthetic-${createUuidV7()}`;
  const db = new RitualOfflineDatabase(name, options);
  instances.push(db);
  let now = START;
  const repo = new OfflineRitualRepository(db, () => now);
  return {
    db,
    repo,
    options,
    name,
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function allowed(
  pending: PendingPermissionCheck,
  sourceEdit = true,
  duration = WINDOW,
): PermissionReply {
  return {
    requestId: pending.requestId,
    ownerId: pending.ownerId,
    ritualId: pending.ritualId,
    kind: "granted",
    grant: {
      version: 1,
      leaseId: createUuidV7(),
      ownerId: pending.ownerId,
      ritualId: pending.ritualId,
      checkedAtMs: pending.startedAtMs,
      respondedAtMs: pending.startedAtMs,
      expiresAtMs: pending.startedAtMs + duration,
      sourceEdit,
    },
  };
}
async function downloaded(
  account: OfflineAccount,
  ritualId = R,
  sourceAsset = false,
) {
  const bundleId = createUuidV7();
  const entries: AssetManifestEntry[] = [
    {
      key: "image",
      reference: "/protected/image?a=1#crop",
      sha256: await digest("read-image"),
      mime: "image/png",
      bytes: 10,
      purpose: "read",
    },
  ];
  if (sourceAsset)
    entries.push({
      key: "editor",
      reference: "/protected/source",
      sha256: await digest("source-image"),
      mime: "image/png",
      bytes: 12,
      purpose: "source",
    });
  const bundle: RitualBundle = {
    version: 1,
    ownerId: account.ownerId,
    ritualId,
    bundleId,
    title: "Synthetic ritual",
    renderedJson: '["p",{},"Rendered only"]',
    renderedSha256: await digest('["p",{},"Rendered only"]'),
    rendererFormat: "jrt-v1",
    assets: entries,
  };
  const assets: StoredAsset[] = entries.map((entry) => ({
    ...entry,
    ownerId: account.ownerId,
    ritualId,
    bundleId,
    blob: new Blob([entry.purpose === "read" ? "read-image" : "source-image"], {
      type: entry.mime,
    }),
  }));
  return { bundle, assets };
}
async function ready(f: Fixture, sourceEdit = true, sourceAsset = false) {
  const account = await f.repo.activateAccount(A);
  const pending = await f.repo.beginCheck(account, R);
  const data = await downloaded(account, R, sourceAsset);
  await f.repo.acceptPermission(
    pending,
    allowed(pending, sourceEdit),
    data.bundle.bundleId,
  );
  expect(await f.repo.installBundle(pending, data.bundle, data.assets)).toBe(
    true,
  );
  return { account, pending, ...data };
}
function draft(ownerId = A, ritualId = R): DraftInput {
  return {
    ownerId,
    ritualId,
    id: createUuidV7(),
    source: "\nExact source שלום  \r\n",
    savedSource: "previous source",
    expectedRevisionId: REV,
    expectedVersion: 4,
    updatedAtMs: START,
  };
}
function command(
  ownerId = A,
  ritualId = R,
): Extract<SqlRitualWriteRequest, { kind: "save" }> {
  return {
    version: 2,
    kind: "save",
    operationId: createUuidV7(),
    expectedActorId: ownerId,
    ritualId,
    expectedRevisionId: REV,
    expectedVersion: 4,
    source: "\nExact source שלום  \r\n",
  };
}
const failure = (
  code: Extract<SqlRitualWriteResult, { ok: false }>["code"],
): SqlRitualWriteResult => ({
  ok: false,
  code,
  message: "Synthetic safe failure",
  retryable: code === "RETRYABLE" || code === "UNAVAILABLE",
});

describe("real Dexie account/resource transactions", () => {
  it("starts without authority and binds a verified canonical account without renewing on repeated sessions", async () => {
    const f = fixture();
    await expect(f.repo.activateAccount("anonymous")).rejects.toMatchObject({
      code: "INVALID",
    });
    const account = await f.repo.activateAccount(A);
    expect(await f.repo.activateAccount(A)).toEqual(account);
    expect(await f.repo.readBundle(account, R)).toBeNull();
    await expect(f.repo.activateAccount(B)).rejects.toMatchObject({
      code: "ACCOUNT",
    });
    expect(await f.db.authorizations.count()).toBe(0);
  });
  it("publishes exact complete rendered data/assets while keeping source metadata separate", async () => {
    const f = fixture();
    const r = await ready(f, true, true);
    expect(await f.repo.readBundle(r.account, R)).toMatchObject({
      renderedJson: r.bundle.renderedJson,
      assets: [{ key: "image" }],
    });
    expect(await f.repo.readBundle(r.account, R)).not.toHaveProperty(
      "authorization",
    );
    expect(await (await f.repo.readAsset(r.account, R, "image"))?.text()).toBe(
      "read-image",
    );
    expect(await f.repo.readAsset(r.account, R, "unknown")).toBeNull();
    expect(
      await f.repo.installSource(r.pending, {
        ownerId: A,
        ritualId: R,
        revisionId: REV,
        parentVersion: 4,
        source: "exact source",
      }),
    ).toBe(true);
    expect(await f.repo.readSource(r.account, R, REV)).toMatchObject({
      source: "exact source",
    });
    expect(await f.repo.readSource(r.account, R2, REV)).toBeNull();
  });
  it("enforces read-only grants on source/draft/export/queue access", async () => {
    const f = fixture();
    const r = await ready(f, false);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    expect(await f.repo.readBundle(r.account, R)).not.toBeNull();
    expect(
      await f.repo.installSource(r.pending, {
        ownerId: A,
        ritualId: R,
        revisionId: REV,
        parentVersion: 4,
        source: "private source",
      }),
    ).toBe(false);
    expect(await f.repo.readSource(r.account, R, REV)).toBeNull();
    expect(await f.repo.readDraft(r.account, R, d.id)).toBeNull();
    expect(await f.repo.exportDraft(r.account, R, d.id)).toBeNull();
    await expect(
      f.repo.enqueueSave(r.account, command()),
    ).rejects.toMatchObject({ code: "LOCKED" });
    expect(await f.db.drafts.get([A, d.id])).toMatchObject(d);
  });
  it("purges editor snapshots/assets and locks exact recovery immediately on capability downgrade", async () => {
    const f = fixture();
    const r = await ready(f, true, true);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    await f.repo.installSource(r.pending, {
      ownerId: A,
      ritualId: R,
      revisionId: REV,
      parentVersion: 4,
      source: "source",
    });
    const pending = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(
      pending,
      allowed(pending, false),
      r.bundle.bundleId,
    );
    expect(await f.db.sources.count()).toBe(0);
    expect(await f.db.assets.count()).toBe(1);
    expect(await f.repo.readAsset(r.account, R, "editor")).toBeNull();
    expect(await f.repo.readBundle(r.account, R)).not.toBeNull();
    expect(await f.repo.exportDraft(r.account, R, d.id)).toBeNull();
    expect(await f.db.drafts.get([A, d.id])).toMatchObject(d);
    const restored = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(
      restored,
      allowed(restored),
      r.bundle.bundleId,
    );
    expect(await f.repo.exportDraft(r.account, R, d.id)).toMatchObject(d);
  });
  it("revokes only the confirmed target and retains unique drafts and pending commands", async () => {
    const f = fixture();
    const r = await ready(f);
    const d = draft();
    const cmd = command();
    await f.repo.preserveDraft(d, null);
    await f.repo.enqueueSave(r.account, cmd);
    const other = await downloaded(r.account, R2);
    const p2 = await f.repo.beginCheck(r.account, R2);
    await f.repo.acceptPermission(p2, allowed(p2), other.bundle.bundleId);
    await f.repo.installBundle(p2, other.bundle, other.assets);
    const pending = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(pending, { ...pending, kind: "denied" });
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect(await f.repo.readBundle(r.account, R2)).not.toBeNull();
    expect(await f.db.drafts.get([A, d.id])).toMatchObject(d);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.payloadJson).toBe(
      JSON.stringify(cmd),
    );
    expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
  });
  it.each(["authentication-required", "temporarily-unavailable"] as const)(
    "does not renew or delete on %s",
    async (kind) => {
      const f = fixture();
      const r = await ready(f);
      const before = await f.db.authorizations.get([A, R]);
      f.now += 1000;
      const pending = await f.repo.beginCheck(r.account, R);
      expect(await f.repo.acceptPermission(pending, { ...pending, kind })).toBe(
        "paused",
      );
      expect(await f.db.authorizations.get([A, R])).toEqual(before);
      expect(await f.repo.readBundle(r.account, R)).not.toBeNull();
    },
  );
  it("locks and purges at exact expiry before reads and preserves text even during a lock", async () => {
    const f = fixture();
    const r = await ready(f);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    f.now = START + WINDOW - 1;
    expect(await f.repo.exportDraft(r.account, R, d.id)).toMatchObject(d);
    f.now++;
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect(await f.db.assets.count()).toBe(0);
    await f.repo.preserveDraft({ ...d, source: "last debounce text" }, 1);
    expect((await f.db.drafts.get([A, d.id]))?.source).toBe(
      "last debounce text",
    );
    expect(await f.repo.exportDraft(r.account, R, d.id)).toBeNull();
    f.now = START + 10;
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
  });
  it("persists observed rollback and sweeps expiry at cold start across database instances", async () => {
    const f = fixture();
    const r = await ready(f);
    f.now += 1000;
    await f.repo.readBundle(r.account, R);
    const db2 = new RitualOfflineDatabase(f.name, f.options);
    instances.push(db2);
    const repo2 = new OfflineRitualRepository(db2, () => START + 500);
    await repo2.sweep(r.account);
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect((await f.db.authorizations.get([A, R]))?.lock).toBe(
      "clock-rollback",
    );
  });
  it("makes sign-out cleanup durable while preserving recovery and refusing old epoch access", async () => {
    const f = fixture();
    const r = await ready(f);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    await f.db.quarantine.put({
      key: "legacy-key",
      originalKey: "old-localStorage",
      serialized: '{"unknown":"raw"}',
    });
    await f.repo.signOut(r.account);
    expect(await f.db.assets.count()).toBe(0);
    expect(await f.db.authorizations.count()).toBe(0);
    expect(await f.db.drafts.get([A, d.id])).toMatchObject(d);
    expect(await f.db.outbox.count()).toBe(1);
    expect(await f.db.quarantine.count()).toBe(1);
    const b = await f.repo.activateAccount(B);
    await expect(f.repo.exportDraft(b, R, d.id)).resolves.toBeNull();
    await expect(f.repo.readBundle(r.account, R)).rejects.toMatchObject({
      code: "ACCOUNT",
    });
    await f.repo.signOut(b);
    const a2 = await f.repo.activateAccount(A);
    expect(a2.epoch).not.toBe(r.account.epoch);
    expect(await f.repo.readDraft(a2, R, d.id)).toBeNull();
  });
  it("commits a fence before purge failure and requires successful cleanup before fresh auth", async () => {
    const f = fixture();
    const r = await ready(f);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    const fail = () => {
      throw new DOMException("Synthetic quota/IO failure", "UnknownError");
    };
    f.db.assets.hook("deleting", fail);
    await expect(f.repo.signOut(r.account)).rejects.toThrow(
      "Synthetic quota/IO failure",
    );
    expect(await f.db.device.get("active")).toMatchObject({
      account: null,
      cleanupOwnerId: A,
    });
    expect(await f.db.assets.count()).toBe(1);
    expect(await f.db.bundles.count()).toBe(1);
    expect(await f.db.authorizations.count()).toBe(1);
    await expect(f.repo.activateAccount(A)).rejects.toMatchObject({
      code: "CLEANUP_PENDING",
    });
    await expect(f.repo.activateAccount(B)).rejects.toMatchObject({
      code: "CLEANUP_PENDING",
    });
    await expect(f.repo.readDraft(r.account, R, d.id)).rejects.toMatchObject({
      code: "CLEANUP_PENDING",
    });
    f.db.assets.hook("deleting").unsubscribe(fail);
    await f.repo.resumeCleanup();
    await f.repo.resumeCleanup();
    expect(await f.db.assets.count()).toBe(0);
    expect(await f.db.drafts.get([A, d.id])).toMatchObject(d);
    expect(await f.repo.activateAccount(A)).not.toEqual(r.account);
  });
  it("ignores stale granted/denied replies and late downloads after A signs out then A returns", async () => {
    const f = fixture();
    const r = await ready(f);
    const pending = await f.repo.beginCheck(r.account, R);
    const bytes = await downloaded(r.account);
    await f.repo.signOut(r.account);
    const a2 = await f.repo.activateAccount(A);
    for (const reply of [
      allowed(pending),
      { ...pending, kind: "denied" } as const,
    ])
      expect(
        await f.repo.acceptPermission(pending, reply, bytes.bundle.bundleId),
      ).toBe("ignored");
    expect(
      await f.repo.installBundle(pending, bytes.bundle, bytes.assets),
    ).toBe(false);
    expect(
      await f.repo.installSource(pending, {
        ownerId: A,
        ritualId: R,
        revisionId: REV,
        parentVersion: 4,
        source: "late",
      }),
    ).toBe(false);
    expect(await f.repo.readBundle(a2, R)).toBeNull();
    expect(await f.db.sources.count()).toBe(0);
  });
  it("lets a newer explicit denial dominate an older permission/download completion", async () => {
    const f = fixture();
    const r = await ready(f);
    const older = await f.repo.beginCheck(r.account, R);
    const newer = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(newer, { ...newer, kind: "denied" });
    expect(
      await f.repo.acceptPermission(older, allowed(older), r.bundle.bundleId),
    ).toBe("ignored");
    expect(await f.repo.installBundle(older, r.bundle, r.assets)).toBe(false);
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
  });
  it("does not extend an old bundle while new authorized output is still incomplete", async () => {
    const f = fixture();
    const r = await ready(f);
    const oldDeadline = (await f.db.bundles.get([A, R]))?.authorization
      .localDeadlineMs;
    f.now = START + WINDOW - 100;
    const pending = await f.repo.beginCheck(r.account, R);
    const next = await downloaded(r.account);
    await f.repo.acceptPermission(
      pending,
      allowed(pending),
      next.bundle.bundleId,
    );
    expect(
      (await f.db.bundles.get([A, R]))?.authorization.localDeadlineMs,
    ).toBe(oldDeadline);
    expect(await f.repo.readBundle(r.account, R)).toMatchObject({
      bundleId: r.bundle.bundleId,
    });
    f.now = START + WINDOW;
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect(await f.repo.installBundle(pending, next.bundle, next.assets)).toBe(
      true,
    );
    expect(await f.repo.readBundle(r.account, R)).toMatchObject({
      bundleId: next.bundle.bundleId,
    });
  });
  it.each(["missing", "digest", "mime", "owner", "duplicate"])(
    "refuses an incomplete %s asset bundle",
    async (fault) => {
      const f = fixture();
      const account = await f.repo.activateAccount(A);
      const pending = await f.repo.beginCheck(account, R);
      const data = await downloaded(account);
      await f.repo.acceptPermission(
        pending,
        allowed(pending),
        data.bundle.bundleId,
      );
      if (fault === "missing") data.assets = [];
      if (fault === "digest")
        data.assets[0] = {
          ...data.assets[0],
          blob: new Blob(["evil-image"], { type: "image/png" }),
        };
      if (fault === "mime")
        data.assets[0] = {
          ...data.assets[0],
          blob: new Blob(["read-image"], { type: "text/html" }),
        };
      if (fault === "owner") data.assets[0].ownerId = B;
      if (fault === "duplicate") {
        data.bundle.assets.push(data.bundle.assets[0]);
        data.assets.push(data.assets[0]);
      }
      await expect(
        f.repo.installBundle(pending, data.bundle, data.assets),
      ).rejects.toMatchObject({ code: "INCOMPLETE" });
      expect(await f.repo.readBundle(account, R)).toBeNull();
      expect(await f.db.assets.count()).toBe(0);
    },
  );
  it("rolls back replacement writes on quota failure without destroying a complete old download", async () => {
    const f = fixture();
    const r = await ready(f);
    const next = await downloaded(r.account);
    const pending = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(
      pending,
      allowed(pending),
      next.bundle.bundleId,
    );
    const fail = () => {
      throw new DOMException("Synthetic full store", "QuotaExceededError");
    };
    f.db.assets.hook("creating", fail);
    await expect(
      f.repo.installBundle(pending, next.bundle, next.assets),
    ).rejects.toThrow("Synthetic full store");
    f.db.assets.hook("creating").unsubscribe(fail);
    expect(await f.repo.readBundle(r.account, R)).toMatchObject({
      bundleId: r.bundle.bundleId,
    });
    expect(await (await f.repo.readAsset(r.account, R, "image"))?.text()).toBe(
      "read-image",
    );
  });
  it("does not let a reader install source assets and does not accept source under another parent", async () => {
    const f = fixture();
    const r = await ready(f, false);
    const data = await downloaded(r.account, R, true);
    const pending = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(
      pending,
      allowed(pending, false),
      data.bundle.bundleId,
    );
    await expect(
      f.repo.installBundle(pending, data.bundle, data.assets),
    ).rejects.toMatchObject({ code: "LOCKED" });
    await expect(
      f.repo.installSource(pending, {
        ownerId: A,
        ritualId: R2,
        revisionId: REV,
        parentVersion: 4,
        source: "foreign parent",
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(await f.db.sources.count()).toBe(0);
  });
  it("does not read corrupted persisted epoch/authorization and never reattributes a foreign draft", async () => {
    const f = fixture();
    const r = await ready(f);
    const foreign = draft(B);
    await f.repo.preserveDraft(foreign, null);
    expect(await f.repo.exportDraft(r.account, R, foreign.id)).toBeNull();
    const auth = await f.db.authorizations.get([A, R]);
    await f.db.authorizations.put({ ...auth!, accountEpoch: "corrupt" });
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect(await f.repo.readSource(r.account, R, REV)).toBeNull();
    expect(await f.db.drafts.get([B, foreign.id])).toMatchObject(foreign);
  });
});

describe("immutable SQL-v2 save outbox", () => {
  it("retains exact source and command bytes, rejecting changed reuse and old/creation protocols", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    await f.repo.enqueueSave(r.account, cmd);
    expect(await f.db.outbox.count()).toBe(1);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.payloadJson).toBe(
      JSON.stringify(cmd),
    );
    await expect(
      f.repo.enqueueSave(r.account, { ...cmd, source: "changed" }),
    ).rejects.toMatchObject({ code: "IMMUTABLE" });
    for (const changes of [
      { version: 1 },
      { kind: "create" },
      { kind: "publish" },
      { expectedActorId: B },
      { expectedRevisionId: "000000000000000000000001" },
    ])
      await expect(
        f.repo.enqueueSave(r.account, { ...cmd, ...changes } as typeof cmd),
      ).rejects.toMatchObject({ code: "INVALID" });
  });
  it("allows only one concurrent sender across two real IndexedDB connections", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const db2 = new RitualOfflineDatabase(f.name, f.options);
    instances.push(db2);
    const repo2 = new OfflineRitualRepository(db2, () => f.now);
    const claims = await Promise.all([
      f.repo.claimSave(r.account, R, cmd.operationId),
      repo2.claimSave(r.account, R, cmd.operationId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.payloadJson).toBe(JSON.stringify(cmd));
  });
  it("reclaims a crashed sender after its bounded claim and ignores its later stale acknowledgement", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const first = await f.repo.claimSave(r.account, R, cmd.operationId);
    expect(first).not.toBeNull();
    f.now += 60_000;
    const second = await f.repo.claimSave(r.account, R, cmd.operationId);
    expect(second?.claimId).not.toBe(first?.claimId);
    expect(second?.payloadJson).toBe(first?.payloadJson);
    expect(await f.repo.settleSave(first!, failure("UNAVAILABLE"))).toBe(false);
    expect(await f.repo.settleSave(second!, failure("UNAVAILABLE"))).toBe(true);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.status).toBe(
      "queued",
    );
  });
  it.each(["UNAVAILABLE", "RETRYABLE"] as const)(
    "retries %s with the original operation identity",
    async (code) => {
      const f = fixture();
      const r = await ready(f);
      const cmd = command();
      await f.repo.enqueueSave(r.account, cmd);
      const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
      expect(await f.repo.settleSave(claim!, failure(code))).toBe(true);
      const retry = await f.repo.claimSave(r.account, R, cmd.operationId);
      expect(retry?.operationId).toBe(cmd.operationId);
      expect(retry?.payloadJson).toBe(JSON.stringify(cmd));
    },
  );
  it.each([
    "CONFLICT",
    "INVALID_SOURCE",
    "NOT_AUTHENTICATED",
    "ACCOUNT_CHANGED",
  ] as const)("preserves and pauses %s pending work", async (code) => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
    await f.repo.settleSave(claim!, failure(code));
    expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
    expect((await f.db.outbox.get([A, cmd.operationId]))?.payloadJson).toBe(
      JSON.stringify(cmd),
    );
    await f.repo.activateAccount(A);
    expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
    const pending = await f.repo.beginCheck(r.account, R);
    await f.repo.acceptPermission(pending, allowed(pending), r.bundle.bundleId);
    expect(Boolean(await f.repo.claimSave(r.account, R, cmd.operationId))).toBe(
      code === "NOT_AUTHENTICATED" || code === "ACCOUNT_CHANGED",
    );
  });
  it("stores an original replay receipt without treating it as current editor state", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const d = draft();
    await f.repo.preserveDraft(d, null);
    const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
    const receipt = {
      ok: true,
      replayed: true,
      ritualId: R,
      revisionId: createUuidV7(),
      version: 5,
      updatedAt: new Date(START).toISOString(),
    } as const;
    expect(await f.repo.settleSave(claim!, receipt)).toBe(true);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.result).toEqual(
      receipt,
    );
    expect(await f.repo.readDraft(r.account, R, d.id)).toMatchObject(d);
    expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
  });
  it("never sends A's queued work or accepts A's late receipt in B's epoch", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
    await f.repo.signOut(r.account);
    const b = await f.repo.activateAccount(B);
    expect(await f.repo.claimSave(b, R, cmd.operationId)).toBeNull();
    expect(await f.repo.settleSave(claim!, failure("UNAVAILABLE"))).toBe(false);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.status).toBe(
      "sending",
    );
    await f.repo.signOut(b);
    const a2 = await f.repo.activateAccount(A);
    expect(await f.repo.claimSave(a2, R, cmd.operationId)).toBeNull();
    const pending = await f.repo.beginCheck(a2, R);
    await f.repo.acceptPermission(pending, allowed(pending), r.bundle.bundleId);
    expect((await f.repo.claimSave(a2, R, cmd.operationId))?.payloadJson).toBe(
      JSON.stringify(cmd),
    );
  });
  it("refuses a mismatched acknowledged parent and leaves the original request recoverable", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
    await expect(
      f.repo.settleSave(claim!, {
        ok: true,
        replayed: false,
        ritualId: R2,
        revisionId: REV,
        version: 5,
        updatedAt: new Date(START).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect((await f.db.outbox.get([A, cmd.operationId]))?.status).toBe(
      "sending",
    );
  });
});

describe("snapshot and suspension boundaries", () => {
  it("preserves simultaneous/stale local draft variants without overwriting or retargeting", async () => {
    const f = fixture();
    const r = await ready(f);
    const d = draft();
    expect(await f.repo.preserveDraft(d, null)).toEqual({
      id: d.id,
      localVersion: 1,
      conflict: false,
    });
    const outcomes = await Promise.all([
      f.repo.preserveDraft({ ...d, source: "first tab newer" }, 1),
      f.repo.preserveDraft({ ...d, source: "second tab unique" }, 1),
    ]);
    expect(outcomes.filter((row) => row.conflict)).toHaveLength(1);
    expect(
      (await f.db.drafts.toArray()).map((row) => row.source).sort(),
    ).toEqual(["first tab newer", "second tab unique"]);
    const moved = await f.repo.preserveDraft(
      { ...d, ritualId: R2, source: "different target" },
      2,
    );
    expect(moved.conflict).toBe(true);
    expect(moved.id).not.toBe(d.id);
    expect((await f.db.drafts.get([A, d.id]))?.ritualId).toBe(R);
    expect(await f.repo.readDraft(r.account, R, moved.id)).toBeNull();
    const missing = await f.repo.preserveDraft(
      { ...d, id: createUuidV7(), source: "evicted base recovery" },
      7,
    );
    expect(missing.conflict).toBe(true);
    expect((await f.db.drafts.get([A, missing.id]))?.source).toBe(
      "evicted base recovery",
    );
  });
  it("snapshots rendered bytes/manifest before asynchronous hashing", async () => {
    const f = fixture();
    const account = await f.repo.activateAccount(A);
    const pending = await f.repo.beginCheck(account, R);
    const data = await downloaded(account);
    await f.repo.acceptPermission(
      pending,
      allowed(pending),
      data.bundle.bundleId,
    );
    const originalJson = data.bundle.renderedJson;
    const install = f.repo.installBundle(pending, data.bundle, data.assets);
    data.bundle.renderedJson = '"mutated unvalidated text"';
    data.bundle.assets[0].purpose = "source";
    data.assets[0].ownerId = B;
    expect(await install).toBe(true);
    expect(await f.repo.readBundle(account, R)).toMatchObject({
      renderedJson: originalJson,
      assets: [{ purpose: "read" }],
    });
    expect((await f.db.assets.toArray())[0].ownerId).toBe(A);
  });
  it("snapshots queue target and exact command before hashing", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    const original = JSON.stringify(cmd);
    const operationId = cmd.operationId;
    const pending = f.repo.enqueueSave(r.account, cmd);
    cmd.operationId = createUuidV7();
    cmd.ritualId = R2;
    cmd.expectedActorId = B;
    cmd.source = "mutated";
    await pending;
    expect(await f.db.outbox.count()).toBe(1);
    expect(await f.db.outbox.get([A, operationId])).toMatchObject({
      ownerId: A,
      ritualId: R,
      payloadJson: original,
    });
  });
  it.each(["source", "draft", "asset", "claim"] as const)(
    "does not return %s bytes when the IDB read resumes at the deadline",
    async (kind) => {
      const f = fixture();
      const r = await ready(f);
      const d = draft();
      const cmd = command();
      await f.repo.preserveDraft(d, null);
      await f.repo.enqueueSave(r.account, cmd);
      await f.repo.installSource(r.pending, {
        ownerId: A,
        ritualId: R,
        revisionId: REV,
        parentVersion: 4,
        source: "source",
      });
      const table =
        kind === "source"
          ? f.db.sources
          : kind === "draft"
            ? f.db.drafts
            : kind === "asset"
              ? f.db.assets
              : f.db.outbox;
      const advance = (value: unknown) => {
        f.now = START + WINDOW;
        return value;
      };
      table.hook("reading", advance);
      const value =
        kind === "source"
          ? await f.repo.readSource(r.account, R, REV)
          : kind === "draft"
            ? await f.repo.exportDraft(r.account, R, d.id)
            : kind === "asset"
              ? await f.repo.readAsset(r.account, R, "image")
              : await f.repo.claimSave(r.account, R, cmd.operationId);
      table.hook("reading").unsubscribe(advance);
      expect(value).toBeNull();
      expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
      expect(await f.db.assets.count()).toBe(0);
      expect((await f.db.drafts.get([A, d.id]))?.source).toBe(d.source);
    },
  );
  it("does not roll back an expiry latch when enqueue returns LOCKED", async () => {
    const f = fixture();
    const r = await ready(f);
    f.now = START + WINDOW;
    await expect(
      f.repo.enqueueSave(r.account, command()),
    ).rejects.toMatchObject({ code: "LOCKED" });
    expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
    expect(await f.db.assets.count()).toBe(0);
  });
  it("retains a valid original receipt as locked metadata after expiry", async () => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    const d = draft();
    await f.repo.enqueueSave(r.account, cmd);
    await f.repo.preserveDraft(d, null);
    const claim = await f.repo.claimSave(r.account, R, cmd.operationId);
    f.now = START + WINDOW;
    const receipt = {
      ok: true,
      replayed: false,
      ritualId: R,
      revisionId: createUuidV7(),
      version: 5,
      updatedAt: new Date(START).toISOString(),
    } as const;
    expect(await f.repo.settleSave(claim!, receipt)).toBe(true);
    expect((await f.db.outbox.get([A, cmd.operationId]))?.result).toEqual(
      receipt,
    );
    expect(await f.repo.exportDraft(r.account, R, d.id)).toBeNull();
    expect(await f.repo.readBundle(r.account, R)).toBeNull();
    expect((await f.db.drafts.get([A, d.id]))?.expectedVersion).toBe(4);
  });
});

it("rechecks time after IDB commit before releasing protected draft bytes", async () => {
  const f = fixture();
  const r = await ready(f);
  const d = draft();
  await f.repo.preserveDraft(d, null);
  const suspend = (value: unknown) => {
    Dexie.currentTransaction?.on("complete", () => {
      f.now = START + WINDOW;
    });
    return value;
  };
  f.db.drafts.hook("reading", suspend);
  expect(await f.repo.exportDraft(r.account, R, d.id)).toBeNull();
  f.db.drafts.hook("reading").unsubscribe(suspend);
  expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
  expect(await f.db.assets.count()).toBe(0);
});
it("also checks the older downloaded bundle's deadline after commit", async () => {
  const f = fixture();
  const r = await ready(f);
  f.now = START + 1000;
  const pending = await f.repo.beginCheck(r.account, R);
  await f.repo.acceptPermission(pending, allowed(pending), createUuidV7());
  const suspend = (value: unknown) => {
    Dexie.currentTransaction?.on("complete", () => {
      f.now = START + WINDOW;
    });
    return value;
  };
  f.db.bundles.hook("reading", suspend);
  expect(await f.repo.readBundle(r.account, R)).toBeNull();
  f.db.bundles.hook("reading").unsubscribe(suspend);
  expect((await f.db.authorizations.get([A, R]))?.lock).toBeNull();
  expect(await f.db.bundles.count()).toBe(0);
  expect(await f.db.assets.count()).toBe(0);
});
it("serves a source-only asset exclusively through a current source-capable gate", async () => {
  const f = fixture();
  const r = await ready(f, true, true);
  expect(await (await f.repo.readAsset(r.account, R, "editor"))?.text()).toBe(
    "source-image",
  );
});

it.each(["json", "legacy", "actor", "target", "operation", "type"])(
  "retains but never sends malformed persisted %s command",
  async (fault) => {
    const f = fixture();
    const r = await ready(f);
    const cmd = command();
    await f.repo.enqueueSave(r.account, cmd);
    const corrupt =
      fault === "json"
        ? "{broken"
        : fault === "type"
          ? "null"
          : JSON.stringify({
              ...cmd,
              ...(fault === "legacy"
                ? { version: 1 }
                : fault === "actor"
                  ? { expectedActorId: B }
                  : fault === "target"
                    ? { ritualId: R2 }
                    : { operationId: createUuidV7() }),
            });
    await f.db.outbox.update([A, cmd.operationId], { payloadJson: corrupt });
    expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
    expect((await f.db.outbox.get([A, cmd.operationId]))?.payloadJson).toBe(
      corrupt,
    );
  },
);
it("preserves a variant instead of incrementing a corrupt or exhausted local recovery version", async () => {
  const f = fixture();
  const d = draft();
  await f.repo.preserveDraft(d, null);
  await f.db.drafts.update([A, d.id], {
    localVersion: Number.MAX_SAFE_INTEGER,
  });
  const variant = await f.repo.preserveDraft(
    { ...d, source: "new unique source" },
    Number.MAX_SAFE_INTEGER,
  );
  expect(variant).toMatchObject({ conflict: true, localVersion: 1 });
  expect(variant.id).not.toBe(d.id);
  expect((await f.db.drafts.get([A, d.id]))?.source).toBe(d.source);
});
it("purges a download which finishes writing only after its permission deadline", async () => {
  const f = fixture();
  const account = await f.repo.activateAccount(A);
  const pending = await f.repo.beginCheck(account, R);
  const data = await downloaded(account);
  await f.repo.acceptPermission(
    pending,
    allowed(pending),
    data.bundle.bundleId,
  );
  const suspend = () => {
    f.now = START + WINDOW;
  };
  f.db.assets.hook("creating", suspend);
  expect(await f.repo.installBundle(pending, data.bundle, data.assets)).toBe(
    false,
  );
  f.db.assets.hook("creating").unsubscribe(suspend);
  expect(await f.db.bundles.count()).toBe(0);
  expect(await f.db.assets.count()).toBe(0);
  expect((await f.db.authorizations.get([A, R]))?.lock).toBe("expired");
});

it("retains and sends SQL CAS versions above the 32-bit range", async () => {
  const f = fixture();
  const r = await ready(f);
  const cmd = { ...command(), expectedVersion: 2_147_483_648 };
  await f.repo.enqueueSave(r.account, cmd);
  expect(
    (await f.repo.claimSave(r.account, R, cmd.operationId))?.payloadJson,
  ).toBe(JSON.stringify(cmd));
});
it("retains but refuses a valid-looking payload changed under an existing operation checksum", async () => {
  const f = fixture();
  const r = await ready(f);
  const cmd = command();
  await f.repo.enqueueSave(r.account, cmd);
  const changed = JSON.stringify({ ...cmd, source: "corrupt changed source" });
  await f.db.outbox.update([A, cmd.operationId], { payloadJson: changed });
  expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
  expect(await f.db.outbox.get([A, cmd.operationId])).toMatchObject({
    status: "queued",
    payloadJson: changed,
  });
});
it("retains but refuses an invalid persisted checksum", async () => {
  const f = fixture();
  const r = await ready(f);
  const cmd = command();
  await f.repo.enqueueSave(r.account, cmd);
  await f.db.outbox.update([A, cmd.operationId], { payloadSha256: "invalid" });
  expect(await f.repo.claimSave(r.account, R, cmd.operationId)).toBeNull();
  expect((await f.db.outbox.get([A, cmd.operationId]))?.status).toBe("queued");
});
it("fences a changed payload and checksum while claim hashing is in flight", async () => {
  const f = fixture();
  const r = await ready(f);
  const cmd = command();
  await f.repo.enqueueSave(r.account, cmd);
  const changed = JSON.stringify({
    ...cmd,
    source: "different exact operation",
  });
  const changedHash = await digest(changed);
  const digestOriginal = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const spy = vi
    .spyOn(crypto.subtle, "digest")
    .mockImplementation(async (...args) => {
      started();
      await waiting;
      return digestOriginal(...args);
    });
  try {
    const claim = f.repo.claimSave(r.account, R, cmd.operationId);
    await entered;
    await f.db.outbox.update([A, cmd.operationId], {
      payloadJson: changed,
      payloadSha256: changedHash,
    });
    release();
    expect(await claim).toBeNull();
    expect(await f.db.outbox.get([A, cmd.operationId])).toMatchObject({
      status: "queued",
      payloadJson: changed,
      payloadSha256: changedHash,
    });
  } finally {
    release();
    spy.mockRestore();
  }
});
