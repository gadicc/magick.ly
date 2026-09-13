import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import { readLegacyImportCatalog } from "./legacyImportCatalog";
import {
  createLegacyImportCheckpoint,
  type LegacyImportBinding,
  type LegacyImportCheckpoint,
  readLegacyImportCheckpoint,
} from "./legacyImportCheckpoint";
import {
  createLegacyImportConnection,
  LegacyImportConnectionError,
  type LegacyImportConnectionTarget,
} from "./legacyImportConnection";
import { createLegacyImportMigrationManifest } from "./legacyImportMigrations";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import {
  type LegacyBackupDescriptor,
  LegacyBackupError,
  prepareLegacyBackup,
} from "./prepareLegacyBackup";
import type { LegacyImportConfigV1 } from "./prepareLegacyImport";
import {
  createSqlLegacyImporter,
  legacyImportSchemaIdentity,
  SqlLegacyImportError,
  type SqlLegacyImportReceipt,
} from "./sqlLegacyImport";

/** Closed reviewed graph, including schema/migration inputs. Extend with new local imports. */
export const LEGACY_IMPORT_REQUIRED_ARTIFACTS = [
  "drizzle.config.ts",
  "drizzle/0000_enable_uuidv7.sql",
  "drizzle/0001_legacy_id_aliases.sql",
  "drizzle/0002_flashy_rockslide.sql",
  "drizzle/0003_memberships.sql",
  "drizzle/0004_rituals.sql",
  "drizzle/0005_study_progress.sql",
  "drizzle/0006_temple_creation.sql",
  "drizzle/0007_files_metadata.sql",
  "drizzle/0008_ritual_write_commands.sql",
  "drizzle/0009_ritual_file_uploads.sql",
  "drizzle/0010_legacy_file_locations.sql",
  "drizzle/0011_ritual_bundles.sql",
  "drizzle/0012_discourse_links.sql",
  "drizzle/0013_legacy_import_runs.sql",
  "drizzle/meta/0000_snapshot.json",
  "drizzle/meta/0001_snapshot.json",
  "drizzle/meta/0002_snapshot.json",
  "drizzle/meta/0003_snapshot.json",
  "drizzle/meta/0004_snapshot.json",
  "drizzle/meta/0005_snapshot.json",
  "drizzle/meta/0006_snapshot.json",
  "drizzle/meta/0007_snapshot.json",
  "drizzle/meta/0008_snapshot.json",
  "drizzle/meta/0009_snapshot.json",
  "drizzle/meta/0010_snapshot.json",
  "drizzle/meta/0011_snapshot.json",
  "drizzle/meta/0012_snapshot.json",
  "drizzle/meta/0013_snapshot.json",
  "drizzle/meta/_journal.json",
  "loom.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/legacy-import.ts",
  "src/db/legacyIds.ts",
  "src/db/neonFull.ts",
  "src/db/schema/auth.ts",
  "src/db/schema/discourse.ts",
  "src/db/schema/ids.ts",
  "src/db/schema/index.ts",
  "src/db/schema/legacyFiles.ts",
  "src/db/schema/legacyIds.ts",
  "src/db/schema/legacyImportRuns.ts",
  "src/db/schema/loomFiles.ts",
  "src/db/schema/memberships.ts",
  "src/db/schema/ritualBundles.ts",
  "src/db/schema/ritualCommands.ts",
  "src/db/schema/ritualFiles.ts",
  "src/db/schema/rituals.ts",
  "src/db/schema/studyProgress.ts",
  "src/db/schema/templeCommands.ts",
  "src/db/schema/userProfile.ts",
  "src/lib/ids.ts",
  "src/migration/classifyLegacyAuthSource.ts",
  "src/migration/decodeLegacyBson.ts",
  "src/migration/legacyImportCatalog.ts",
  "src/migration/legacyImportCheckpoint.ts",
  "src/migration/legacyImportCommand.ts",
  "src/migration/legacyImportConnection.ts",
  "src/migration/legacyImportMigrations.ts",
  "src/migration/legacyImportRows.ts",
  "src/migration/legacyImportValue.ts",
  "src/migration/normalizeLegacyAuth.ts",
  "src/migration/planBetterAuthImport.ts",
  "src/migration/planLegacyDiscourseImport.ts",
  "src/migration/planLegacyFileImport.ts",
  "src/migration/planLegacyMembershipImport.ts",
  "src/migration/planLegacyRitualImport.ts",
  "src/migration/planLegacyStudyImport.ts",
  "src/migration/prepareLegacyBackup.ts",
  "src/migration/prepareLegacyImport.ts",
  "src/migration/sqlLegacyImport.ts",
  "tsconfig.json",
] as const;

const execute = promisify(execFile);
const MiB = 1024 * 1024;
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Explicit reviewed provider identity; an environment label alone proves nothing. */
export interface LegacyImportCommandTarget
  extends LegacyImportConnectionTarget {
  projectId: string;
  branchId: string;
  endpointId: string;
  parentId: string | null;
  regionId: string;
  postgresMajor: number;
  environment: "production" | "rehearsal";
}

/** Private operator artifact, pinned separately by its exact file SHA-256. */
export interface LegacyImportCommandReview {
  profile: "magickli-legacy-import-review-v1";
  target: LegacyImportCommandTarget;
  source: {
    directory: string;
    database: string;
    manifestSha256: string;
    importedAt: string;
    config: LegacyImportConfigV1;
  };
  catalog: { path: string; sha256: string };
  migrationsSha256: string;
  /** Reviewed implementation graph and migrations, relative to projectRoot. */
  artifacts: Record<string, string>;
}

/** Immutable local allocation record. Never print or expose its checkpoint payload. */
export interface LegacyImportCommandRun {
  profile: "magickli-legacy-import-command-run-v1";
  reviewSha256: string;
  binding: LegacyImportBinding;
  checkpoint: LegacyImportCheckpoint;
  source: LegacyBackupDescriptor;
}

/** Inputs supplied by the maintenance entrypoint, never an HTTP request. */
export interface LegacyImportCommandOptions {
  action: "prepare" | "inspect" | "apply";
  reviewPath: string;
  reviewSha256: string;
  runPath: string;
  neonCli: string;
  neonProfile: string;
  selectedUrl: string;
  projectRoot: string;
}

type Code =
  | LegacyImportConnectionError["code"]
  | LegacyBackupError["code"]
  | SqlLegacyImportError["code"]
  | "INVALID_INPUT"
  | "ARTIFACT_MISMATCH"
  | "PROVIDER_FAILED"
  | "TARGET_MISMATCH"
  | "STATE_CONFLICT"
  | "STATE_IO_FAILED"
  | "CONNECTION_CLOSE_FAILED"
  | "IMPORT_FAILED"
  | "OUTCOME_UNKNOWN";

/** Safe terminal error: never retain child output, credentials or SQL diagnostics. */
export class LegacyImportCommandError extends Error {
  constructor(
    public readonly code: Code,
    /** Retain an acknowledged SQL result if only subsequent connection cleanup failed. */
    public readonly receipt?: SqlLegacyImportReceipt | null,
  ) {
    super(code);
    this.name = "LegacyImportCommandError";
  }
}

async function privateDirectory(path: string) {
  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await directory.stat();
    if (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)
      fail("STATE_IO_FAILED");
  } finally {
    await directory.close();
  }
}
function fail(code: Code = "INVALID_INPUT"): never {
  throw new LegacyImportCommandError(code);
}
function fields(value: unknown, names: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    fail();
}
function absolute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    isAbsolute(value) &&
    resolve(value) === value
  );
}
function providerId(value: unknown, prefix = "") {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    value.startsWith(prefix)
  );
}

/** Bounded descriptor reads also refuse FIFOs before attempting any blocking read. */
async function readRegular(
  path: string,
  limit: number,
  privateFile: boolean,
  allowMissing = false,
): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.size <= 0 ||
      before.size > BigInt(limit) ||
      (privateFile &&
        (before.uid !== BigInt(process.getuid!()) ||
          (before.mode & BigInt(0o077)) !== BigInt(0)))
    )
      fail();
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) fail();
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      fail();
    return buffer;
  } finally {
    await handle.close();
  }
}

async function publishRun(path: string, run: LegacyImportCommandRun) {
  const directory = await open(
    dirname(path),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const temporary = join(dirname(path), `.import-${randomUUID()}.tmp`);
  let created = false;
  try {
    const stat = await directory.stat();
    if (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) fail();
    const bytes = serializeLegacyImportValue(run);
    const file = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await file.writeFile(bytes, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    // Link publishes exclusively. Never replace or remove the final path, even
    // if directory fsync fails after publication: a retry must reuse these IDs.
    await link(temporary, path);
    await directory.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail("STATE_CONFLICT");
    fail("STATE_IO_FAILED");
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
    await directory.close();
  }
}

function validateReview(review: LegacyImportCommandReview) {
  fields(review, [
    "profile",
    "target",
    "source",
    "catalog",
    "migrationsSha256",
    "artifacts",
  ]);
  if (review.profile !== "magickli-legacy-import-review-v1") fail();
  const target = review.target;
  fields(target, [
    "projectId",
    "branchId",
    "endpointId",
    "parentId",
    "regionId",
    "postgresMajor",
    "environment",
    "host",
    "port",
    "database",
    "role",
  ]);
  if (
    !providerId(target.projectId) ||
    !providerId(target.branchId, "br-") ||
    !providerId(target.endpointId, "ep-") ||
    (target.parentId !== null && !providerId(target.parentId, "br-")) ||
    !providerId(target.regionId) ||
    !Number.isInteger(target.postgresMajor) ||
    target.postgresMajor < 15 ||
    target.postgresMajor > 99 ||
    !["production", "rehearsal"].includes(target.environment)
  )
    fail();
  fields(review.source, [
    "directory",
    "database",
    "manifestSha256",
    "importedAt",
    "config",
  ]);
  fields(review.catalog, ["path", "sha256"]);
  if (
    !absolute(review.source.directory) ||
    typeof review.source.database !== "string" ||
    !digest(review.source.manifestSha256) ||
    typeof review.source.importedAt !== "string" ||
    new Date(review.source.importedAt).toISOString() !==
      review.source.importedAt ||
    !absolute(review.catalog.path) ||
    !digest(review.catalog.sha256) ||
    !digest(review.migrationsSha256) ||
    !review.artifacts ||
    typeof review.artifacts !== "object" ||
    Array.isArray(review.artifacts) ||
    Object.keys(review.artifacts).length > 1000
  )
    fail();
  for (const required of LEGACY_IMPORT_REQUIRED_ARTIFACTS)
    if (!Object.hasOwn(review.artifacts, required)) fail("ARTIFACT_MISMATCH");
}

async function verifyArtifacts(
  root: string,
  artifacts: Record<string, string>,
) {
  for (const [path, expected] of Object.entries(artifacts)) {
    if (
      !path ||
      path.includes("\\") ||
      path.split("/").some((s) => !s || s === "." || s === "..") ||
      isAbsolute(path) ||
      !digest(expected) ||
      relative(root, join(root, path)) !== path
    )
      fail("ARTIFACT_MISMATCH");
    try {
      if (
        hash((await readRegular(join(root, path), 16 * MiB, false))!) !==
        expected
      )
        fail("ARTIFACT_MISMATCH");
    } catch {
      fail("ARTIFACT_MISMATCH");
    }
  }
}

async function verifyTarget(
  options: LegacyImportCommandOptions,
  target: LegacyImportCommandTarget,
) {
  // Neither app secrets nor OAuth/CLI routing overrides belong in this process.
  const env = {
    CI: "1",
    NODE_ENV: "production" as const,
    ...Object.fromEntries(
      ["HOME", "PATH", "LANG", "TMPDIR", "SYSTEMROOT"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]!]),
    ),
  };
  async function get(path: string) {
    try {
      const { stdout } = await execute(
        options.neonCli,
        [
          "api",
          path,
          "--method",
          "GET",
          "--profile",
          options.neonProfile,
          "--api-host",
          "https://console.neon.tech/api/v2",
          "--oauth-host",
          "https://oauth2.neon.tech",
          "--config-dir",
          join(homedir(), ".config/neon"),
          "--no-analytics",
          "--output",
          "json",
        ],
        {
          cwd: options.projectRoot,
          env,
          timeout: 30_000,
          maxBuffer: MiB,
          encoding: "utf8",
        },
      );
      return JSON.parse(stdout);
    } catch {
      fail("PROVIDER_FAILED");
    }
  }
  const base = `/projects/${target.projectId}`;
  const { project } = await get(base);
  const { branch } = await get(`${base}/branches/${target.branchId}`);
  const { endpoint } = await get(`${base}/endpoints/${target.endpointId}`);
  if (
    project?.id !== target.projectId ||
    project.region_id !== target.regionId ||
    project.pg_version !== target.postgresMajor ||
    branch?.id !== target.branchId ||
    branch.project_id !== target.projectId ||
    (branch.parent_id ?? null) !== target.parentId ||
    branch.current_state !== "ready" ||
    branch.pending_state ||
    endpoint?.id !== target.endpointId ||
    endpoint.project_id !== target.projectId ||
    endpoint.branch_id !== target.branchId ||
    endpoint.host !== target.host ||
    endpoint.region_id !== target.regionId ||
    endpoint.type !== "read_write" ||
    endpoint.disabled !== false ||
    endpoint.pending_state ||
    !["idle", "active"].includes(endpoint.current_state)
  )
    fail("TARGET_MISMATCH");
}

/**
 * Run one reviewed maintenance operation. Existing local allocations are immutable;
 * inspect/apply and repeated prepare never reread BSON or allocate replacement IDs.
 * The operator separately establishes writer pause, Preview isolation and cutover
 * approval. This command never migrates, provisions resources or activates runtime.
 */
export async function runLegacyImportCommand(
  input: LegacyImportCommandOptions,
): Promise<SqlLegacyImportReceipt | null> {
  let connection: ReturnType<typeof createLegacyImportConnection> | undefined;
  let failed = false;
  let phase: Code = "INVALID_INPUT";
  let receipt: SqlLegacyImportReceipt | null | undefined;
  try {
    const options = parseLegacyImportValue(
      serializeLegacyImportValue(input),
    ) as LegacyImportCommandOptions;
    fields(options, [
      "action",
      "reviewPath",
      "reviewSha256",
      "runPath",
      "neonCli",
      "neonProfile",
      "selectedUrl",
      "projectRoot",
    ]);
    if (
      !["prepare", "inspect", "apply"].includes(options.action) ||
      ![
        options.reviewPath,
        options.runPath,
        options.neonCli,
        options.projectRoot,
      ].every(absolute) ||
      options.runPath === options.reviewPath ||
      !digest(options.reviewSha256) ||
      typeof options.neonProfile !== "string" ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,63}$/.test(options.neonProfile)
    )
      fail();
    phase = "STATE_IO_FAILED";
    await privateDirectory(dirname(options.runPath));
    phase = "ARTIFACT_MISMATCH";
    const reviewBytes = (await readRegular(options.reviewPath, MiB, true))!;
    if (hash(reviewBytes) !== options.reviewSha256) fail("ARTIFACT_MISMATCH");
    const review = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(reviewBytes),
    ) as LegacyImportCommandReview;
    validateReview(review);
    await verifyArtifacts(options.projectRoot, review.artifacts);
    const journal = JSON.parse(
      (await readRegular(
        join(options.projectRoot, "drizzle/meta/_journal.json"),
        MiB,
        false,
      ))!.toString("utf8"),
    );
    if (
      !Array.isArray(journal.entries) ||
      journal.entries.some(
        (entry: { tag?: unknown }) =>
          typeof entry.tag !== "string" ||
          !/^[a-zA-Z0-9_-]+$/.test(entry.tag) ||
          !Object.hasOwn(review.artifacts, `drizzle/${entry.tag}.sql`),
      )
    )
      fail("ARTIFACT_MISMATCH");
    const migrations = createLegacyImportMigrationManifest(
      readMigrationFiles({
        migrationsFolder: join(options.projectRoot, "drizzle"),
      }),
    );
    if (migrations.sha256 !== review.migrationsSha256)
      fail("ARTIFACT_MISMATCH");
    const catalogBytes = (await readRegular(
      review.catalog.path,
      16 * MiB,
      true,
    ))!;
    if (hash(catalogBytes) !== review.catalog.sha256) fail("ARTIFACT_MISMATCH");
    const catalog = readLegacyImportCatalog(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(catalogBytes),
      ),
    );
    if (catalog.snapshot.database.postgresMajor !== review.target.postgresMajor)
      fail("ARTIFACT_MISMATCH");
    const schemaSha256 = legacyImportSchemaIdentity(migrations, catalog);
    const targetSha256 = hash(serializeLegacyImportValue(review.target));
    const { host, port, database, role } = review.target;
    phase = "TARGET_MISMATCH";
    connection = createLegacyImportConnection(options.selectedUrl, {
      host,
      port,
      database,
      role,
    });
    await verifyTarget(options, review.target);
    let run: LegacyImportCommandRun;
    phase = "STATE_IO_FAILED";
    const bytes = await readRegular(options.runPath, 64 * MiB, true, true);
    if (bytes) {
      phase = "STATE_CONFLICT";
      run = parseLegacyImportValue(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as LegacyImportCommandRun;
    } else {
      if (options.action !== "prepare") fail("STATE_CONFLICT");
      phase = "IMPORT_FAILED";
      const result = await prepareLegacyBackup({
        directory: review.source.directory,
        expectedManifestSha256: review.source.manifestSha256,
        expectedDatabase: review.source.database,
        importedAt: new Date(review.source.importedAt),
        config: review.source.config,
      });
      const binding: LegacyImportBinding = {
        runId: createUuidV7(),
        sourceManifestSha256: review.source.manifestSha256,
        sourceDescriptorSha256: result.sourceDescriptorSha256,
        targetSha256,
        schemaSha256,
      };
      run = {
        profile: "magickli-legacy-import-command-run-v1",
        reviewSha256: options.reviewSha256,
        binding,
        checkpoint: createLegacyImportCheckpoint(result.prepared, binding),
        source: result.source,
      };
      await publishRun(options.runPath, run);
    }
    phase = "STATE_CONFLICT";
    fields(run, ["profile", "reviewSha256", "binding", "checkpoint", "source"]);
    if (
      run.profile !== "magickli-legacy-import-command-run-v1" ||
      run.reviewSha256 !== options.reviewSha256 ||
      !isUuidV7(run.binding.runId) ||
      run.binding.targetSha256 !== targetSha256 ||
      run.binding.schemaSha256 !== schemaSha256 ||
      run.binding.sourceManifestSha256 !== review.source.manifestSha256 ||
      run.binding.sourceDescriptorSha256 !==
        hash(serializeLegacyImportValue(run.source)) ||
      run.source.profile !== "magickli-verified-backup-v1" ||
      run.source.database !== review.source.database ||
      run.source.manifestSha256 !== review.source.manifestSha256
    )
      fail("STATE_CONFLICT");
    const prepared = readLegacyImportCheckpoint(run.checkpoint, run.binding);
    if (
      prepared.importedAt.toISOString() !== review.source.importedAt ||
      !isDeepStrictEqual(prepared.config, review.source.config)
    )
      fail("STATE_CONFLICT");
    await verifyArtifacts(options.projectRoot, review.artifacts);
    await verifyTarget(options, review.target);
    phase = "IMPORT_FAILED";
    const service = createSqlLegacyImporter(connection.db, {
      binding: run.binding,
      database,
      role,
      migrations,
      catalog,
    });
    if (options.action === "prepare")
      receipt = await service.prepare(run.checkpoint);
    else if (options.action === "inspect") receipt = await service.inspect();
    else receipt = await service.apply(run.checkpoint.payloadSha256);
    return receipt;
  } catch (error) {
    failed = true;
    if (error instanceof LegacyImportCommandError)
      throw new LegacyImportCommandError(error.code);
    if (
      error instanceof SqlLegacyImportError ||
      error instanceof LegacyImportConnectionError ||
      error instanceof LegacyBackupError
    )
      return fail(error.code);
    return fail(phase);
  } finally {
    try {
      await connection?.close();
    } catch {
      if (!failed)
        throw new LegacyImportCommandError("CONNECTION_CLOSE_FAILED", receipt);
    }
  }
}
