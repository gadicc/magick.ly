import { parseSqlRitualWriteResult } from "../doc/sqlEditorContract";
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
import { inventoryRitualAssetJson } from "./ritualAssetInventory";
import {
  parseRitualPublicationRequest,
  parseRitualPublicationResult,
  type RitualPublicationRequestV1,
  type RitualPublicationResult,
} from "./ritualPublicationContract";
import type {
  OfflineClockObservation,
  OfflineResourceState,
  OfflineRuntimeState,
} from "./runtimeState";
import type {
  DraftInput,
  OfflineDraft,
  OutboxRow,
  PublicationOutboxClaim,
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
const routeAlias = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
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

function validBundleMetadata(bundle: RitualBundle): boolean {
  try {
    if (
      bundle.version !== 1 ||
      !id(bundle.ownerId) ||
      !id(bundle.ritualId) ||
      !id(bundle.bundleId) ||
      !hash(bundle.manifestSha256) ||
      bundle.rendererFormat !== "jrt-v1" ||
      typeof bundle.title !== "string" ||
      typeof bundle.renderedJson !== "string" ||
      !hash(bundle.renderedSha256) ||
      !Array.isArray(bundle.assets) ||
      !Array.isArray(bundle.occurrences) ||
      (bundle.routeAliases !== undefined &&
        (!Array.isArray(bundle.routeAliases) ||
          bundle.routeAliases.length > 8 ||
          bundle.routeAliases.some((alias) => !routeAlias(alias)) ||
          new Set(bundle.routeAliases).size !== bundle.routeAliases.length))
    )
      return false;
    const staticPaths = bundle.assets.flatMap((asset) =>
      asset.reference.startsWith("/") && !asset.reference.startsWith("//")
        ? [asset.reference.split("?", 1)[0]]
        : [],
    );
    const inventory = inventoryRitualAssetJson(bundle.renderedJson, {
      knownAppOrigins: [],
      staticPaths,
    });
    if (
      !inventory.enumerationComplete ||
      inventory.issues.length !== 0 ||
      inventory.occurrences.length !== bundle.occurrences.length
    )
      return false;
    const observed = new Map(
      inventory.occurrences.map((row) => [JSON.stringify(row.path), row]),
    );
    const readAssets = bundle.assets.filter(
      (asset) => asset.purpose === "read",
    );
    const assetsByKey = new Map(readAssets.map((asset) => [asset.key, asset]));
    const usedAssets = new Set<string>();
    for (const occurrence of bundle.occurrences) {
      const path = JSON.stringify(occurrence.path);
      const actual = observed.get(path);
      const asset = assetsByKey.get(occurrence.assetKey);
      if (
        !Array.isArray(occurrence.path) ||
        !occurrence.path.every(
          (index) => Number.isSafeInteger(index) && index >= 0,
        ) ||
        typeof occurrence.src !== "string" ||
        typeof occurrence.displayFragment !== "string" ||
        !actual ||
        !asset ||
        actual.src !== occurrence.src ||
        actual.displayFragment !== occurrence.displayFragment ||
        actual.networkReference !== asset.reference
      )
        return false;
      observed.delete(path);
      usedAssets.add(occurrence.assetKey);
    }
    return observed.size === 0 && usedAssets.size === readAssets.length;
  } catch {
    return false;
  }
}

type SaveRequest = Extract<SqlRitualWriteRequest, { kind: "save" }>;
type CreateRequest = Extract<SqlRitualWriteRequest, { kind: "create" }>;
function isSaveRequest(value: unknown, ownerId: string): value is SaveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(row);
  return (
    (keys.length === 8 || (keys.length === 9 && Object.hasOwn(row, "title"))) &&
    [
      "version",
      "kind",
      "operationId",
      "expectedActorId",
      "ritualId",
      "expectedRevisionId",
      "expectedVersion",
      "source",
      ...(Object.hasOwn(row, "title") ? ["title"] : []),
    ].every((key) => Object.hasOwn(row, key)) &&
    row.version === 2 &&
    row.kind === "save" &&
    row.expectedActorId === ownerId &&
    id(row.operationId) &&
    id(row.ritualId) &&
    id(row.expectedRevisionId) &&
    instant(row.expectedVersion) &&
    typeof row.source === "string" &&
    row.source.length > 0 &&
    row.source.isWellFormed() &&
    !row.source.includes("\0") &&
    new TextEncoder().encode(row.source).byteLength <= 1024 * 1024 &&
    (!Object.hasOwn(row, "title") ||
      (typeof row.title === "string" &&
        row.title.isWellFormed() &&
        !row.title.includes("\0") &&
        row.title.length <= 500))
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
function isCreateRequest(
  value: unknown,
  ownerId: string,
): value is CreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const scope = row.scope as Record<string, unknown> | undefined;
  const scopeValid =
    !!scope &&
    ((Reflect.ownKeys(scope).length === 1 && scope.kind === "public") ||
      (Reflect.ownKeys(scope).length === 2 &&
        scope.kind === "group" &&
        id(scope.groupId)) ||
      (Reflect.ownKeys(scope).length === 3 &&
        scope.kind === "temple" &&
        id(scope.templeId) &&
        instant(scope.minGrade)));
  return (
    Reflect.ownKeys(row).length === 7 &&
    [
      "version",
      "kind",
      "operationId",
      "expectedActorId",
      "scope",
      "title",
      "source",
    ].every((key) => Object.hasOwn(row, key)) &&
    row.version === 2 &&
    row.kind === "create" &&
    row.expectedActorId === ownerId &&
    id(row.operationId) &&
    scopeValid &&
    typeof row.title === "string" &&
    row.title.isWellFormed() &&
    !row.title.includes("\0") &&
    !!row.title.trim() &&
    row.title.length <= 500 &&
    typeof row.source === "string" &&
    row.source.isWellFormed() &&
    !row.source.includes("\0") &&
    new TextEncoder().encode(row.source).byteLength <= 1024 * 1024
  );
}
function storedPublication(row: OutboxRow): RitualPublicationRequestV1 | null {
  try {
    return row.publicationPayloadJson
      ? parseRitualPublicationRequest(JSON.parse(row.publicationPayloadJson))
      : null;
  } catch {
    return null;
  }
}
function validSourceSnapshot(
  value: SourceSnapshot,
  ownerId: string,
  ritualId: string,
): boolean {
  return (
    value.ownerId === ownerId &&
    value.ritualId === ritualId &&
    id(value.revisionId) &&
    instant(value.parentVersion) &&
    typeof value.title === "string" &&
    value.title.isWellFormed() &&
    !value.title.includes("\0") &&
    new TextEncoder().encode(value.title).byteLength <= 2000 &&
    typeof value.source === "string" &&
    value.source.isWellFormed() &&
    !value.source.includes("\0") &&
    new TextEncoder().encode(value.source).byteLength <= 1024 * 1024
  );
}

/** A claim is bound to one active account epoch and one persisted immutable command. */
export interface OutboxClaim {
  operationId: string;
  ritualId: string;
  claimId: string;
  account: OfflineAccount;
  payloadJson: string;
}

/** Strict manifest identity accepted alongside a fresh permission reply. */
export interface AcceptedBundleBinding {
  bundleId: string;
  manifestSha256: string;
  routeAlias?: string;
}
/** Current editor parent accepted with the final source permission response. */
export interface AcceptedSourceBinding {
  revisionId: string;
  parentVersion: number;
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
      const previous = await this.db.checks.get([account.ownerId, ritualId]);
      const pending = {
        ownerId: account.ownerId,
        ritualId,
        accountEpoch: account.epoch,
        requestId: createUuidV7(),
        startedAtMs,
        ...(id(previous?.sourceLeaseId) &&
        id(previous.sourceRevisionId) &&
        instant(previous.sourceParentVersion)
          ? {
              sourceLeaseId: previous.sourceLeaseId,
              sourceRevisionId: previous.sourceRevisionId,
              sourceParentVersion: previous.sourceParentVersion,
            }
          : {}),
      };
      await this.db.checks.put(pending);
      return pending;
    });
  }

  /**
   * Accept only a schema-validated reply from the current uncached server permission check.
   * Apply revocation/edit downgrade immediately, before fetching any replacement assets.
   * An omitted bundle binding renews permission/source only. It cannot renew old
   * bundle bytes or authorize installation; supply the ID and manifest digest only
   * for a complete server manifest.
   */
  acceptPermission(
    pending: PendingPermissionCheck,
    reply: PermissionReply,
    bundle?: AcceptedBundleBinding,
    source?: AcceptedSourceBinding,
  ) {
    pending = structuredClone(pending);
    reply = structuredClone(reply);
    bundle = bundle ? structuredClone(bundle) : undefined;
    source = source ? structuredClone(source) : undefined;
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
      if (
        reply.kind === "granted" &&
        result.authorization.grant &&
        bundle !== undefined
      )
        requireValue(
          id(bundle.bundleId) &&
            hash(bundle.manifestSha256) &&
            (bundle.routeAlias === undefined || routeAlias(bundle.routeAlias)),
          "INVALID",
        );
      if (source !== undefined) {
        const editor = (
          reply as PermissionReply & {
            editor?: { currentRevisionId: unknown; parentVersion: unknown };
          }
        ).editor;
        requireValue(
          reply.kind === "granted" &&
            result.authorization.grant?.sourceEdit === true &&
            id(source.revisionId) &&
            instant(source.parentVersion) &&
            editor?.currentRevisionId === source.revisionId &&
            editor.parentVersion === source.parentVersion,
          "INVALID",
        );
      }
      await this.db.authorizations.put(result.authorization);
      if (result.purgeDownloads) await this.purgeResource(...key);
      else if (result.purgeSourceSnapshots) await this.purgeSource(...key);
      if (reply.kind === "granted" && result.authorization.grant) {
        await this.db.checks.put({
          ...pending,
          acceptedLeaseId: result.authorization.grant.leaseId,
          ...(bundle === undefined
            ? {}
            : {
                bundleId: bundle.bundleId,
                manifestSha256: bundle.manifestSha256,
                ...(bundle.routeAlias ? { routeAlias: bundle.routeAlias } : {}),
              }),
          ...(source === undefined
            ? {}
            : {
                sourceLeaseId: result.authorization.grant.leaseId,
                sourceRevisionId: source.revisionId,
                sourceParentVersion: source.parentVersion,
              }),
        });
        if (result.authorization.grant.sourceEdit) {
          await this.db.outbox
            .where("[ownerId+ritualId]")
            .equals(key)
            .filter((row) => row.status === "authentication-required")
            .modify({ status: "queued" });
        }
        const previous = await this.db.bundles.get(key);
        if (
          bundle !== undefined &&
          previous &&
          previous.bundleId === bundle.bundleId &&
          previous.manifestSha256 === bundle.manifestSha256
        ) {
          const routeAliases = bundle.routeAlias
            ? [
                ...new Set([
                  ...(previous.routeAliases ?? []),
                  bundle.routeAlias,
                ]),
              ]
            : previous.routeAliases;
          requireValue((routeAliases?.length ?? 0) <= 8, "INVALID");
          await this.db.bundles.put({
            ...previous,
            authorization: result.authorization,
            routeAliases,
          });
        }
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
        id(bundle.ownerId) &&
        id(bundle.ritualId) &&
        id(bundle.bundleId) &&
        hash(bundle.manifestSha256) &&
        bundle.ownerId === pending.ownerId &&
        bundle.ritualId === pending.ritualId &&
        bundle.rendererFormat === "jrt-v1" &&
        typeof bundle.title === "string" &&
        typeof bundle.renderedJson === "string" &&
        hash(bundle.renderedSha256) &&
        Array.isArray(bundle.assets) &&
        Array.isArray(bundle.occurrences) &&
        (bundle.routeAliases === undefined ||
          (Array.isArray(bundle.routeAliases) &&
            bundle.routeAliases.length <= 8 &&
            bundle.routeAliases.every(routeAlias) &&
            new Set(bundle.routeAliases).size === bundle.routeAliases.length)),
      "INVALID",
    );
    requireValue(validBundleMetadata(bundle), "INCOMPLETE");
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
        check.bundleId !== bundle.bundleId ||
        check.manifestSha256 !== bundle.manifestSha256
      )
        return false;
      const gate = await this.gate(state.account, pending.ritualId);
      if (!gate.read || !gate.authorization) return false;
      const previous = await this.db.bundles.get([
        pending.ownerId,
        pending.ritualId,
      ]);
      const permittedAliases = new Set(previous?.routeAliases ?? []);
      if (check.routeAlias) permittedAliases.add(check.routeAlias);
      if (
        (check.routeAlias &&
          !bundle.routeAliases?.includes(check.routeAlias)) ||
        bundle.routeAliases?.some((alias) => !permittedAliases.has(alias))
      )
        return false;
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
      validSourceSnapshot(source, pending.ownerId, pending.ritualId),
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
        !id(check.acceptedLeaseId) ||
        check.sourceLeaseId !== check.acceptedLeaseId ||
        check.sourceRevisionId !== source.revisionId ||
        check.sourceParentVersion !== source.parentVersion
      )
        return false;
      const gate = await this.gate(state.account, pending.ritualId);
      if (
        !gate.sourceEdit ||
        check.acceptedLeaseId !== gate.authorization?.grant?.leaseId ||
        check.sourceLeaseId !== gate.authorization.grant.leaseId
      )
        return false;
      await this.db.sources
        .where("[ownerId+ritualId]")
        .equals([pending.ownerId, pending.ritualId])
        .delete();
      await this.db.sources.put(source);
      return (await this.gate(state.account, pending.ritualId)).sourceEdit;
    });
  }

  private async bundle(account: OfflineAccount, ritualId: string) {
    if (!(await this.gate(account, ritualId)).read) return null;
    const bundle = await this.db.bundles.get([account.ownerId, ritualId]);
    if (
      !bundle ||
      bundle.ownerId !== account.ownerId ||
      bundle.ritualId !== ritualId ||
      !validBundleMetadata(bundle)
    ) {
      if (bundle) {
        await this.db.bundles.delete([account.ownerId, ritualId]);
        await this.db.assets
          .where("[ownerId+ritualId]")
          .equals([account.ownerId, ritualId])
          .delete();
      }
      return null;
    }
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

  /** Candidate identities only; callers must register views and perform gated reads before display. */
  async listDownloadedRitualIds(account: OfflineAccount): Promise<string[]> {
    account = structuredClone(account);
    return this.transaction(async () => {
      await this.account(account);
      return [
        ...new Set(
          (
            await this.db.bundles
              .where("ownerId")
              .equals(account.ownerId)
              .toArray()
          )
            .filter(validBundleMetadata)
            .map((bundle) => bundle.ritualId),
        ),
      ].sort();
    });
  }

  /** Resolve an old URL only through a complete bundle saved after a verified alias delivery. */
  async resolveDownloadedRitualAlias(
    account: OfflineAccount,
    alias: string,
  ): Promise<string | null> {
    account = structuredClone(account);
    if (!routeAlias(alias)) return null;
    const candidates = await this.transaction(async () => {
      await this.account(account);
      return (
        await this.db.bundles.where("ownerId").equals(account.ownerId).toArray()
      )
        .filter(
          (bundle) =>
            validBundleMetadata(bundle) &&
            bundle.routeAliases?.includes(alias) === true,
        )
        .map((bundle) => bundle.ritualId);
    });
    if (new Set(candidates).size !== 1) return null;
    const ritualId = candidates[0];
    const bundle = await this.readBundle(account, ritualId);
    return bundle?.routeAliases?.includes(alias) ? ritualId : null;
  }
  readSource(
    account: OfflineAccount,
    ritualId: string,
    revisionId: string,
  ): Promise<SourceSnapshot | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, true, async () => {
      const check = await this.db.checks.get([account.ownerId, ritualId]);
      const authorization = await this.db.authorizations.get([
        account.ownerId,
        ritualId,
      ]);
      const value = await this.db.sources.get([
        account.ownerId,
        ritualId,
        revisionId,
      ]);
      return value &&
        value.revisionId === revisionId &&
        check?.sourceLeaseId === authorization?.grant?.leaseId &&
        check?.sourceRevisionId === value.revisionId &&
        check.sourceParentVersion === value.parentVersion &&
        validSourceSnapshot(value, account.ownerId, ritualId)
        ? { value }
        : null;
    });
  }

  /** The source sync replaces this ritual's snapshot atomically, so ambiguity fails closed. */
  readInstalledSource(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<SourceSnapshot | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, true, async () => {
      const check = await this.db.checks.get([account.ownerId, ritualId]);
      const authorization = await this.db.authorizations.get([
        account.ownerId,
        ritualId,
      ]);
      const values = await this.db.sources
        .where("[ownerId+ritualId]")
        .equals([account.ownerId, ritualId])
        .toArray();
      if (values.length !== 1) return null;
      const value = values[0];
      return validSourceSnapshot(value, account.ownerId, ritualId) &&
        check?.sourceLeaseId === authorization?.grant?.leaseId &&
        check?.sourceRevisionId === value.revisionId &&
        check.sourceParentVersion === value.parentVersion
        ? { value }
        : null;
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

  /** All returned recovery variants remain behind the same current source/edit gate. */
  listDrafts(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<OfflineDraft[] | null> {
    account = structuredClone(account);
    return this.deliver(account, ritualId, true, async () => {
      const values = (
        await this.db.drafts
          .where("[ownerId+ritualId]")
          .equals([account.ownerId, ritualId])
          .toArray()
      ).filter(
        (draft) =>
          draft.ownerId === account.ownerId &&
          draft.ritualId === ritualId &&
          id(draft.id) &&
          id(draft.expectedRevisionId) &&
          instant(draft.expectedVersion) &&
          instant(draft.updatedAtMs) &&
          instant(draft.localVersion) &&
          draft.localVersion > 0 &&
          typeof draft.source === "string" &&
          typeof draft.savedSource === "string" &&
          (draft.conflictOf === null || id(draft.conflictOf)),
      );
      values.sort(
        (left, right) =>
          right.updatedAtMs - left.updatedAtMs ||
          right.localVersion - left.localVersion ||
          left.id.localeCompare(right.id),
      );
      return { value: values };
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

  /** Recover one exact retryable command after a reload; ambiguity stays locked for manual recovery. */
  async readRetriableSave(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<SaveRequest | null> {
    account = structuredClone(account);
    const snapshot = await this.deliver(account, ritualId, true, async () => {
      const rows = (
        await this.db.outbox
          .where("[ownerId+ritualId]")
          .equals([account.ownerId, ritualId])
          .toArray()
      ).filter(
        (row) =>
          row.status === "queued" ||
          row.status === "authentication-required" ||
          (row.status === "sending" &&
            (row.claimEpoch !== account.epoch ||
              (row.claimUntilMs !== null && this.now() >= row.claimUntilMs))),
      );
      if (rows.length !== 1 || !storedSave(rows[0])) return null;
      return {
        value: {
          payloadJson: rows[0].payloadJson,
          payloadSha256: rows[0].payloadSha256,
        },
      };
    });
    if (
      !snapshot ||
      !hash(snapshot.payloadSha256) ||
      (await sha256(snapshot.payloadJson)) !== snapshot.payloadSha256
    )
      return null;
    return this.deliver(account, ritualId, true, async () => {
      const stored = await this.db.outbox
        .where("[ownerId+ritualId]")
        .equals([account.ownerId, ritualId])
        .toArray();
      const eligible = stored.filter(
        (row) =>
          (row.status === "queued" ||
            row.status === "authentication-required" ||
            (row.status === "sending" &&
              (row.claimEpoch !== account.epoch ||
                (row.claimUntilMs !== null &&
                  this.now() >= row.claimUntilMs)))) &&
          row.payloadJson === snapshot.payloadJson &&
          row.payloadSha256 === snapshot.payloadSha256,
      );
      if (eligible.length !== 1) return null;
      try {
        const value: unknown = JSON.parse(snapshot.payloadJson);
        const row = isSaveRequest(value, account.ownerId) ? value : null;
        return row?.ritualId === ritualId ? { value: row } : null;
      } catch {
        return null;
      }
    });
  }

  /** A fresh source-capable account may explicitly resume its own authentication-paused command. */
  async resumeAuthenticatedSave(
    account: OfflineAccount,
    ritualId: string,
    operationId: string,
  ): Promise<boolean> {
    account = structuredClone(account);
    requireValue(id(ritualId) && id(operationId), "INVALID");
    return (
      (await this.deliver(account, ritualId, true, async () => {
        const row = await this.db.outbox.get([account.ownerId, operationId]);
        if (
          !row ||
          row.ritualId !== ritualId ||
          row.status !== "authentication-required" ||
          !storedSave(row)
        )
          return { value: false };
        await this.db.outbox.put({ ...row, status: "queued" });
        return { value: true };
      })) ?? false
    );
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
  async settleSave(
    claim: OutboxClaim,
    resultValue: SqlRitualWriteResult,
  ): Promise<boolean> {
    claim = structuredClone(claim);
    resultValue = structuredClone(resultValue);
    let write: SaveRequest | null = null;
    try {
      const value: unknown = JSON.parse(claim.payloadJson);
      write = isSaveRequest(value, claim.account.ownerId) ? value : null;
    } catch {
      return false;
    }
    if (
      !write ||
      write.operationId !== claim.operationId ||
      write.ritualId !== claim.ritualId
    )
      return false;
    const result = parseSqlRitualWriteResult(write, resultValue);
    requireValue(result, "INVALID");
    const publication = result.ok
      ? ({
          version: 1,
          operationId: write.operationId,
          expectedActorId: write.expectedActorId,
          ritualId: result.ritualId,
          expectedRevisionId: result.revisionId,
          expectedVersion: result.version,
        } satisfies RitualPublicationRequestV1)
      : null;
    const publicationPayloadJson = publication
      ? JSON.stringify(publication)
      : null;
    const publicationPayloadSha256 = publicationPayloadJson
      ? await sha256(publicationPayloadJson)
      : null;
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
        row.ritualId !== claim.ritualId ||
        row.payloadJson !== claim.payloadJson ||
        JSON.stringify(storedSave(row)) !== JSON.stringify(write)
      )
        return false;
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
      if (publication)
        for (const previous of await this.db.outbox
          .where("[ownerId+ritualId]")
          .equals([claim.account.ownerId, claim.ritualId])
          .toArray())
          if (
            previous.operationId !== claim.operationId &&
            previous.publicationStatus !== undefined &&
            previous.publicationStatus !== "acknowledged" &&
            previous.publicationStatus !== "stale"
          )
            await this.db.outbox.put({
              ...previous,
              publicationStatus: "stale",
              publicationClaimId: null,
              publicationClaimEpoch: null,
              publicationClaimUntilMs: null,
            });
      await this.db.outbox.put({
        ...row,
        status,
        result,
        claimId: null,
        claimEpoch: null,
        claimUntilMs: null,
        ...(publication && publicationPayloadJson && publicationPayloadSha256
          ? {
              publicationPayloadJson,
              publicationPayloadSha256,
              publicationStatus: "queued" as const,
              publicationAttempts: 0,
              publicationClaimId: null,
              publicationClaimEpoch: null,
              publicationClaimUntilMs: null,
              publicationResult: null,
            }
          : {}),
      });
      return true;
    });
  }

  /** Attach publication to its acknowledged immutable write without allocating a second identity. */
  async enqueuePublication(
    account: OfflineAccount,
    write: SaveRequest | CreateRequest,
    writeResult: Extract<SqlRitualWriteResult, { ok: true }>,
    requestValue: RitualPublicationRequestV1,
  ): Promise<void> {
    account = structuredClone(account);
    write = structuredClone(write);
    writeResult = structuredClone(writeResult);
    const request = parseRitualPublicationRequest(requestValue);
    requireValue(
      !!request &&
        (isSaveRequest(write, account.ownerId) ||
          isCreateRequest(write, account.ownerId)) &&
        write.operationId === request.operationId &&
        request.expectedActorId === account.ownerId &&
        request.ritualId === writeResult.ritualId &&
        request.expectedRevisionId === writeResult.revisionId &&
        request.expectedVersion === writeResult.version &&
        writeResult.ok &&
        id(writeResult.ritualId) &&
        id(writeResult.revisionId) &&
        instant(writeResult.version) &&
        Number.isFinite(Date.parse(writeResult.updatedAt)),
      "INVALID",
    );
    const writeJson = JSON.stringify(write);
    const writeHash = await sha256(writeJson);
    const payloadJson = JSON.stringify(request);
    const payloadSha256 = await sha256(payloadJson);
    const allowed = await this.transaction(async () => {
      if (!(await this.gate(account, request.ritualId)).sourceEdit)
        return false;
      const old = await this.db.outbox.get([
        account.ownerId,
        request.operationId,
      ]);
      if (old) {
        requireValue(
          old.ritualId === request.ritualId &&
            old.payloadJson === writeJson &&
            old.payloadSha256 === writeHash &&
            old.status === "acknowledged" &&
            JSON.stringify(old.result) === JSON.stringify(writeResult) &&
            (!old.publicationPayloadJson ||
              (old.publicationPayloadJson === payloadJson &&
                old.publicationPayloadSha256 === payloadSha256)),
          "IMMUTABLE",
        );
      }
      for (const previous of await this.db.outbox
        .where("[ownerId+ritualId]")
        .equals([account.ownerId, request.ritualId])
        .toArray())
        if (
          previous.operationId !== request.operationId &&
          previous.publicationStatus !== undefined &&
          previous.publicationStatus !== "acknowledged" &&
          previous.publicationStatus !== "stale"
        )
          await this.db.outbox.put({
            ...previous,
            publicationStatus: "stale",
            publicationClaimId: null,
            publicationClaimEpoch: null,
            publicationClaimUntilMs: null,
          });
      await this.db.outbox.put({
        ...(old ?? {
          ownerId: account.ownerId,
          ritualId: request.ritualId,
          operationId: request.operationId,
          payloadJson: writeJson,
          payloadSha256: writeHash,
          status: "acknowledged" as const,
          attempts: 0,
          claimId: null,
          claimEpoch: null,
          claimUntilMs: null,
          result: writeResult,
        }),
        publicationPayloadJson: payloadJson,
        publicationPayloadSha256: payloadSha256,
        publicationStatus: old?.publicationStatus ?? "queued",
        publicationAttempts: old?.publicationAttempts ?? 0,
        publicationClaimId: old?.publicationClaimId ?? null,
        publicationClaimEpoch: old?.publicationClaimEpoch ?? null,
        publicationClaimUntilMs: old?.publicationClaimUntilMs ?? null,
        publicationResult: old?.publicationResult ?? null,
      });
      return true;
    });
    requireValue(allowed, "LOCKED");
  }

  /** Recover a single exact retryable publication only through the source capability. */
  async readRetriablePublication(
    account: OfflineAccount,
    ritualId: string,
  ): Promise<RitualPublicationRequestV1 | null> {
    account = structuredClone(account);
    const snapshot = await this.deliver(account, ritualId, true, async () => {
      const rows = (
        await this.db.outbox
          .where("[ownerId+ritualId]")
          .equals([account.ownerId, ritualId])
          .toArray()
      ).filter(
        (row) =>
          row.publicationStatus === "queued" ||
          row.publicationStatus === "authentication-required" ||
          (row.publicationStatus === "sending" &&
            (row.publicationClaimEpoch !== account.epoch ||
              (row.publicationClaimUntilMs !== null &&
                row.publicationClaimUntilMs !== undefined &&
                this.now() >= row.publicationClaimUntilMs))),
      );
      const row = rows[0];
      if (
        rows.length !== 1 ||
        !row.publicationPayloadJson ||
        !row.publicationPayloadSha256 ||
        !storedPublication(row)
      )
        return null;
      return {
        value: {
          payloadJson: row.publicationPayloadJson,
          payloadSha256: row.publicationPayloadSha256,
        },
      };
    });
    if (
      !snapshot ||
      !hash(snapshot.payloadSha256) ||
      (await sha256(snapshot.payloadJson)) !== snapshot.payloadSha256
    )
      return null;
    return this.deliver(account, ritualId, true, async () => {
      const rows = await this.db.outbox
        .where("[ownerId+ritualId]")
        .equals([account.ownerId, ritualId])
        .toArray();
      const matching = rows.filter(
        (row) =>
          row.publicationPayloadJson === snapshot.payloadJson &&
          row.publicationPayloadSha256 === snapshot.payloadSha256 &&
          (row.publicationStatus === "queued" ||
            row.publicationStatus === "authentication-required" ||
            (row.publicationStatus === "sending" &&
              (row.publicationClaimEpoch !== account.epoch ||
                (row.publicationClaimUntilMs !== null &&
                  row.publicationClaimUntilMs !== undefined &&
                  this.now() >= row.publicationClaimUntilMs)))),
      );
      const request =
        matching.length === 1 ? storedPublication(matching[0]) : null;
      return request?.ritualId === ritualId ? { value: request } : null;
    });
  }

  async resumeAuthenticatedPublication(
    account: OfflineAccount,
    request: RitualPublicationRequestV1,
  ): Promise<boolean> {
    account = structuredClone(account);
    const parsed = parseRitualPublicationRequest(request);
    requireValue(
      !!parsed && parsed.expectedActorId === account.ownerId,
      "INVALID",
    );
    return (
      (await this.deliver(account, parsed.ritualId, true, async () => {
        const row = await this.db.outbox.get([
          account.ownerId,
          parsed.operationId,
        ]);
        if (
          row?.publicationStatus !== "authentication-required" ||
          JSON.stringify(storedPublication(row)) !== JSON.stringify(parsed)
        )
          return { value: false };
        await this.db.outbox.put({ ...row, publicationStatus: "queued" });
        return { value: true };
      })) ?? false
    );
  }

  async claimPublication(
    account: OfflineAccount,
    request: RitualPublicationRequestV1,
  ): Promise<PublicationOutboxClaim | null> {
    account = structuredClone(account);
    const parsed = parseRitualPublicationRequest(request);
    if (
      !parsed ||
      parsed.expectedActorId !== account.ownerId ||
      JSON.stringify(
        await this.readRetriablePublication(account, parsed.ritualId),
      ) !== JSON.stringify(parsed)
    )
      return null;
    return this.deliver(account, parsed.ritualId, true, async () => {
      const row = await this.db.outbox.get([
        account.ownerId,
        parsed.operationId,
      ]);
      const current = row && storedPublication(row);
      const now = this.now();
      if (
        !row ||
        JSON.stringify(current) !== JSON.stringify(parsed) ||
        (row.publicationStatus !== "queued" &&
          !(
            row.publicationStatus === "sending" &&
            (row.publicationClaimEpoch !== account.epoch ||
              (row.publicationClaimUntilMs !== null &&
                row.publicationClaimUntilMs !== undefined &&
                now >= row.publicationClaimUntilMs))
          ))
      )
        return null;
      const claimId = createUuidV7();
      await this.db.outbox.put({
        ...row,
        publicationStatus: "sending",
        publicationAttempts: (row.publicationAttempts ?? 0) + 1,
        publicationClaimId: claimId,
        publicationClaimEpoch: account.epoch,
        publicationClaimUntilMs: now + CLAIM_MS,
      });
      return { value: { request: parsed, claimId, account } };
    });
  }

  async settlePublication(
    claim: PublicationOutboxClaim,
    resultValue: RitualPublicationResult,
  ): Promise<boolean> {
    claim = structuredClone(claim);
    const result = parseRitualPublicationResult(claim.request, resultValue);
    if (!result) return false;
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
        claim.request.operationId,
      ]);
      if (
        !row ||
        row.ritualId !== claim.request.ritualId ||
        row.publicationStatus !== "sending" ||
        row.publicationClaimId !== claim.claimId ||
        row.publicationClaimEpoch !== claim.account.epoch ||
        JSON.stringify(storedPublication(row)) !== JSON.stringify(claim.request)
      )
        return false;
      await this.gate(claim.account, claim.request.ritualId);
      const publicationStatus: NonNullable<OutboxRow["publicationStatus"]> =
        result.ok
          ? "acknowledged"
          : result.code === "AUTH_REQUIRED" || result.code === "ACTOR_CHANGED"
            ? "authentication-required"
            : result.code === "STALE"
              ? "stale"
              : result.retryable
                ? "queued"
                : "rejected";
      await this.db.outbox.put({
        ...row,
        publicationStatus,
        publicationResult: result,
        publicationClaimId: null,
        publicationClaimEpoch: null,
        publicationClaimUntilMs: null,
      });
      return true;
    });
  }

  /** Sweep owned leases and return only requested capability/deadline metadata for view lifetime. */
  runtimeState(
    ritualIds: string[],
    observation?: OfflineClockObservation,
  ): Promise<OfflineRuntimeState> {
    observation = observation ? structuredClone(observation) : undefined;
    requireValue(
      !observation ||
        (id(observation.account.ownerId) &&
          id(observation.account.epoch) &&
          instant(observation.observedAtMs) &&
          observation.leases.every(
            (row) =>
              id(row.ritualId) &&
              (row.leaseId === null || id(row.leaseId)) &&
              (row.bundleLeaseId === null || id(row.bundleLeaseId)),
          )),
      "INVALID",
    );
    const requested = [...new Set(ritualIds)];
    requireValue(requested.every(id), "INVALID");
    return this.transaction(async () => {
      const state = await this.db.device.get("active");
      if (!state?.account || state.cleanupOwnerId)
        return {
          account: null,
          cleanupPending: !!state?.cleanupOwnerId,
          observedAtMs: this.now(),
          resources: [],
        };
      const account = await this.account(state.account);
      if (
        observation?.account.ownerId === account.ownerId &&
        observation.account.epoch === account.epoch
      ) {
        for (const observed of observation.leases) {
          const key: [string, string] = [account.ownerId, observed.ritualId];
          const authorization = await this.db.authorizations.get(key);
          if (
            authorization?.accountEpoch === account.epoch &&
            authorization.grant?.leaseId === observed.leaseId &&
            authorization.lastObservedAtMs !== null
          ) {
            await this.db.authorizations.put({
              ...authorization,
              lastObservedAtMs: Math.max(
                authorization.lastObservedAtMs,
                observation.observedAtMs,
              ),
            });
          }
          const bundle = await this.db.bundles.get(key);
          if (
            bundle?.authorization.accountEpoch === account.epoch &&
            bundle.authorization.grant?.leaseId === observed.bundleLeaseId &&
            bundle.authorization.lastObservedAtMs !== null
          ) {
            await this.db.bundles.put({
              ...bundle,
              authorization: {
                ...bundle.authorization,
                lastObservedAtMs: Math.max(
                  bundle.authorization.lastObservedAtMs,
                  observation.observedAtMs,
                ),
              },
            });
          }
        }
      }
      for (const row of await this.db.authorizations
        .where("ownerId")
        .equals(account.ownerId)
        .toArray())
        await this.gate(account, row.ritualId);
      // A check-only grant can outlive the downloaded bundle's original lease.
      // Sweep every owned bundle even when no ritual is currently being viewed.
      for (const [, ritualId] of await this.db.bundles
        .where("ownerId")
        .equals(account.ownerId)
        .primaryKeys())
        await this.bundle(account, ritualId);
      const resources: OfflineResourceState[] = [];
      for (const ritualId of requested) {
        const bundle = await this.bundle(account, ritualId);
        let complete = !!bundle;
        if (bundle) {
          for (const entry of bundle.assets.filter(
            (entry) => entry.purpose === "read",
          )) {
            const asset = await this.db.assets.get([
              account.ownerId,
              ritualId,
              bundle.bundleId,
              entry.key,
            ]);
            if (
              !asset ||
              asset.ownerId !== account.ownerId ||
              asset.ritualId !== ritualId ||
              asset.bundleId !== bundle.bundleId ||
              asset.key !== entry.key ||
              asset.sha256 !== entry.sha256 ||
              asset.mime !== entry.mime ||
              asset.reference !== entry.reference ||
              asset.purpose !== "read" ||
              asset.bytes !== entry.bytes ||
              !(asset.blob instanceof Blob) ||
              asset.blob.size !== entry.bytes ||
              asset.blob.type !== entry.mime
            )
              complete = false;
          }
        }
        const gate = await this.gate(account, ritualId);
        const deadline = gate.authorization?.localDeadlineMs ?? null;
        const bundleDeadline = bundle?.authorization.localDeadlineMs ?? null;
        resources.push({
          ritualId,
          read:
            gate.read &&
            complete &&
            deadline !== null &&
            bundleDeadline !== null,
          sourceEdit: gate.sourceEdit,
          readDeadlineMs:
            gate.read &&
            complete &&
            deadline !== null &&
            bundleDeadline !== null
              ? Math.min(deadline, bundleDeadline)
              : null,
          sourceDeadlineMs: gate.sourceEdit ? deadline : null,
          leaseId: gate.authorization?.grant?.leaseId ?? null,
          bundleLeaseId: bundle?.authorization.grant?.leaseId ?? null,
        });
      }
      return {
        account,
        cleanupPending: false,
        observedAtMs: this.now(),
        resources,
      };
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
