import type { OfflineAccount } from "./lease";

/** Safe view-lifetime metadata; no titles, source, asset URLs or queued payloads. */
export interface OfflineResourceState {
  ritualId: string;
  /** True only for a complete stored bundle with both current and bundle leases valid. */
  read: boolean;
  sourceEdit: boolean;
  readDeadlineMs: number | null;
  sourceDeadlineMs: number | null;
  /** Opaque grant identities bind a subsequent observed clock instant to these exact leases. */
  leaseId: string | null;
  bundleLeaseId: string | null;
}
/** Account binding is local state, never a substitute for a server permission check. */
export interface OfflineRuntimeState {
  account: OfflineAccount | null;
  cleanupPending: boolean;
  observedAtMs: number;
  resources: OfflineResourceState[];
}
/** An actual observed instant applies only to the matching epoch and grant, never a renewed lease. */
export interface OfflineClockObservation {
  account: OfflineAccount;
  observedAtMs: number;
  leases: Array<
    Pick<OfflineResourceState, "ritualId" | "leaseId" | "bundleLeaseId">
  >;
}
/** The runtime uses these repository operations; views never read raw IndexedDB tables. */
export interface OfflineRuntimeRepository {
  runtimeState(
    ritualIds: string[],
    observation?: OfflineClockObservation,
  ): Promise<OfflineRuntimeState>;
  signOut(account: OfflineAccount): Promise<void>;
  activateAccount(ownerId: string): Promise<OfflineAccount>;
  resumeCleanup(): Promise<void>;
}
