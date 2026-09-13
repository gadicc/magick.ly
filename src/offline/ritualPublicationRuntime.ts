import "server-only";

import path from "node:path";
import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import { readRitualUploadStorageConfig } from "../files/ritualUploadRuntime";
import { readAuthorizedRitualFile } from "../files/runtime";
import { createR2RitualBundleStorage } from "./r2RitualBundleStorage";
import { isRitualBundlePublicationPolicyId } from "./ritualBundlePublication";
import { createRitualPublicationBackfillService } from "./ritualPublicationBackfill";
import { createRitualPublicationPlanBuilder } from "./ritualPublicationPlan";
import { createRitualPublicationService } from "./ritualPublicationService";
import { loadSqlLegacyRitualImageSources } from "./sqlLegacyRitualImageSources";
import { createSqlRitualBundlePublisher } from "./sqlRitualBundlePublications";
import { createSqlRitualBundleReader } from "./sqlRitualBundleReads";
import {
  createSqlRitualPublicationBackfillReader,
  createSqlRitualPublicationGlobalAdminChecker,
} from "./sqlRitualPublicationBackfill";
import { createSqlRitualPublicationSelectionReader } from "./sqlRitualPublicationSelection";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function publicationPolicies(environment: RuntimeEnvironment) {
  try {
    const values: unknown = JSON.parse(
      environment.MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS ?? "",
    );
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 32 ||
      !values.every(isRitualBundlePublicationPolicyId) ||
      new Set(values).size !== values.length
    )
      throw new Error();
    // The first policy is the active writer; following entries remain readable history.
    return values;
  } catch {
    throw new Error("Ritual publication is not configured");
  }
}

/** Compose the actual request-scoped SQL policy, private R2 and evidence builders. */
export function createRitualPublicationRuntime(
  environment: RuntimeEnvironment,
  dependencies: {
    database: typeof db;
    getVerifiedActorId(): Promise<string | null>;
    publicDirectory: string;
    readAuthorizedPrivateFile: typeof readAuthorizedRitualFile;
  },
) {
  const upload = readRitualUploadStorageConfig(environment);
  const policies = publicationPolicies(environment);
  const activePolicy = policies[0];
  const storage = createR2RitualBundleStorage({
    kind: "r2",
    endpoint: upload.endpoint,
    bucket: upload.bucket,
    credentials: upload.credentials,
    bundlePrefix: "ritual-bundles",
    reservedPrefixes: [upload.stagingPrefix, upload.canonicalPrefix],
  });
  const publisher = createSqlRitualBundlePublisher(
    dependencies.database,
    dependencies.getVerifiedActorId,
    {
      publicationPolicyId: activePolicy,
      locations: storage.locations,
    },
  );
  const loadSelection = createSqlRitualPublicationSelectionReader(
    dependencies.database,
    dependencies.getVerifiedActorId,
  );
  const buildPrepared = createRitualPublicationPlanBuilder({
    publicDirectory: dependencies.publicDirectory,
    environment,
    readAuthorizedPrivateFile: dependencies.readAuthorizedPrivateFile,
    loadLegacySources: (sha256) =>
      dependencies.database.transaction(
        (transaction) => loadSqlLegacyRitualImageSources(transaction, sha256),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  });
  const publish = createRitualPublicationService({
    loadSelection,
    buildPrepared,
    publisher,
    storage,
  });
  const bundleReader = createSqlRitualBundleReader(
    dependencies.database,
    dependencies.getVerifiedActorId,
    { acceptedPublicationPolicyIds: policies },
  );
  const backfill = createRitualPublicationBackfillService({
    readPage: createSqlRitualPublicationBackfillReader(
      dependencies.database,
      dependencies.getVerifiedActorId,
      { publicationPolicyId: activePolicy },
    ),
    authorizeGlobalActor: createSqlRitualPublicationGlobalAdminChecker(
      dependencies.database,
      dependencies.getVerifiedActorId,
    ),
    hasCurrentBundle: (candidate, expectedActorId) =>
      bundleReader
        .getManifest({
          expectedActorId,
          ritualId: candidate.ritualId,
        })
        .then((manifest) => manifest !== null),
    publish,
  });
  return Object.freeze({
    publish,
    backfill,
    destroy: () => storage.destroy(),
  });
}

let runtime: ReturnType<typeof createRitualPublicationRuntime> | undefined;

export function getRitualPublicationRuntime() {
  return (runtime ??= createRitualPublicationRuntime(process.env, {
    database: db,
    getVerifiedActorId: getCurrentSqlUserId,
    publicDirectory: path.resolve(process.cwd(), "public"),
    readAuthorizedPrivateFile: readAuthorizedRitualFile,
  }));
}

/** Server-side post-save seam; committed source success never depends on its result. */
export function requestCurrentRitualPublication(
  input: unknown,
  signal?: AbortSignal,
) {
  return getRitualPublicationRuntime().publish(input, signal);
}

export function backfillCurrentRitualPublication(
  input: unknown,
  signal?: AbortSignal,
) {
  return getRitualPublicationRuntime().backfill(input, signal);
}
