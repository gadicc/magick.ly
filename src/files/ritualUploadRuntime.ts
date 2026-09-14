import "server-only";

import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import { createRitualUploadFinalizer } from "./finalizeRitualUpload";
import {
  createMinioRitualStorage,
  createR2RitualStorage,
  type RitualObjectStorage,
} from "./r2RitualStorage";
import {
  type RitualStorageConfig,
  type RuntimeEnvironment,
  readRitualStorageConfig,
} from "./ritualStorageConfig";
import type { RitualUploadInitiateResult } from "./ritualUploadInitiateResult";
import {
  type RitualUploadCode,
  RitualUploadError,
  type RitualUploadResult,
} from "./ritualUploadProtocol";
import { createSqlRitualUploads } from "./sqlRitualUploads";
import { createSharpRitualImageValidator } from "./validateRitualImage";

const RETRYABLE = new Set<RitualUploadCode>([
  "BUSY",
  "NOT_UPLOADED",
  "ABORTED",
  "TIMEOUT",
  "UNAVAILABLE",
]);

function outcome(error: unknown): Extract<RitualUploadResult, { ok: false }> {
  const code =
    error instanceof RitualUploadError ? error.code : ("UNAVAILABLE" as const);
  return { ok: false, code, retryable: RETRYABLE.has(code) };
}

/** Reads only Loom's canonical S3 variables; no ambient AWS credential fallback. */
export function readRitualUploadStorageConfig(
  env: RuntimeEnvironment,
): RitualStorageConfig {
  try {
    return readRitualStorageConfig(env);
  } catch {
    throw new Error("Ritual upload storage is not configured");
  }
}

export interface RitualUploadRuntime {
  initiate(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RitualUploadInitiateResult>;
  finalize(input: unknown, signal: AbortSignal): Promise<RitualUploadResult>;
}

export function composeRitualUploadRuntime(options: {
  storage: RitualObjectStorage;
  getCurrentActorId: () => Promise<string | null>;
}): RitualUploadRuntime {
  const uploads = createSqlRitualUploads(db, options.getCurrentActorId, {
    locations: options.storage.locations,
  });
  const finalize = createRitualUploadFinalizer({
    readVerifiedActorId: options.getCurrentActorId,
    publication: uploads.publication,
    storage: options.storage.storage,
    imageValidator: createSharpRitualImageValidator(),
  });
  return {
    async initiate(input, signal) {
      try {
        const result = await uploads.initiate(input, signal);
        if (result.kind === "completed")
          return {
            ok: true,
            state: "completed",
            replayed: true,
            receipt: result.receipt,
          };
        const upload = await options.storage.directUpload(
          result.intent,
          signal,
        );
        return {
          ok: true,
          state: "upload",
          replayed: result.replayed,
          upload,
        };
      } catch (error) {
        return outcome(error);
      }
    },
    finalize,
  };
}

let runtime: RitualUploadRuntime | undefined;

export function getRitualUploadRuntime() {
  if (!runtime) {
    const config = readRitualUploadStorageConfig(process.env);
    const storage =
      config.kind === "r2"
        ? createR2RitualStorage(config)
        : createMinioRitualStorage(config);
    runtime = composeRitualUploadRuntime({
      storage,
      getCurrentActorId: getCurrentSqlUserId,
    });
  }
  return runtime;
}
