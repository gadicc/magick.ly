import Dexie, { type DexieOptions, type Table } from "dexie";
import type { SqlRitualWriteResult } from "../doc/sqlWriteContract";
import type {
  OfflineAccount,
  OfflineAuthorization,
  PendingPermissionCheck,
} from "./lease";
import type {
  RitualPublicationRequestV1,
  RitualPublicationResult,
} from "./ritualPublicationContract";

/** Persist the fence before attempting purge; authentication never clears cleanupPending. */
export interface DeviceState {
  key: "active";
  account: OfflineAccount | null;
  cleanupOwnerId: string | null;
}
export interface StoredCheck extends PendingPermissionCheck {
  /** Set only after an accepted grant; independent of complete rendered output. */
  acceptedLeaseId?: string;
  /** Set only after accepting the current validated permission reply. */
  bundleId?: string;
  /** Exact strict manifest identity paired with bundleId. */
  manifestSha256?: string;
  /** Exact normalized legacy route resolved by the server for this check. */
  routeAlias?: string;
  /** Exact current editor parent accepted in the same source delivery envelope. */
  sourceLeaseId?: string;
  sourceRevisionId?: string;
  sourceParentVersion?: number;
}
/** Manifest entries come from the authorized server projection, never a URL-derived ACL. */
export interface AssetManifestEntry {
  key: string;
  reference: string;
  sha256: string;
  mime: string;
  bytes: number;
  purpose: "read" | "source";
}
/** Exact rendered-source occurrence bound to one bundle asset. */
export interface RitualBundleOccurrence {
  path: number[];
  src: string;
  displayFragment: string;
  assetKey: string;
}
/** Downloaded data only. Source/history live in a separate capability-gated store. */
export interface RitualBundle {
  version: 1;
  ownerId: string;
  ritualId: string;
  bundleId: string;
  /** Identity of the strict server manifest accepted with the permission reply. */
  manifestSha256: string;
  title: string;
  renderedJson: string;
  renderedSha256: string;
  rendererFormat: "jrt-v1";
  assets: AssetManifestEntry[];
  occurrences: RitualBundleOccurrence[];
  /** Verified Mongo docs/ObjectId routes retained for this canonical ritual. */
  routeAliases?: string[];
}
export interface StoredBundle extends RitualBundle {
  /** An unrelated/new bundle check must not extend these previously downloaded bytes. */
  authorization: OfflineAuthorization;
}
export interface StoredAsset extends AssetManifestEntry {
  ownerId: string;
  ritualId: string;
  bundleId: string;
  blob: Blob;
}
/** Exact editor source and CAS state; no automatic history download. */
export interface SourceSnapshot {
  ownerId: string;
  ritualId: string;
  revisionId: string;
  parentVersion: number;
  /** Protected editor metadata; clear it from view memory with the source. */
  title: string;
  source: string;
}
/** Writes may preserve already-held text after a lock; reads/exports always require a fresh gate. */
export interface OfflineDraft {
  ownerId: string;
  ritualId: string;
  id: string;
  source: string;
  savedSource: string;
  expectedRevisionId: string;
  expectedVersion: number;
  updatedAtMs: number;
  /** Local recovery CAS, separate from the server ritual version. */
  localVersion: number;
  conflictOf: string | null;
}
export type DraftInput = Omit<OfflineDraft, "localVersion" | "conflictOf">;
export interface OutboxRow {
  ownerId: string;
  ritualId: string;
  operationId: string;
  payloadJson: string;
  payloadSha256: string;
  status:
    | "queued"
    | "sending"
    | "authentication-required"
    | "conflict"
    | "rejected"
    | "acknowledged";
  attempts: number;
  claimId: string | null;
  claimEpoch: string | null;
  claimUntilMs: number | null;
  result: SqlRitualWriteResult | null;
  /** Same durable write identity; optional fields require no IndexedDB schema/index change. */
  publicationPayloadJson?: string;
  publicationPayloadSha256?: string;
  publicationStatus?:
    | "queued"
    | "sending"
    | "authentication-required"
    | "stale"
    | "rejected"
    | "acknowledged";
  publicationAttempts?: number;
  publicationClaimId?: string | null;
  publicationClaimEpoch?: string | null;
  publicationClaimUntilMs?: number | null;
  publicationResult?: RitualPublicationResult | null;
}

export interface PublicationOutboxClaim {
  request: RitualPublicationRequestV1;
  claimId: string;
  account: OfflineAccount;
}
/** Raw legacy evidence is never attributed to the active account or automatically replayed. */
export interface QuarantinedRecovery {
  key: string;
  originalKey: string;
  serialized: string;
}

/** Internal storage schema. Application callers use the gated repository, not raw tables. */
export class RitualOfflineDatabase extends Dexie {
  device!: Table<DeviceState, string>;
  checks!: Table<StoredCheck, [string, string]>;
  authorizations!: Table<OfflineAuthorization, [string, string]>;
  bundles!: Table<StoredBundle, [string, string]>;
  assets!: Table<StoredAsset, [string, string, string, string]>;
  sources!: Table<SourceSnapshot, [string, string, string]>;
  drafts!: Table<OfflineDraft, [string, string]>;
  outbox!: Table<OutboxRow, [string, string]>;
  quarantine!: Table<QuarantinedRecovery, string>;

  constructor(name = "magickli-ritual-offline", options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      device: "&key",
      checks: "&[ownerId+ritualId], ownerId",
      authorizations: "&[ownerId+ritualId], ownerId",
      bundles: "&[ownerId+ritualId], ownerId",
      assets: "&[ownerId+ritualId+bundleId+key], ownerId, [ownerId+ritualId]",
      sources: "&[ownerId+ritualId+revisionId], ownerId, [ownerId+ritualId]",
      drafts: "&[ownerId+id], [ownerId+ritualId]",
      outbox: "&[ownerId+operationId], [ownerId+ritualId]",
      quarantine: "&key",
    });
  }
}
