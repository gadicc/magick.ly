import type {
  SqlRitualWriteRequest,
  SqlRitualWriteResult,
} from "../doc/sqlWriteContract";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  applyPermissionReply,
  inspectOfflineAuthorization,
  type OfflineAccount,
  type OfflineAuthorization,
  type PendingPermissionCheck,
  type PermissionReply,
} from "./lease";
import type {
  DraftInput,
  OfflineDraft,
  OutboxRow,
  RitualBundle,
  RitualOfflineDatabase,
  SourceSnapshot,
  StoredAsset,
} from "./storage";

const id = (value: unknown): value is string =>
  isUuidV7(value) && value === value.toLowerCase();
const instant = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const CLAIM_MS = 60_000;

/** Safe local errors carry no source, provider details or other-account data. */
export class OfflineRepositoryError extends Error {
  constructor(
    readonly code:
      | "INVALID"
      | "ACCOUNT"
      | "CLEANUP_PENDING"
      | "LOCKED"
      | "IMMUTABLE"
      | "INCOMPLETE",
  ) {
    super(code);
    this.name = "OfflineRepositoryError";
  }
}
function requireValue(
  condition: unknown,
  code: OfflineRepositoryError["code"],
): asserts condition {
  if (!condition) throw new OfflineRepositoryError(code);
}
async function sha256(value: string | Blob): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : await value.arrayBuffer();
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

type SaveRequest = Extract<SqlRitualWriteRequest, { kind: "save" }>;
function isSaveRequest(value: unknown, ownerId: string): value is SaveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === 2 &&
    row.kind === "save" &&
    row.expectedActorId === ownerId &&
    id(row.operationId) &&
    id(row.ritualId) &&
    id(row.expectedRevisionId) &&
    instant(row.expectedVersion) &&
    typeof row.source === "string" &&
    (row.title === undefined || typeof row.title === "string")
  );
}
function storedSave(row: OutboxRow): SaveRequest | null {
  try {
    const value: unknown = JSON.parse(row.payloadJson);
    return isSaveRequest(value, row.ownerId) &&
      value.operationId === row.operationId &&
      value.ritualId === row.ritualId
      ? value
      : null;
  } catch {
    return null;
  }
}

/** A claim is bound to one active account epoch and one persisted immutable command. */
export interface OutboxClaim {
  operationId: string;
  ritualId: string;
  claimId: string;
  account: OfflineAccount;
  payloadJson: string;
}

/**
 * App-specific ritual repository. No network, UI, timers, legacy migration or whole-DB deletion.
 * Every data operation rechecks persisted epoch/lease within its IndexedDB transaction.
 */
export class OfflineRitualRepository {
  constructor(
    private readonly db: RitualOfflineDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction("rw", this.db.tables, work);
  }
  private async account(expected: OfflineAccount): Promise<OfflineAccount> {
    requireValue(id(expected.ownerId) && id(expected.epoch), "ACCOUNT");
    const state = await this.db.device.get("active");
    requireValue(!state?.cleanupOwnerId, "CLEANUP_PENDING");
    requireValue(
      state?.account?.ownerId === expected.ownerId &&
        state.account.epoch === expected.epoch,
      "ACCOUNT",
    );
    return state.account;
  }
  private async purgeResource(
    ownerId: string,
    ritualId: string,
  ): Promise<void> {
    await this.db.bundles.delete([ownerId, ritualId]);
    await this.db.assets
      .where("[ownerId+ritualId]")
      .equals([ownerId, ritualId])
      .delete();
    await this.db.sources
      .where("[ownerId+ritualId]")
      .equals([ownerId, ritualId])
      .delete();
  }
  private async purgeSource(ownerId: string, ritualId: string): Promise<void> {
    await this.db.sources
      .where("[ownerId+ritualId]")
      .equals([ownerId, ritualId])
      .delete();
    await this.db.assets
      .where("[ownerId+ritualId]")
      .equals([ownerId, ritualId])
      .filter((row) => row.purpose === "source")
      .delete();
  }
  private async gate(account: OfflineAccount, ritualId: string) {
    await this.account(account);
    requireValue(id(ritualId), "INVALID");
    const result = inspectOfflineAuthorization(
      (await this.db.authorizations.get([account.ownerId, ritualId])) ?? null,
      account,
      this.now(),
    );
    if (result.authorization)
      await this.db.authorizations.put(result.authorization);
    if (result.purgeDownloads)
      await this.purgeResource(account.ownerId, ritualId);
    if (!result.sourceEdit) await this.purgeSource(account.ownerId, ritualId);
    return result;
  }

  /** Account/lease checks bracket IDB reads; a final synchronous check also covers commit suspension. */
  private async deliver<T>(
    account: OfflineAccount,
    ritualId: string,
    sourceEdit: boolean,
    work: () => Promise<{
      value: T;
      bundleAuthorization?: OfflineAuthorization;
      requiresSource?: boolean;
    } | null>,
  ): Promise<T | null> {
    const result = await this.transaction(async () => {
      const before = await this.gate(account, ritualId);
      if (!before.read || (sourceEdit && !before.sourceEdit)) return null;
      const result = await work();
      if (!result) return null;
      const after = await this.gate(account, ritualId);
      const needsSource = sourceEdit || !!result.requiresSource;
      if (
        !after.read ||
        (needsSource && !after.sourceEdit) ||
        !after.authorization
      )
        return null;
      return { ...result, needsSource, authorization: after.authorization };
    });
    if (!result) return null;
    const now = this.now();
    const final = inspectOfflineAuthorization(
      result.authorization,
      account,
      now,
    );
    const bundle = result.bundleAuthorization
      ? inspectOfflineAuthorization(result.bundleAuthorization, account, now)
      : null;
    if (
      final.read &&
      (!result.needsSource || final.sourceEdit) &&
      (!bundle || bundle.read)
    )
      return result.value;
    // Return denial rather than throwing inside the transaction, so expiry/purge commits.
    await this.transaction(async () => {
      await this.gate(account, ritualId);
      if (bundle && !bundle.read) await this.bundle(account, ritualId);
    });
    return null;
  }

  /** Call only for a verified account. Repeated same-account session checks do not renew leases. */
  async activateAccount(ownerId: string): Promise<OfflineAccount> {
    requireValue(id(ownerId), "INVALID");
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      requireValue(!state?.cleanupOwnerId, "CLEANUP_PENDING");
      if (state?.account) {
        requireValue(
          state.account.ownerId === ownerId && id(state.account.epoch),
          "ACCOUNT",
        );
        return state.account;
      }
      const account = { ownerId, epoch: createUuidV7() };
      await this.db.device.put({
        key: "active",
        account,
        cleanupOwnerId: null,
      });
      return account;
    });
  }

  /** Durable fence commits first. A failed purge leaves every access blocked until cleanup succeeds. */
  async signOut(account: OfflineAccount): Promise<void> {
    account = structuredClone(account);
    await this.transaction(async () => {
      await this.account(account);
      await this.db.device.put({
        key: "active",
        account: null,
        cleanupOwnerId: account.ownerId,
      });
    });
    await this.resumeCleanup();
  }

  /** Explicitly deletes renewable stores only; no whole-database reset or recovery deletion exists. */
  resumeCleanup(): Promise<void> {
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      if (!state?.cleanupOwnerId) return;
      const ownerId = state.cleanupOwnerId;
      for (const table of [
        this.db.checks,
        this.db.authorizations,
        this.db.bundles,
        this.db.assets,
        this.db.sources,
      ]) {
        await table.where("ownerId").equals(ownerId).delete();
      }
      await this.db.device.put({
        ...state,
        account: null,
        cleanupOwnerId: null,
      });
    });
  }

  /** Start before sending the permission request; this transaction supersedes older checks across tabs. */
  beginCheck(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<PendingPermissionCheck> {
    account = structuredClone(account);
    return this.transaction(async () => {
      await this.account(account);
      requireValue(id(ritualId), "INVALID");
      const startedAtMs = this.now();
      requireValue(instant(startedAtMs), "INVALID");
      const pending = {
        ownerId: account.ownerId,
        ritualId,
        accountEpoch: account.epoch,
        requestId: createUuidV7(),
        startedAtMs,
      };
      await this.db.checks.put(pending);
      return pending;
    });
  }

  /**
   * Accept only a schema-validated reply from the current uncached server permission check.
   * Apply revocation/edit downgrade immediately, before fetching any replacement assets.
   */
  acceptPermission(
    pending: PendingPermissionCheck,
    reply: PermissionReply,
    bundleId?: string,
  ) {
    pending = structuredClone(pending);
    reply = structuredClone(reply);
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      const current = state?.cleanupOwnerId ? null : (state?.account ?? null);
      const key: [string, string] = [pending.ownerId, pending.ritualId];
      const check = await this.db.checks.get(key);
      const result = applyPermissionReply(
        (await this.db.authorizations.get(key)) ?? null,
        pending,
        reply,
        current,
        check?.requestId ?? null,
        this.now(),
      );
      if (result.outcome !== "accepted") return result.outcome;
      if (reply.kind === "granted" && result.authorization.grant)
        requireValue(id(bundleId), "INVALID");
      await this.db.authorizations.put(result.authorization);
      if (result.purgeDownloads) await this.purgeResource(...key);
      else if (result.purgeSourceSnapshots) await this.purgeSource(...key);
      if (reply.kind === "granted" && result.authorization.grant) {
        await this.db.checks.put({ ...pending, bundleId });
        if (result.authorization.grant.sourceEdit) {
          await this.db.outbox
            .where("[ownerId+ritualId]")
            .equals(key)
            .filter((row) => row.status === "authentication-required")
            .modify({ status: "queued" });
        }
        const previous = await this.db.bundles.get(key);
        if (previous && previous.bundleId === bundleId)
          await this.db.bundles.put({
            ...previous,
            authorization: result.authorization,
          });
      } else await this.db.checks.delete(key);
      return result.outcome;
    });
  }

  /** Validate and hash downloaded bytes outside the transaction, then publish all rows atomically. */
  async installBundle(
    pending: PendingPermissionCheck,
    inputBundle: RitualBundle,
    inputAssets: StoredAsset[],
  ): Promise<boolean> {
    pending = structuredClone(pending);
    const bundle = structuredClone(inputBundle);
    const assets = structuredClone(inputAssets);
    requireValue(
      bundle.version === 1 &&
        bundle.ownerId === pending.ownerId &&
        bundle.ritualId === pending.ritualId &&
        id(bundle.bundleId) &&
        bundle.rendererFormat === "jrt-v1" &&
        typeof bundle.title === "string" &&
        typeof bundle.renderedJson === "string" &&
        hash(bundle.renderedSha256) &&
        Array.isArray(bundle.assets),
      "INVALID",
    );
    requireValue(
      (await sha256(bundle.renderedJson)) === bundle.renderedSha256,
      "INCOMPLETE",
    );
    requireValue(
      assets.length === bundle.assets.length &&
        new Set(bundle.assets.map((entry) => entry.key)).size === assets.length,
      "INCOMPLETE",
    );
    for (const entry of bundle.assets) {
      const asset = assets.find((asset) => asset.key === entry.key);
      requireValue(
        entry.key.length > 0 &&
          typeof entry.reference === "string" &&
          hash(entry.sha256) &&
          instant(entry.bytes) &&
          typeof entry.mime === "string" &&
          (entry.purpose === "read" || entry.purpose === "source") &&
          asset?.ownerId === bundle.ownerId &&
          asset.ritualId === bundle.ritualId &&
          asset.bundleId === bundle.bundleId &&
          asset.reference === entry.reference &&
          asset.purpose === entry.purpose &&
          asset.sha256 === entry.sha256 &&
          asset.mime === entry.mime &&
          asset.bytes === entry.bytes &&
          asset.blob instanceof Blob &&
          asset.blob.type === entry.mime &&
          asset.blob.size === entry.bytes,
        "INCOMPLETE",
      );
      requireValue((await sha256(asset.blob)) === entry.sha256, "INCOMPLETE");
    }
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      const check = await this.db.checks.get([
        pending.ownerId,
        pending.ritualId,
      ]);
      if (
        state?.cleanupOwnerId ||
        state?.account?.ownerId !== pending.ownerId ||
        state.account.epoch !== pending.accountEpoch ||
        check?.requestId !== pending.requestId ||
        check.bundleId !== bundle.bundleId
      )
        return false;
      const gate = await this.gate(state.account, pending.ritualId);
      if (!gate.read || !gate.authorization) return false;
      requireValue(
        gate.sourceEdit ||
          bundle.assets.every((asset) => asset.purpose === "read"),
        "LOCKED",
      );
      await this.db.assets
        .where("[ownerId+ritualId]")
        .equals([pending.ownerId, pending.ritualId])
        .delete();
      await this.db.assets.bulkPut(assets);
      await this.db.bundles.put({
        ...bundle,
        authorization: gate.authorization,
      });
      return (await this.gate(state.account, pending.ritualId)).read;
    });
  }

  /** Only a current accepted source/edit check can attach server source to local storage. */
  async installSource(
    pending: PendingPermissionCheck,
    source: SourceSnapshot,
  ): Promise<boolean> {
    pending = structuredClone(pending);
    source = structuredClone(source);
    requireValue(
      source.ownerId === pending.ownerId &&
        source.ritualId === pending.ritualId &&
        id(source.revisionId) &&
        instant(source.parentVersion) &&
        typeof source.source === "string",
      "INVALID",
    );
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      const check = await this.db.checks.get([
        pending.ownerId,
        pending.ritualId,
      ]);
      if (
        state?.cleanupOwnerId ||
        state?.account?.ownerId !== pending.ownerId ||
        state.account.epoch !== pending.accountEpoch ||
        check?.requestId !== pending.requestId ||
        !check.bundleId
      )
        return false;
      if (!(await this.gate(state.account, pending.ritualId)).sourceEdit)
        return false;
      await this.db.sources.put(source);
      return (await this.gate(state.account, pending.ritualId)).sourceEdit;
    });
  }

  private async bundle(account: OfflineAccount, ritualId: string) {
    if (!(await this.gate(account, ritualId)).read) return null;
    const bundle = await this.db.bundles.get([account.ownerId, ritualId]);
    if (
      !bundle ||
      bundle.version !== 1 ||
      bundle.ownerId !== account.ownerId ||
      bundle.ritualId !== ritualId
    )
      return null;
    const decision = inspectOfflineAuthorization(
      bundle.authorization,
      account,
      this.now(),
    );
    if (!decision.read || !decision.authorization) {
      await this.db.bundles.delete([account.ownerId, ritualId]);
      await this.db.assets
        .where("[ownerId+ritualId]")
        .equals([account.ownerId, ritualId])
        .delete();
      return null;
    }
    await this.db.bundles.put({
      ...bundle,
      authorization: decision.authorization,
    });
    return bundle;
  }
  /** Returned data is a snapshot: callers must clear rendered memory on lifecycle changes. */
  readBundle(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<RitualBundle | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, false, async () => {
      const bundle = await this.bundle(account, ritualId);
      if (!bundle) return null;
      const { authorization, ...data } = bundle;
      return {
        value: {
          ...data,
          assets: data.assets.filter((asset) => asset.purpose === "read"),
        },
        bundleAuthorization: authorization,
      };
    });
  }
  readAsset(
    account: OfflineAccount,
    ritualId: string,
    assetKey: string,
  ): Promise<Blob | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, false, async () => {
      const bundle = await this.bundle(account, ritualId);
      if (!bundle) return null;
      const asset = await this.db.assets.get([
        account.ownerId,
        ritualId,
        bundle.bundleId,
        assetKey,
      ]);
      return asset
        ? {
            value: asset.blob,
            bundleAuthorization: bundle.authorization,
            requiresSource: asset.purpose === "source",
          }
        : null;
    });
  }
  readSource(
    account: OfflineAccount,
    ritualId: string,
    revisionId: string,
  ): Promise<SourceSnapshot | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, true, async () => {
      const value = await this.db.sources.get([
        account.ownerId,
        ritualId,
        revisionId,
      ]);
      return value ? { value } : null;
    });
  }

  /**
   * Preserve already-held text after a lock. Stale writers create a separate variant;
   * they never overwrite newer text or retarget an existing recovery record.
   */
  async preserveDraft(
    input: DraftInput,
    expectedLocalVersion: number | null,
  ): Promise<{ id: string; localVersion: number; conflict: boolean }> {
    const draft = structuredClone(input);
    requireValue(
      id(draft.ownerId) &&
        id(draft.ritualId) &&
        id(draft.id) &&
        id(draft.expectedRevisionId) &&
        instant(draft.expectedVersion) &&
        instant(draft.updatedAtMs) &&
        typeof draft.source === "string" &&
        typeof draft.savedSource === "string" &&
        (expectedLocalVersion === null || instant(expectedLocalVersion)),
      "INVALID",
    );
    return this.transaction(async () => {
      const previous = await this.db.drafts.get([draft.ownerId, draft.id]);
      const conflict = previous
        ? previous.ritualId !== draft.ritualId ||
          !instant(previous.localVersion) ||
          previous.localVersion >= Number.MAX_SAFE_INTEGER ||
          previous.localVersion !== expectedLocalVersion
        : expectedLocalVersion !== null;
      const id = conflict ? createUuidV7() : draft.id;
      const localVersion =
        conflict || !previous ? 1 : previous.localVersion + 1;
      await this.db.drafts.put({
        ...draft,
        id,
        localVersion,
        conflictOf: conflict ? draft.id : (previous?.conflictOf ?? null),
      });
      return { id, localVersion, conflict };
    });
  }
  /** The same gate serves editor recovery and export; neither has a privileged bypass. */
  readDraft(
    account: OfflineAccount,
    ritualId: string,
    draftId: string,
  ): Promise<OfflineDraft | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, true, async () => {
      const draft = await this.db.drafts.get([account.ownerId, draftId]);
      return draft?.ritualId === ritualId ? { value: draft } : null;
    });
  }

  exportDraft(
    account: OfflineAccount,
    ritualId: string,
    draftId: string,
  ): Promise<OfflineDraft | null> {
    account = structuredClone(account);
    return this.readDraft(account, ritualId, draftId);
  }

  /** Offline creation/publication are deferred. Preserve the exact serialized SQL-v2 save command. */
  async enqueueSave(
    account: OfflineAccount,
    request: Extract<SqlRitualWriteRequest, { kind: "save" }>,
  ): Promise<void> {
    account = structuredClone(account);
    request = structuredClone(request);
    requireValue(isSaveRequest(request, account.ownerId), "INVALID");
    const payloadJson = JSON.stringify(request);
    const payloadSha256 = await sha256(payloadJson);
    const allowed = await this.transaction(async () => {
      if (!(await this.gate(account, request.ritualId)).sourceEdit)
        return false;
      const old = await this.db.outbox.get([
        account.ownerId,
        request.operationId,
      ]);
      requireValue(!old || old.payloadJson === payloadJson, "IMMUTABLE");
      if (!old)
        await this.db.outbox.add({
          ownerId: account.ownerId,
          ritualId: request.ritualId,
          operationId: request.operationId,
          payloadJson,
          payloadSha256,
          status: "queued",
          attempts: 0,
          claimId: null,
          claimEpoch: null,
          claimUntilMs: null,
          result: null,
        });
      return true;
    });
    requireValue(allowed, "LOCKED");
  }

  /** Transactions serialize concurrent tabs; a killed sender's claim expires without changing its operation ID. */
  async claimSave(
    account: OfflineAccount,
    ritualId: string,
    operationId: string,
  ): Promise<OutboxClaim | null> {
    account = structuredClone(account);
    const snapshot = await this.deliver(account, ritualId, true, async () => {
      const row = await this.db.outbox.get([account.ownerId, operationId]);
      return row && row.ritualId === ritualId && storedSave(row)
        ? {
            value: {
              payloadJson: row.payloadJson,
              payloadSha256: row.payloadSha256,
            },
          }
        : null;
    });
    // WebCrypto stays outside IDB. The final transaction compares the exact bytes
    // and checksum again, so a concurrent edit cannot borrow this verification.
    if (
      !snapshot ||
      !hash(snapshot.payloadSha256) ||
      (await sha256(snapshot.payloadJson)) !== snapshot.payloadSha256
    )
      return null;
    return this.deliver(account, ritualId, true, async () => {
      const row = await this.db.outbox.get([account.ownerId, operationId]);
      if (
        !row ||
        row.ritualId !== ritualId ||
        !storedSave(row) ||
        row.payloadJson !== snapshot.payloadJson ||
        row.payloadSha256 !== snapshot.payloadSha256
      )
        return null;
      const now = this.now();
      if (
        row.status !== "queued" &&
        !(
          row.status === "sending" &&
          (row.claimEpoch !== account.epoch ||
            (row.claimUntilMs !== null && now >= row.claimUntilMs))
        )
      )
        return null;
      const claimId = createUuidV7();
      await this.db.outbox.put({
        ...row,
        status: "sending",
        attempts: row.attempts + 1,
        claimId,
        claimEpoch: account.epoch,
        claimUntilMs: now + CLAIM_MS,
      });
      return {
        value: {
          account,
          claimId,
          operationId,
          ritualId,
          payloadJson: row.payloadJson,
        },
      };
    });
  }

  /**
   * Retain a matching receipt even after lease expiry, as locked recovery metadata only.
   * It never changes cached content, the editor CAS base or any access grant.
   */
  settleSave(
    claim: OutboxClaim,
    result: SqlRitualWriteResult,
  ): Promise<boolean> {
    claim = structuredClone(claim);
    result = structuredClone(result);
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      if (
        state?.cleanupOwnerId ||
        state?.account?.ownerId !== claim.account.ownerId ||
        state.account.epoch !== claim.account.epoch
      )
        return false;
      const row = await this.db.outbox.get([
        claim.account.ownerId,
        claim.operationId,
      ]);
      if (
        !row ||
        row.claimId !== claim.claimId ||
        row.claimEpoch !== claim.account.epoch ||
        row.status !== "sending" ||
        row.ritualId !== claim.ritualId
      )
        return false;
      if (result.ok)
        requireValue(
          result.ritualId === row.ritualId &&
            id(result.revisionId) &&
            instant(result.version) &&
            typeof result.updatedAt === "string" &&
            Number.isFinite(Date.parse(result.updatedAt)),
          "INVALID",
        );
      await this.gate(claim.account, claim.ritualId);
      const status: OutboxRow["status"] = result.ok
        ? "acknowledged"
        : result.code === "NOT_AUTHENTICATED" ||
            result.code === "ACCOUNT_CHANGED"
          ? "authentication-required"
          : result.code === "CONFLICT"
            ? "conflict"
            : result.code === "RETRYABLE" || result.code === "UNAVAILABLE"
              ? "queued"
              : "rejected";
      await this.db.outbox.put({
        ...row,
        status,
        result,
        claimId: null,
        claimEpoch: null,
        claimUntilMs: null,
      });
      return true;
    });
  }

  /** Resume/cold-start sweep uses the same persisted gate as a direct protected read. */
  sweep(account: OfflineAccount): Promise<void> {
    account = structuredClone(account);
    return this.transaction(async () => {
      await this.account(account);
      for (const row of await this.db.authorizations
        .where("ownerId")
        .equals(account.ownerId)
        .toArray())
        await this.gate(account, row.ritualId);
    });
  }
}
