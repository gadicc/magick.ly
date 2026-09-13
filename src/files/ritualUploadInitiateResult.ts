import type {
  DirectRitualUpload,
  RitualUploadCode,
  RitualUploadReceipt,
} from "./ritualUploadProtocol";

/** Initiation returns either an expiring bearer capability or an authorized completed replay. */
export type RitualUploadInitiateResult =
  | {
      ok: true;
      state: "upload";
      replayed: boolean;
      upload: DirectRitualUpload;
    }
  | {
      ok: true;
      state: "completed";
      replayed: true;
      receipt: RitualUploadReceipt;
    }
  | { ok: false; code: RitualUploadCode; retryable: boolean };
