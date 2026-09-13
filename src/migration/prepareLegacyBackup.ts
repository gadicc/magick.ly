import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { decodeLegacyBson } from "./decodeLegacyBson";
import {
  parseLegacyImportValue,
  serializeLegacyImportValue,
} from "./legacyImportValue";
import {
  LEGACY_IMPORT_COLLECTIONS,
  type LegacyImportCollections,
  type LegacyImportConfigV1,
  prepareLegacyImport,
} from "./prepareLegacyImport";

export const LEGACY_BACKUP_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024,
  compressedBytes: 64 * 1024 * 1024,
  inflatedBytes: 256 * 1024 * 1024,
  metadataBytes: 1024 * 1024,
  rows: 100_000,
  timeoutMs: 30_000,
});
type Limits = { -readonly [K in keyof typeof LEGACY_BACKUP_LIMITS]: number };
type Collection =
  | (typeof LEGACY_IMPORT_COLLECTIONS)[number]
  | "ritualWriteReceipts";
type File = {
  path: string;
  bytes: number;
  sha256: string;
  collection: Collection | null;
  kind: "bson" | "metadata" | "prelude";
};

/** A maintenance input: explicit reviewed source, never newest-directory discovery. */
export interface LegacyBackupOptions {
  directory: string;
  expectedManifestSha256: string;
  expectedDatabase: string;
  importedAt: Date;
  config: LegacyImportConfigV1;
  generateId?: () => string;
  signal?: AbortSignal;
  /** Tests/operators may tighten these bounds, never increase the supported profile. */
  limits?: Partial<Limits>;
}

/** No manifest prose, original user/session rows or provider secrets are retained. */
export interface LegacyBackupDescriptor {
  profile: "magickli-verified-backup-v1";
  manifestSha256: string;
  database: string;
  files: Omit<File, "path">[];
  collections: {
    collection: Collection;
    rows: number;
    inflatedSha256: string;
    frameEvidenceSha256: string;
  }[];
}

/** Fixed categories prevent filesystem/BSON diagnostics exposing private paths or data. */
export class LegacyBackupError extends Error {
  constructor(
    public readonly code:
      | "INVALID_BACKUP"
      | "SOURCE_CHANGED"
      | "CANCELLED"
      | "LIMIT_EXCEEDED",
  ) {
    super(code);
    this.name = "LegacyBackupError";
  }
}
function fail(code: LegacyBackupError["code"] = "INVALID_BACKUP"): never {
  throw new LegacyBackupError(code);
}
function object(
  value: unknown,
  names?: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  if (Object.getOwnPropertySymbols(value).length) fail();
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  ))
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      (names && !names.includes(key))
    )
      fail();
  return value as Record<string, unknown>;
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: Uint8Array): unknown =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value),
  );

/**
 * Verify a pinned logical dump, run only the pure builder, then reverify every
 * source byte before returning a prepared plan. No database, environment loading,
 * provider calls or restore/index execution occur here. The only injected
 * function is the optional ID allocator used by the pure builder.
 */
export async function prepareLegacyBackup(options: LegacyBackupOptions) {
  let cancelled = () => false;
  try {
    object(options, [
      "directory",
      "expectedManifestSha256",
      "expectedDatabase",
      "importedAt",
      "config",
      "generateId",
      "signal",
      "limits",
    ]);
    const {
      directory,
      expectedManifestSha256,
      expectedDatabase,
      generateId,
      signal,
    } = options;
    if (
      typeof directory !== "string" ||
      !isAbsolute(directory) ||
      directory !== resolve(directory) ||
      typeof expectedManifestSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(expectedManifestSha256) ||
      typeof expectedDatabase !== "string" ||
      !expectedDatabase.length ||
      !expectedDatabase.isWellFormed() ||
      /[/\\\0]/.test(expectedDatabase) ||
      [".", ".."].includes(expectedDatabase) ||
      (generateId !== undefined && typeof generateId !== "function") ||
      (signal !== undefined && !(signal instanceof AbortSignal))
    )
      fail();
    const limits = { ...LEGACY_BACKUP_LIMITS } as Limits;
    if (options.limits !== undefined)
      for (const [key, value] of Object.entries(
        object(options.limits, Object.keys(limits)),
      )) {
        if (
          !Number.isSafeInteger(value) ||
          (value as number) < 1 ||
          (value as number) > limits[key as keyof Limits]
        )
          fail();
        limits[key as keyof Limits] = value as number;
      }
    const copied = parseLegacyImportValue(
      serializeLegacyImportValue({
        config: options.config,
        importedAt: options.importedAt,
      }),
    ) as Pick<LegacyBackupOptions, "config" | "importedAt">;
    if (!(copied.importedAt instanceof Date)) fail();
    const deadline = performance.now() + limits.timeoutMs;
    const stop = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(limits.timeoutMs),
    ]);
    cancelled = () => stop.aborted || performance.now() >= deadline;
    function active() {
      if (cancelled()) fail("CANCELLED");
    }
    async function regular(
      path: string,
      maximum: number,
      expectedBytes?: number,
    ): Promise<Buffer> {
      active();
      const handle = await open(
        path,
        // A FIFO must reach fstat without waiting for a writer. Checking the
        // path first cannot prevent it being swapped before this open.
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let bytes: Buffer | undefined;
      try {
        active();
        const before = await handle.stat();
        if (
          !before.isFile() ||
          !Number.isSafeInteger(before.size) ||
          before.size < 0
        )
          fail();
        if (before.size > maximum) fail("LIMIT_EXCEEDED");
        if (expectedBytes !== undefined && before.size !== expectedBytes)
          fail("SOURCE_CHANGED");
        bytes = Buffer.alloc(before.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          active();
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            Math.min(1024 * 1024, bytes.length - offset),
            offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        active();
        const after = await handle.stat();
        if (
          offset !== before.size ||
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          after.ino !== before.ino ||
          after.dev !== before.dev
        )
          fail("SOURCE_CHANGED");
        const owned = bytes.subarray(0, offset);
        bytes = undefined;
        return owned;
      } finally {
        bytes?.fill(0);
        await handle.close();
      }
    }
    async function directoryEntries(path: string, expected: readonly string[]) {
      active();
      const stat = await lstat(path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(path)) !== path
      )
        fail();
      const entries = await readdir(path, { withFileTypes: true });
      if (
        entries.length !== expected.length ||
        entries.some(
          (entry) => !expected.includes(entry.name) || entry.isSymbolicLink(),
        )
      )
        fail("SOURCE_CHANGED");
    }
    await directoryEntries(directory, ["manifest.json", expectedDatabase]);
    const manifestBytes = await regular(
      join(directory, "manifest.json"),
      limits.manifestBytes,
    );
    let files: File[];
    try {
      if (hash(manifestBytes) !== expectedManifestSha256)
        fail("SOURCE_CHANGED");
      const manifest = object(json(manifestBytes), [
        "createdAt",
        "source",
        "database",
        "tool",
        "mode",
        "files",
        "verification",
      ]);
      if (
        manifest.database !== expectedDatabase ||
        !Array.isArray(manifest.files)
      )
        fail();
      const known = [
        ...LEGACY_IMPORT_COLLECTIONS,
        "ritualWriteReceipts",
      ] as const;
      const paths = new Set<string>();
      let compressed = 0;
      files = manifest.files.map((value) => {
        const row = object(value, ["path", "bytes", "sha256"]);
        if (
          typeof row.path !== "string" ||
          !Number.isSafeInteger(row.bytes) ||
          (row.bytes as number) < 0 ||
          typeof row.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(row.sha256)
        )
          fail();
        const path = row.path,
          bytes = row.bytes as number,
          sha256 = row.sha256;
        if (paths.has(path)) fail();
        paths.add(path);
        compressed += bytes;
        if (compressed > limits.compressedBytes) fail("LIMIT_EXCEEDED");
        if (path === `${expectedDatabase}/prelude.json.gz`)
          return { path, bytes, sha256, collection: null, kind: "prelude" };
        for (const collection of known) {
          if (path === `${expectedDatabase}/${collection}.bson.gz`)
            return { path, bytes, sha256, collection, kind: "bson" };
          if (path === `${expectedDatabase}/${collection}.metadata.json.gz`)
            return { path, bytes, sha256, collection, kind: "metadata" };
        }
        return fail();
      });
      const hasReceipts = files.some(
        (file) => file.collection === "ritualWriteReceipts",
      );
      const expected = [
        ...LEGACY_IMPORT_COLLECTIONS,
        ...(hasReceipts ? ["ritualWriteReceipts"] : []),
      ];
      if (
        files.length !== expected.length * 2 + 1 ||
        !paths.has(`${expectedDatabase}/prelude.json.gz`) ||
        expected.some(
          (name) =>
            !paths.has(`${expectedDatabase}/${name}.bson.gz`) ||
            !paths.has(`${expectedDatabase}/${name}.metadata.json.gz`),
        )
      )
        fail();
    } finally {
      manifestBytes.fill(0);
    }
    const names = files.map((file) =>
      file.path.slice(expectedDatabase.length + 1),
    );
    const dataDirectory = join(directory, expectedDatabase);
    await directoryEntries(dataDirectory, names);
    const source: LegacyBackupDescriptor = {
      profile: "magickli-verified-backup-v1",
      manifestSha256: expectedManifestSha256,
      database: expectedDatabase,
      files: files.map(({ path: _, ...file }) => file),
      collections: [],
    };
    const collections = {} as LegacyImportCollections;
    let inflated = 0,
      rows = 0;
    for (const file of files) {
      const compressed = await regular(
        join(directory, file.path),
        limits.compressedBytes,
        file.bytes,
      );
      let unpacked: Buffer | undefined;
      const chunks: Buffer[] = [];
      try {
        if (hash(compressed) !== file.sha256) fail("SOURCE_CHANGED");
        let length = 0;
        const maximum = Math.min(
          limits.inflatedBytes - inflated,
          file.kind === "bson" ? limits.inflatedBytes : limits.metadataBytes,
        );
        await pipeline(
          Readable.from([compressed]),
          createGunzip(),
          async (stream) => {
            for await (const chunk of stream) {
              active();
              length += chunk.length;
              if (length > maximum) {
                chunk.fill(0);
                fail("LIMIT_EXCEEDED");
              }
              chunks.push(chunk);
            }
          },
          { signal: stop },
        );
        active();
        unpacked = Buffer.concat(chunks, length);
        inflated += length;
        if (file.kind === "bson") {
          const decoded = decodeLegacyBson(unpacked);
          rows += decoded.rows.length;
          if (rows > limits.rows) fail("LIMIT_EXCEEDED");
          collections[file.collection!] = decoded.rows;
          source.collections.push({
            collection: file.collection!,
            rows: decoded.rows.length,
            inflatedSha256: decoded.sha256,
            frameEvidenceSha256: hash(JSON.stringify(decoded.frames)),
          });
        } else object(json(unpacked));
      } finally {
        compressed.fill(0);
        unpacked?.fill(0);
        for (const chunk of chunks) chunk.fill(0);
      }
    }
    active();
    const prepared = prepareLegacyImport(collections, {
      ...copied,
      ...(generateId ? { generateId } : {}),
    });
    active();
    await directoryEntries(directory, ["manifest.json", expectedDatabase]);
    await directoryEntries(dataDirectory, names);
    const currentManifest = await regular(
      join(directory, "manifest.json"),
      limits.manifestBytes,
    );
    try {
      if (hash(currentManifest) !== expectedManifestSha256)
        fail("SOURCE_CHANGED");
    } finally {
      currentManifest.fill(0);
    }
    for (const file of files) {
      const bytes = await regular(
        join(directory, file.path),
        limits.compressedBytes,
        file.bytes,
      );
      try {
        if (hash(bytes) !== file.sha256) fail("SOURCE_CHANGED");
      } finally {
        bytes.fill(0);
      }
    }
    active();
    return {
      source,
      sourceDescriptorSha256: hash(serializeLegacyImportValue(source)),
      prepared,
    };
  } catch (error) {
    if (cancelled()) return fail("CANCELLED");
    if (error instanceof LegacyBackupError)
      throw new LegacyBackupError(error.code);
    return fail();
  }
}
