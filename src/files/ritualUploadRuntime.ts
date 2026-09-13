import "server-only";

import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import { createRitualUploadFinalizer } from "./finalizeRitualUpload";
import {
  createR2RitualStorage,
  type R2RitualStorage,
  type R2RitualStorageConfig,
} from "./r2RitualStorage";
import {
  type RitualUploadCode,
  RitualUploadError,
  type RitualUploadInitiateResult,
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

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function required(env: RuntimeEnvironment, key: string) {
  const value = env[key]?.trim();
  if (!value || value.includes("\0"))
    throw new Error("Ritual upload storage is not configured");
  return value;
}

/** Reads only Loom's canonical S3 variables; no ambient AWS credential fallback. */
export function readRitualUploadStorageConfig(
  env: RuntimeEnvironment,
): R2RitualStorageConfig {
  if (
    required(env, "FILES_STORAGE_PROVIDER") !== "cloudflare-r2" ||
    required(env, "FILES_S3_REGION") !== "auto" ||
    required(env, "FILES_S3_FORCE_PATH_STYLE") !== "true"
  )
    throw new Error("Ritual upload storage is not configured");
  return {
    kind: "r2",
    endpoint: required(env, "FILES_S3_ENDPOINT"),
    bucket: required(env, "FILES_S3_BUCKET"),
    credentials: {
      accessKeyId: required(env, "FILES_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "FILES_S3_SECRET_ACCESS_KEY"),
    },
    stagingPrefix: "ritual-staging",
    canonicalPrefix: "ritual-files",
  };
}

export interface RitualUploadRuntime {
  initiate(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RitualUploadInitiateResult>;
  finalize(input: unknown, signal: AbortSignal): Promise<RitualUploadResult>;
}

export function composeRitualUploadRuntime(options: {
  storage: R2RitualStorage;
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
    const storage = createR2RitualStorage(
      readRitualUploadStorageConfig(process.env),
    );
    runtime = composeRitualUploadRuntime({
      storage,
      getCurrentActorId: getCurrentSqlUserId,
    });
  }
  return runtime;
}
