import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  type FileHandle,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { serialize } from "bson";
import ts from "typescript";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import * as schema from "../db/schema";
import { captureLegacyImportCatalog } from "./legacyImportCatalog";
import { LEGACY_IMPORT_COLLECTIONS } from "./prepareLegacyImport";

// The command is exercised against real private files and the actual BSON and
// checkpoint helpers. Only authenticated provider/SQL effects are replaced.
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  service: vi.fn(),
  prepare: vi.fn(),
  inspect: vi.fn(),
  apply: vi.fn(),
  wrapOpen: vi.fn(),
  beforeLink: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      return mocks.wrapOpen(args[0], args[1], handle) ?? handle;
    },
    link: async (...args: Parameters<typeof fs.link>) => {
      await mocks.beforeLink(...args);
      return fs.link(...args);
    },
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: Object.assign(mocks.execFile, {
    [Symbol.for("nodejs.util.promisify.custom")]: (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        mocks.execFile(
          ...args,
          (error: unknown, stdout: string, stderr: string) =>
            error ? reject(error) : resolve({ stdout, stderr }),
        );
      }),
  }),
}));
vi.mock("./legacyImportConnection", async (original) => ({
  ...(await original<typeof import("./legacyImportConnection")>()),
  createLegacyImportConnection: mocks.connect,
}));
vi.mock("./sqlLegacyImport", async (original) => ({
  ...(await original<typeof import("./sqlLegacyImport")>()),
  createSqlLegacyImporter: mocks.service,
}));

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function privateWrite(path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function backupFixture(root: string) {
  const source = legacyImportFixture();
  const directory = join(root, "backup");
  const database = "synthetic";
  await mkdir(join(directory, database), { recursive: true, mode: 0o700 });
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const add = async (name: string, bytes: Uint8Array) => {
    const relative = `${database}/${name}`;
    await privateWrite(join(directory, relative), bytes);
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  };
  for (const collection of LEGACY_IMPORT_COLLECTIONS) {
    await add(
      `${collection}.bson.gz`,
      gzipSync(
        Buffer.concat(
          source.input[collection].map((row) =>
            serialize(row as Record<string, unknown>),
          ),
        ),
      ),
    );
    await add(
      `${collection}.metadata.json.gz`,
      gzipSync(JSON.stringify({ collectionName: collection, indexes: [] })),
    );
  }
  await add(
    "prelude.json.gz",
    gzipSync(
      JSON.stringify({ ServerVersion: "synthetic", ToolVersion: "synthetic" }),
    ),
  );
  const manifest = JSON.stringify({
    createdAt: "2026-09-13T00:00:00.000Z",
    source: "synthetic-only",
    database,
    tool: "synthetic",
    mode: "logical",
    files,
    verification: {},
  });
  await privateWrite(join(directory, "manifest.json"), manifest);
  return { source, directory, database, manifestSha256: hash(manifest) };
}

import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  createLegacyImportCheckpoint,
  readLegacyImportCheckpoint,
} from "./legacyImportCheckpoint";
import {
  LEGACY_IMPORT_REQUIRED_ARTIFACTS,
  LegacyImportCommandError,
  type LegacyImportCommandOptions,
  type LegacyImportCommandReview,
  type LegacyImportCommandRun,
  runLegacyImportCommand as run,
} from "./legacyImportCommand";
import { createLegacyImportMigrationManifest } from "./legacyImportMigrations";
import {
  fingerprintLegacyImportRows,
  projectLegacyImportRows,
} from "./legacyImportRows";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import {
  type SqlLegacyImportContract,
  SqlLegacyImportError,
  type SqlLegacyImportReceipt,
} from "./sqlLegacyImport";

const harness = await createMemoryPgliteHarness({ schema });
await harness.client.exec("set search_path = pg_catalog, public, pg_temp");
const catalog = await captureLegacyImportCatalog(harness.db);
afterAll(() => harness.client.close());
const originalRoot = resolve(".");
const secret = "SYNTHETIC_DATABASE_PASSWORD_NOT_OUTPUT";
const database = { syntheticDatabase: true };
let activeReview: LegacyImportCommandReview;
let sqlState: SqlLegacyImportReceipt | null;
let sqlContract: SqlLegacyImportContract;
let providerResponse: (path: string, call: number) => unknown;

function metadata(path: string) {
  const t = activeReview.target;
  if (path === `/projects/${t.projectId}`)
    return {
      project: {
        id: t.projectId,
        region_id: t.regionId,
        pg_version: t.postgresMajor,
      },
    };
  if (path === `/projects/${t.projectId}/branches/${t.branchId}`)
    return {
      branch: {
        id: t.branchId,
        project_id: t.projectId,
        parent_id: t.parentId,
        current_state: "ready",
        pending_state: null,
      },
    };
  if (path === `/projects/${t.projectId}/endpoints/${t.endpointId}`)
    return {
      endpoint: {
        id: t.endpointId,
        project_id: t.projectId,
        branch_id: t.branchId,
        host: t.host,
        region_id: t.regionId,
        type: "read_write",
        disabled: false,
        current_state: "idle",
        pending_state: null,
      },
    };
  throw new Error("Unexpected synthetic provider path");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wrapOpen.mockReset();
  mocks.beforeLink.mockReset();
  sqlState = null;
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.connect
    .mockReset()
    .mockReturnValue({ db: database, close: mocks.close });
  providerResponse = (path) => metadata(path);
  mocks.execFile
    .mockReset()
    .mockImplementation((_file, args, _options, callback) => {
      const response = providerResponse(
        args[1],
        mocks.execFile.mock.calls.length,
      );
      queueMicrotask(() => callback(null, JSON.stringify(response), ""));
      return {};
    });
  mocks.prepare.mockReset().mockImplementation(async (checkpoint) => {
    const prepared = readLegacyImportCheckpoint(
      checkpoint,
      sqlContract.binding,
    );
    const fingerprint = fingerprintLegacyImportRows(
      projectLegacyImportRows(prepared),
    );
    sqlState ??= {
      ...sqlContract.binding,
      payloadSha256: checkpoint.payloadSha256,
      configurationSha256: checkpoint.configurationSha256,
      expectedRowsSha256: fingerprint.sha256,
      state: "prepared",
      preparedAt: new Date("2026-09-13T12:35:00.001Z"),
      completedAt: null,
      counts: fingerprint.counts,
    };
    return structuredClone(sqlState);
  });
  mocks.inspect
    .mockReset()
    .mockImplementation(async () => structuredClone(sqlState));
  mocks.apply.mockReset().mockImplementation(async (payloadSha256) => {
    if (!sqlState || sqlState.payloadSha256 !== payloadSha256)
      throw new SqlLegacyImportError("MISSING_RUN");
    sqlState = {
      ...sqlState,
      state: "completed",
      completedAt: new Date("2026-09-13T12:36:00.002Z"),
    };
    return structuredClone(sqlState);
  });
  mocks.service.mockReset().mockImplementation((_db, contract) => {
    sqlContract = contract;
    return {
      prepare: mocks.prepare,
      inspect: mocks.inspect,
      apply: mocks.apply,
    };
  });
});

async function projectArtifacts(projectRoot: string) {
  const paths = new Set([
    "src/lib/ids.ts",
    "src/db/legacyIds.ts",
    "src/db/neonFull.ts",
    "scripts/legacy-import.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "loom.json",
    "drizzle.config.ts",
  ]);
  async function collect(relative: string) {
    for (const file of await readdir(join(originalRoot, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${file.name}`;
      if (file.isDirectory()) await collect(path);
      else if (
        !path.includes(".test.") &&
        (path.endsWith(".ts") ||
          path.endsWith(".sql") ||
          path.endsWith(".json"))
      )
        paths.add(path);
    }
  }
  await collect("src/migration");
  await collect("src/db/schema");
  await collect("drizzle");
  const artifacts: Record<string, string> = {};
  for (const path of paths) {
    const bytes = await readFile(join(originalRoot, path));
    await privateWrite(join(projectRoot, path), bytes);
    artifacts[path] = hash(bytes);
  }
  return artifacts;
}

async function fixture() {
  const root = await mkdtemp("/tmp/magickli-import-command-test-");
  roots.push(root);
  const backup = await backupFixture(root);
  const projectRoot = join(root, "project");
  const artifacts = await projectArtifacts(projectRoot);
  const catalogPath = join(root, "catalog.json");
  const catalogBytes = JSON.stringify(catalog);
  await privateWrite(catalogPath, catalogBytes);
  const migrations = createLegacyImportMigrationManifest(
    readMigrationFiles({ migrationsFolder: join(projectRoot, "drizzle") }),
  );
  const review: LegacyImportCommandReview = {
    profile: "magickli-legacy-import-review-v1",
    target: {
      projectId: "synthetic-project-123",
      branchId: "br-synthetic-test",
      endpointId: "ep-synthetic-test",
      parentId: "br-parent-test",
      regionId: "aws-eu-west-2",
      postgresMajor: Number(catalog.snapshot.database.postgresMajor),
      environment: "rehearsal",
      host: "ep-synthetic-test.c-2.eu-west-2.aws.neon.tech",
      port: 5432,
      database: "neondb",
      role: "migration_owner",
    },
    source: {
      directory: backup.directory,
      database: backup.database,
      manifestSha256: backup.manifestSha256,
      importedAt: backup.source.options.importedAt.toISOString(),
      config: backup.source.options.config,
    },
    catalog: { path: catalogPath, sha256: hash(catalogBytes) },
    migrationsSha256: migrations.sha256,
    artifacts,
  };
  activeReview = review;
  const options: LegacyImportCommandOptions = {
    action: "prepare",
    reviewPath: join(root, "review.json"),
    reviewSha256: "",
    runPath: join(root, "run.json"),
    neonCli: "/synthetic/neon",
    neonProfile: "magickli",
    selectedUrl: `postgresql://migration_owner:${secret}@${review.target.host}/neondb?sslmode=verify-full`,
    projectRoot,
  };
  const writeReview = async () => {
    const bytes = JSON.stringify(review);
    await privateWrite(options.reviewPath, bytes);
    options.reviewSha256 = hash(bytes);
  };
  const readRun = async () =>
    parseLegacyImportValue(
      await readFile(options.runPath, "utf8"),
    ) as LegacyImportCommandRun;
  const alterRun = async (change: (value: LegacyImportCommandRun) => void) => {
    const saved = await readRun();
    change(saved);
    await privateWrite(options.runPath, serializeLegacyImportValue(saved));
  };
  await writeReview();
  return { root, backup, review, options, writeReview, readRun, alterRun };
}

async function refused(
  promise: Promise<unknown>,
  code?: LegacyImportCommandError["code"],
) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LegacyImportCommandError);
  const error = caught as LegacyImportCommandError;
  if (code) expect(error.code).toBe(code);
  expect(error.message).toBe(error.code);
  expect(Reflect.ownKeys(error).sort()).toEqual([
    "code",
    "message",
    "name",
    "receipt",
    "stack",
  ]);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(importSecret);
  return error;
}
function noSql() {
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
}
function fileMethods(
  handle: FileHandle,
  overrides: Partial<FileHandle>,
): FileHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (Object.hasOwn(overrides, property))
        return Reflect.get(overrides, property);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("trusted legacy-import maintenance command", () => {
  it("pins the complete actual local import graph, including re-exports and aliases", async () => {
    const config = ts.readConfigFile(
      join(originalRoot, "tsconfig.json"),
      ts.sys.readFile,
    );
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      originalRoot,
    );
    const pending = [
      "src/migration/legacyImportCommand.ts",
      "scripts/legacy-import.ts",
    ].map((path) => join(originalRoot, path));
    const visited = new Set<string>();
    while (pending.length) {
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      const source = await readFile(path, "utf8");
      for (const imported of ts.preProcessFile(source, true, true)
        .importedFiles) {
        const resolved = ts.resolveModuleName(
          imported.fileName,
          path,
          parsed.options,
          ts.sys,
        ).resolvedModule;
        if (
          !resolved ||
          resolved.isExternalLibraryImport ||
          resolved.resolvedFileName.includes("/node_modules/")
        )
          continue;
        expect(relative(originalRoot, resolved.resolvedFileName)).not.toMatch(
          /^\.\./,
        );
        pending.push(resolved.resolvedFileName);
      }
    }
    expect(visited.size).toBeGreaterThan(25);
    const unpinned = [...visited]
      .map((path) => relative(originalRoot, path))
      .filter(
        (path) => !new Set<string>(LEGACY_IMPORT_REQUIRED_ARTIFACTS).has(path),
      );
    expect(unpinned).toEqual([]);
  });

  it("lets exactly one concurrent initial publication own the saved IDs and SQL preparation", async () => {
    const f = await fixture();
    const both = deferred();
    let publications = 0;
    mocks.beforeLink.mockImplementation(async (_temporary, final) => {
      if (final !== f.options.runPath) return;
      if (++publications === 2) both.resolve();
      await both.promise;
    });
    const results = await Promise.allSettled([run(f.options), run(f.options)]);
    expect(publications).toBe(2);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const loser = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: "STATE_CONFLICT" });
    expect(mocks.prepare).toHaveBeenCalledOnce();
    const saved = await f.readRun();
    expect(sqlState?.runId).toBe(saved.binding.runId);
    const bytes = await readFile(f.options.runPath);
    await rm(f.backup.directory, { recursive: true });
    mocks.beforeLink.mockReset();
    expect((await run(f.options))?.runId).toBe(saved.binding.runId);
    expect(await readFile(f.options.runPath)).toEqual(bytes);
    expect(
      (await readdir(f.root)).filter((name) => name.startsWith(".import-")),
    ).toEqual([]);
  });

  it.each(["before-link", "after-link"] as const)(
    "keeps publication recovery correct for a %s fsync failure",
    async (point) => {
      const f = await fixture();
      mocks.wrapOpen.mockImplementation((path, _flags, handle) => {
        const selected =
          point === "after-link"
            ? path === f.root
            : typeof path === "string" &&
              path.startsWith(join(f.root, ".import-"));
        return selected
          ? fileMethods(handle, {
              sync: async () => {
                throw new Error(secret);
              },
            })
          : handle;
      });
      await refused(run(f.options), "STATE_IO_FAILED");
      noSql();
      expect(
        (await readdir(f.root)).filter((name) => name.startsWith(".import-")),
      ).toEqual([]);
      mocks.wrapOpen.mockReset();
      if (point === "before-link") {
        await expect(lstat(f.options.runPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } else {
        const saved = await f.readRun();
        const bytes = await readFile(f.options.runPath);
        await rm(f.backup.directory, { recursive: true });
        expect((await run(f.options))?.runId).toBe(saved.binding.runId);
        expect(await readFile(f.options.runPath)).toEqual(bytes);
      }
    },
  );

  it("snapshots command options before the first await", async () => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    const original = mocks.execFile.getMockImplementation()!;
    mocks.execFile.mockImplementationOnce((...args) => {
      entered.resolve();
      release.promise.then(() => original(...args));
      return {};
    });
    const originalRunPath = f.options.runPath;
    const operation = run(f.options);
    await entered.promise;
    Object.assign(f.options, {
      action: "apply",
      selectedUrl: secret,
      reviewSha256: "a".repeat(64),
      runPath: join(f.root, "unapproved.json"),
      neonCli: "/unapproved",
      neonProfile: "unapproved",
    });
    release.resolve();
    expect((await operation)?.state).toBe("prepared");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(await readFile(originalRunPath, "utf8")).toContain(
      "magickli-legacy-import-command-run-v1",
    );
    await expect(lstat(f.options.runPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(mocks.execFile.mock.calls.map(([file]) => file)).toEqual(
      Array(6).fill("/synthetic/neon"),
    );
  });

  it("rechecks pinned implementation bytes after provider I/O before any SQL operation", async () => {
    const f = await fixture();
    const original = mocks.execFile.getMockImplementation()!;
    mocks.execFile.mockImplementationOnce((...args) => {
      privateWrite(
        join(f.options.projectRoot, "src/migration/sqlLegacyImport.ts"),
        "changed during provider read",
      ).then(() => original(...args));
      return {};
    });
    await refused(run(f.options), "ARTIFACT_MISMATCH");
    noSql();
    expect((await f.readRun()).binding.runId).toBeTruthy();
  });
  it("durably publishes a private complete checkpoint before SQL preparation", async () => {
    const f = await fixture();
    const realPrepare = mocks.prepare.getMockImplementation()!;
    mocks.prepare.mockImplementation(async (checkpoint) => {
      const saved = await f.readRun();
      expect(saved.checkpoint).toEqual(checkpoint);
      expect(saved.binding).toEqual(sqlContract.binding);
      const stat = await lstat(f.options.runPath);
      expect(stat.mode & 0o777).toBe(0o600);
      expect(stat.nlink).toBe(1);
      expect(
        (await readdir(f.root)).filter((name) => name.startsWith(".import-")),
      ).toEqual([]);
      return realPrepare(checkpoint);
    });
    const receipt = await run(f.options);
    expect(receipt?.state).toBe("prepared");
    const saved = await f.readRun();
    expect(saved.profile).toBe("magickli-legacy-import-command-run-v1");
    expect(saved.reviewSha256).toBe(f.options.reviewSha256);
    const prepared = readLegacyImportCheckpoint(
      saved.checkpoint,
      saved.binding,
    );
    expect(prepared.importedAt).toEqual(f.backup.source.options.importedAt);
    expect(prepared.config).toEqual(f.review.source.config);
    expect(await readFile(f.options.runPath, "utf8")).not.toContain(
      importSecret,
    );
    expect(await readFile(f.options.runPath, "utf8")).not.toContain(secret);
    expect(JSON.stringify(receipt)).not.toContain('payload"');
    expect(mocks.connect).toHaveBeenCalledWith(f.options.selectedUrl, {
      host: f.review.target.host,
      port: 5432,
      database: "neondb",
      role: "migration_owner",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.execFile).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["action", "migrate"],
    ["reviewPath", "relative.json"],
    ["runPath", "/tmp/../run.json"],
    ["neonCli", "/tmp/neon\n"],
    ["projectRoot", "relative"],
    ["reviewSha256", "A".repeat(64)],
    ["neonProfile", "--api-host"],
    ["neonProfile", ""],
    ["neonProfile", "x".repeat(65)],
  ])(
    "refuses invalid option %s=%j before filesystem/provider/SQL effects",
    async (field, value) => {
      const f = await fixture();
      await refused(run({ ...f.options, [field]: value }), "INVALID_INPUT");
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
      noSql();
      await expect(lstat(f.options.runPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it.each(["extra", "missing", "symbol", "getter", "same-path"] as const)(
    "refuses %s option ambiguity without executing accessors",
    async (kind) => {
      const f = await fixture();
      const options = { ...f.options };
      const getter = vi.fn(() => secret);
      if (kind === "extra") Object.assign(options, { unrelated: true });
      if (kind === "missing") Reflect.deleteProperty(options, "action");
      if (kind === "symbol")
        Object.defineProperty(options, Symbol("hidden"), { value: true });
      if (kind === "getter")
        Object.defineProperty(options, "selectedUrl", {
          enumerable: true,
          get: getter,
        });
      if (kind === "same-path") options.runPath = options.reviewPath;
      await refused(run(options), "INVALID_INPUT");
      expect(getter).not.toHaveBeenCalled();
      expect(mocks.connect).not.toHaveBeenCalled();
      noSql();
    },
  );

  it.each(["prepare", "inspect", "apply"] as const)(
    "requires a private owned run directory during %s, including saved-run replay",
    async (action) => {
      const f = await fixture();
      await run(f.options);
      vi.clearAllMocks();
      const bytes = await readFile(f.options.runPath);
      await chmod(f.root, 0o755);
      await refused(run({ ...f.options, action }), "STATE_IO_FAILED");
      expect(await readFile(f.options.runPath)).toEqual(bytes);
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
      noSql();
    },
  );

  it.each(["review", "catalog", "run"] as const)(
    "refuses oversized sparse %s without reading its contents",
    async (kind) => {
      const f = await fixture();
      const path =
        kind === "review"
          ? f.options.reviewPath
          : kind === "catalog"
            ? f.review.catalog.path
            : f.options.runPath;
      const limit =
        ({ review: 1, catalog: 16, run: 64 } as const)[kind] * 1024 * 1024;
      const handle = await open(path, "w", 0o600);
      await handle.truncate(limit + 1);
      await handle.close();
      const reads = vi.fn();
      mocks.wrapOpen.mockImplementation((opened, _flags, file) =>
        opened === path ? fileMethods(file, { read: reads }) : file,
      );
      await refused(run(f.options));
      expect(reads).not.toHaveBeenCalled();
      noSql();
    },
  );

  it.each(["review", "catalog", "run"] as const)(
    "refuses empty %s without treating it as a missing allocation",
    async (kind) => {
      const f = await fixture();
      const path =
        kind === "review"
          ? f.options.reviewPath
          : kind === "catalog"
            ? f.review.catalog.path
            : f.options.runPath;
      await privateWrite(path, "");
      await refused(run(f.options));
      noSql();
      expect((await lstat(path)).size).toBe(0);
      expect(
        (await readdir(f.root)).filter((name) => name.startsWith(".import-")),
      ).toEqual([]);
    },
  );

  it.each(["shape", "snapshot-hash", "engine"] as const)(
    "refuses independently pinned but invalid catalog %s before connecting",
    async (kind) => {
      const f = await fixture();
      const changed = structuredClone(catalog);
      if (kind === "shape") Object.assign(changed, { unreviewed: true });
      if (kind === "snapshot-hash") changed.sha256 = "a".repeat(64);
      if (kind === "engine")
        f.review.target.postgresMajor =
          Number(catalog.snapshot.database.postgresMajor) + 1;
      const bytes = JSON.stringify(changed);
      await privateWrite(f.review.catalog.path, bytes);
      f.review.catalog.sha256 = hash(bytes);
      await f.writeReview();
      await refused(run(f.options), "ARTIFACT_MISMATCH");
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
      noSql();
    },
  );

  it.each(["payload", "configuration", "importedAt"] as const)(
    "refuses changed saved %s even when surrounding run fields still match",
    async (kind) => {
      const f = await fixture();
      await run(f.options);
      vi.clearAllMocks();
      await f.alterRun((saved) => {
        if (kind === "payload") saved.checkpoint.payload += " ";
        else {
          const prepared = readLegacyImportCheckpoint(
            saved.checkpoint,
            saved.binding,
          );
          if (kind === "configuration")
            prepared.config.sourceForumOrigin = "https://other.example";
          else
            prepared.importedAt = new Date(prepared.importedAt.getTime() + 1);
          saved.checkpoint = createLegacyImportCheckpoint(
            prepared,
            saved.binding,
          );
        }
      });
      const bytes = await readFile(f.options.runPath);
      await refused(run(f.options), "STATE_CONFLICT");
      noSql();
      expect(await readFile(f.options.runPath)).toEqual(bytes);
    },
  );

  it("accepts a verified root branch and active read-write endpoint", async () => {
    const f = await fixture();
    f.review.target.parentId = null;
    await f.writeReview();
    providerResponse = (path) => {
      const result = metadata(path);
      if (result.endpoint) result.endpoint.current_state = "active";
      return result;
    };
    expect((await run(f.options))?.state).toBe("prepared");
  });

  it("preserves approved configuration irrespective of review object key order", async () => {
    const f = await fixture();
    f.review.source.config = Object.fromEntries(
      Object.entries(f.review.source.config).reverse(),
    ) as typeof f.review.source.config;
    await f.writeReview();
    expect((await run(f.options))?.state).toBe("prepared");
    expect(
      readLegacyImportCheckpoint(
        (await f.readRun()).checkpoint,
        (await f.readRun()).binding,
      ).config,
    ).toEqual(f.review.source.config);
  });

  it("reuses exact saved IDs for repeated prepare, inspect and apply after the backup is removed", async () => {
    const f = await fixture();
    const first = await run(f.options);
    const bytes = await readFile(f.options.runPath);
    const stat = await lstat(f.options.runPath);
    await rm(f.backup.directory, { recursive: true });
    expect(await run(f.options)).toEqual(first);
    expect(await run({ ...f.options, action: "inspect" })).toEqual(first);
    const completed = await run({ ...f.options, action: "apply" });
    expect(completed?.state).toBe("completed");
    expect(completed?.runId).toBe(first?.runId);
    expect(await readFile(f.options.runPath)).toEqual(bytes);
    const after = await lstat(f.options.runPath);
    expect([after.ino, after.mtimeMs, after.ctimeMs]).toEqual([
      stat.ino,
      stat.mtimeMs,
      stat.ctimeMs,
    ]);
    expect(mocks.apply).toHaveBeenCalledWith(
      (await f.readRun()).checkpoint.payloadSha256,
    );
    expect(mocks.close).toHaveBeenCalledTimes(4);
  });

  it.each(["inspect", "apply"] as const)(
    "requires an existing local run for %s",
    async (action) => {
      const f = await fixture();
      await refused(run({ ...f.options, action }), "STATE_CONFLICT");
      await expect(lstat(f.options.runPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      noSql();
      expect(mocks.close).toHaveBeenCalledOnce();
    },
  );

  it("returns null when inspection finds no SQL checkpoint without allocating or preparing one", async () => {
    const f = await fixture();
    await run(f.options);
    mocks.prepare.mockClear();
    sqlState = null;
    await rm(f.backup.directory, { recursive: true });
    expect(await run({ ...f.options, action: "inspect" })).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each(["prepare", "apply"] as const)(
    "preserves unknown %s outcome and durable IDs for retry",
    async (action) => {
      const f = await fixture();
      if (action === "apply") await run(f.options);
      mocks[action].mockRejectedValueOnce(
        new SqlLegacyImportError("OUTCOME_UNKNOWN"),
      );
      await refused(run({ ...f.options, action }), "OUTCOME_UNKNOWN");
      const bytes = await readFile(f.options.runPath);
      await rm(f.backup.directory, { recursive: true });
      await run({ ...f.options, action });
      expect(await readFile(f.options.runPath)).toEqual(bytes);
    },
  );

  it("verifies both provider snapshots using explicit official hosts and a secret-free environment", async () => {
    const f = await fixture();
    for (const key of [
      "NEON_API_KEY",
      "NEON_API_HOST",
      "NEON_OAUTH_HOST",
      "NEON_PROFILE",
      "NEON_CONFIG_DIR",
      "DATABASE_URL",
      "NODE_OPTIONS",
      "HTTP_PROXY",
      "DEBUG",
    ])
      vi.stubEnv(key, secret);
    await run(f.options);
    for (const [file, args, options] of mocks.execFile.mock.calls) {
      expect(file).toBe(f.options.neonCli);
      expect(args).toEqual(
        expect.arrayContaining([
          "--method",
          "GET",
          "--profile",
          "magickli",
          "--api-host",
          "https://console.neon.tech/api/v2",
          "--oauth-host",
          "https://oauth2.neon.tech",
          "--no-analytics",
        ]),
      );
      expect(args).not.toContain("POST");
      expect(args).not.toContain("DELETE");
      expect(JSON.stringify(options.env)).not.toContain(secret);
      expect(options.cwd).toBe(f.options.projectRoot);
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(30_000);
      expect(options.maxBuffer).toBeLessThanOrEqual(1024 * 1024);
    }
  });

  it.each([
    ["project ID", "project", "id", "another-project"],
    ["project region", "project", "region_id", "aws-us-east-1"],
    ["engine", "project", "pg_version", 99],
    ["branch project", "branch", "project_id", "another-project"],
    ["branch ID", "branch", "id", "br-another"],
    ["actual parent", "branch", "parent_id", "br-another"],
    ["branch readiness", "branch", "current_state", "initializing"],
    ["branch pending", "branch", "pending_state", "ready"],
    ["endpoint ID", "endpoint", "id", "ep-another"],
    ["endpoint project", "endpoint", "project_id", "another-project"],
    ["endpoint branch", "endpoint", "branch_id", "br-another"],
    ["endpoint host", "endpoint", "host", "ep-another.neon.tech"],
    ["endpoint region", "endpoint", "region_id", "aws-us-east-1"],
    ["endpoint type", "endpoint", "type", "read_only"],
    ["endpoint disabled", "endpoint", "disabled", true],
    ["endpoint disabled missing", "endpoint", "disabled", undefined],
    ["endpoint readiness", "endpoint", "current_state", "starting"],
    ["endpoint pending", "endpoint", "pending_state", "active"],
  ])(
    "refuses wrong %s before publishing or SQL",
    async (_label, object, field, value) => {
      const f = await fixture();
      providerResponse = (path) => {
        const result = metadata(path) as unknown as Record<
          string,
          Record<string, unknown>
        >;
        if (result[object]) result[object][field] = value;
        return result;
      };
      await refused(run(f.options), "TARGET_MISMATCH");
      await expect(lstat(f.options.runPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      noSql();
    },
  );

  it("refuses a second-snapshot identity change after publication while preserving the local run", async () => {
    const f = await fixture();
    providerResponse = (path, call) => {
      const result = metadata(path);
      if (call > 3 && result.project)
        result.project.region_id = "aws-us-east-1";
      return result;
    };
    await refused(run(f.options), "TARGET_MISMATCH");
    expect((await f.readRun()).checkpoint.payloadSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    noSql();
    providerResponse = (path) => metadata(path);
    await rm(f.backup.directory, { recursive: true });
    expect((await run(f.options))?.state).toBe("prepared");
  });

  it("projects child errors without raw provider output or credentials", async () => {
    const f = await fixture();
    mocks.execFile.mockImplementationOnce(
      (_file, _args, _options, callback) => {
        callback(
          Object.assign(new Error(secret), {
            stdout: importSecret,
            stderr: secret,
            code: "EFAKE",
          }),
        );
        return {};
      },
    );
    await refused(run(f.options), "PROVIDER_FAILED");
    noSql();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("refuses malformed provider JSON with a safe error", async () => {
    const f = await fixture();
    mocks.execFile.mockImplementationOnce(
      (_file, _args, _options, callback) => {
        callback(null, secret, "");
        return {};
      },
    );
    await refused(run(f.options), "PROVIDER_FAILED");
    noSql();
  });

  it("does not run SQL for a changed independently pinned review file", async () => {
    const f = await fixture();
    await privateWrite(
      f.options.reviewPath,
      `${await readFile(f.options.reviewPath, "utf8")} `,
    );
    await refused(run(f.options), "ARTIFACT_MISMATCH");
    noSql();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    "src/migration/sqlLegacyImport.ts",
    "src/migration/legacyImportRows.ts",
    "src/migration/legacyImportCommand.ts",
    "scripts/legacy-import.ts",
    "drizzle/0004_rituals.sql",
  ])("refuses an omitted critical artifact %s", async (path) => {
    const f = await fixture();
    delete f.review.artifacts[path];
    await f.writeReview();
    await refused(run(f.options), "ARTIFACT_MISMATCH");
    noSql();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    "src/migration/legacyImportCommand.ts",
    "src/migration/sqlLegacyImport.ts",
    "drizzle/0004_rituals.sql",
    "package.json",
  ])("refuses changed reviewed bytes in %s", async (path) => {
    const f = await fixture();
    await privateWrite(join(f.options.projectRoot, path), "changed artifact");
    await refused(run(f.options), "ARTIFACT_MISMATCH");
    noSql();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    "../outside.ts",
    "/absolute.ts",
    "src//file.ts",
    "src/./file.ts",
    "src\\file.ts",
  ])("refuses artifact path escape %s", async (path) => {
    const f = await fixture();
    f.review.artifacts[path] = "a".repeat(64);
    await f.writeReview();
    await refused(run(f.options), "ARTIFACT_MISMATCH");
    noSql();
  });

  it.each(["catalog", "migrations"] as const)(
    "refuses mismatched %s identity",
    async (kind) => {
      const f = await fixture();
      if (kind === "catalog") f.review.catalog.sha256 = "a".repeat(64);
      else f.review.migrationsSha256 = "a".repeat(64);
      await f.writeReview();
      await refused(run(f.options), "ARTIFACT_MISMATCH");
      noSql();
      expect(mocks.connect).not.toHaveBeenCalled();
    },
  );

  it("refuses changed source bytes without publishing a partial run", async () => {
    const f = await fixture();
    await privateWrite(
      join(f.backup.directory, "manifest.json"),
      "changed source",
    );
    await refused(run(f.options));
    noSql();
    await expect(lstat(f.options.runPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["review", "catalog", "run"] as const)(
    "refuses nonprivate %s files",
    async (kind) => {
      const f = await fixture();
      if (kind === "run") {
        await run(f.options);
        vi.clearAllMocks();
      }
      const path =
        kind === "review"
          ? f.options.reviewPath
          : kind === "catalog"
            ? f.review.catalog.path
            : f.options.runPath;
      await chmod(path, 0o644);
      await refused(run(f.options));
      noSql();
    },
  );

  it.each(["review", "catalog", "run"] as const)(
    "refuses symlinked %s files",
    async (kind) => {
      const f = await fixture();
      if (kind === "run") {
        await run(f.options);
        vi.clearAllMocks();
      }
      const path =
        kind === "review"
          ? f.options.reviewPath
          : kind === "catalog"
            ? f.review.catalog.path
            : f.options.runPath;
      const actual = `${path}.actual`;
      await link(path, actual);
      await unlink(path);
      await symlink(actual, path);
      await refused(run(f.options));
      noSql();
    },
  );

  it.each(["review", "run"] as const)(
    "rejects a FIFO %s without waiting for a writer",
    async (kind) => {
      const f = await fixture();
      const path = kind === "review" ? f.options.reviewPath : f.options.runPath;
      if (kind === "review") await unlink(path);
      execFileSync("mkfifo", ["-m", "600", path]);
      await refused(run(f.options));
      noSql();
    },
    3000,
  );

  it.each([
    "profile",
    "reviewSha256",
    "targetSha256",
    "schemaSha256",
    "sourceDescriptorSha256",
    "sourceManifestSha256",
    "source",
  ])("refuses altered saved %s without replacement", async (field) => {
    const f = await fixture();
    await run(f.options);
    vi.clearAllMocks();
    await f.alterRun((saved) => {
      if (field === "profile") saved.profile = "wrong" as typeof saved.profile;
      else if (field === "reviewSha256") saved.reviewSha256 = "a".repeat(64);
      else if (field === "source") saved.source.database = "different";
      else saved.binding[field as "targetSha256"] = "a".repeat(64);
    });
    const bytes = await readFile(f.options.runPath);
    await refused(run(f.options));
    noSql();
    expect(await readFile(f.options.runPath)).toEqual(bytes);
  });

  it("keeps the original failure when connection cleanup also fails", async () => {
    const f = await fixture();
    mocks.prepare.mockRejectedValueOnce(
      new SqlLegacyImportError("OUTCOME_UNKNOWN"),
    );
    mocks.close.mockRejectedValueOnce(new Error(secret));
    await refused(run(f.options), "OUTCOME_UNKNOWN");
    expect(await f.readRun()).toBeTruthy();
  });

  it("reports safe close failure after successful preparation while retaining retry state", async () => {
    const f = await fixture();
    mocks.close.mockRejectedValueOnce(new Error(secret));
    const error = await refused(run(f.options), "CONNECTION_CLOSE_FAILED");
    expect(error.receipt).toEqual(sqlState);
    expect(error.receipt?.state).toBe("prepared");
    expect(await f.readRun()).toBeTruthy();
  });
});
