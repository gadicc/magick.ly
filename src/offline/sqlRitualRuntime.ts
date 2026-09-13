import "server-only";

import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { resolveRitualRouteId } from "../doc/sqlRitualRoute";
import { createR2RitualBundleStorage } from "./r2RitualBundleStorage";
import { readRitualBundleAsset } from "./readRitualBundleAsset";
import { isRitualBundlePublicationPolicyId } from "./ritualBundlePublication";
import {
  createRitualHttpHandlers,
  type RitualHttpServices,
} from "./ritualHttp";
import { createSqlRitualPermissionChecker } from "./sqlPermissionCheck";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
interface RuntimeDependencies {
  db: SqlRitualReadDatabase;
  getVerifiedActorId(): Promise<string | null>;
}

const BUNDLE_PREFIX = "ritual-bundles";
const RESERVED_FILE_PREFIXES = ["ritual-staging", "ritual-files"] as const;

function stringArray(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((row) => typeof row === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function publicationPolicies(environment: RuntimeEnvironment): string[] {
  const values = stringArray(
    environment.MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS,
  );
  return values &&
    values.length <= 32 &&
    values.every(isRitualBundlePublicationPolicyId)
    ? [...new Set(values)]
    : [];
}

function bundleStorage(environment: RuntimeEnvironment) {
  if (
    environment.FILES_STORAGE_PROVIDER !== "cloudflare-r2" ||
    environment.FILES_S3_REGION !== "auto" ||
    environment.FILES_S3_FORCE_PATH_STYLE !== "true"
  )
    return null;
  const endpoint = environment.FILES_S3_ENDPOINT;
  const bucket = environment.FILES_S3_BUCKET;
  const accessKeyId = environment.FILES_S3_ACCESS_KEY_ID;
  const secretAccessKey = environment.FILES_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  try {
    return createR2RitualBundleStorage({
      kind: "r2",
      endpoint,
      bucket,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      bundlePrefix: BUNDLE_PREFIX,
      reservedPrefixes: RESERVED_FILE_PREFIXES,
    });
  } catch {
    return null;
  }
}

/**
 * Compose existing SQL policy and byte services from explicit deployment input.
 * Missing or malformed policy/provider settings stay unavailable; no ambient AWS
 * configuration, public URL, fallback bucket, or network probe is attempted.
 */
export function createSqlRitualRuntime(
  environment: RuntimeEnvironment,
  dependencies: RuntimeDependencies,
) {
  const policies = publicationPolicies(environment);
  const reader = createSqlRitualBundleReader(
    dependencies.db,
    dependencies.getVerifiedActorId,
    { acceptedPublicationPolicyIds: policies },
  );
  const storage = bundleStorage(environment);
  const services: RitualHttpServices = {
    resolveRouteAlias: (alias) => resolveRitualRouteId(dependencies.db, alias),
    checkPermission: createSqlRitualPermissionChecker(
      dependencies.db,
      dependencies.getVerifiedActorId,
    ),
    getManifest: reader.getManifest,
    readAsset: (input, signal) =>
      storage
        ? readRitualBundleAsset(reader, storage, input, { signal })
        : Promise.resolve(null),
  };
  return Object.freeze({
    handlers: createRitualHttpHandlers(services),
    publicationPoliciesConfigured: policies.length > 0,
    storageConfigured: storage !== null,
  });
}

let runtime: ReturnType<typeof createSqlRitualRuntime> | undefined;

/** One validated server runtime; Next supplies `.env*` before this is evaluated. */
export function getSqlRitualRuntime() {
  return (runtime ??= createSqlRitualRuntime(process.env, {
    db,
    getVerifiedActorId: getCurrentSqlUserId,
  }));
}
