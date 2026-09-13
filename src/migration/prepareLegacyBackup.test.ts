import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { serialize } from "bson";
import { afterEach, describe, expect, it } from "vitest";
import {
  importSecret,
  legacyImportFixture,
} from "../../tests/legacyImportFixtures";
import { serializeLegacyImportValue } from "./legacyImportValue";
import {
  LegacyBackupError,
  type LegacyBackupOptions,
  prepareLegacyBackup as load,
} from "./prepareLegacyBackup";
import { LEGACY_IMPORT_COLLECTIONS } from "./prepareLegacyImport";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(receipts = false) {
  const source = legacyImportFixture();
  const directory = await mkdtemp("/tmp/magickli-backup-loader-test-");
  roots.push(directory);
  const database = "synthetic";
  await mkdir(join(directory, database));
  const files: { path: string; bytes: number; sha256: string }[] = [];
  const add = async (name: string, bytes: Uint8Array) => {
    const path = `${database}/${name}`;
    await writeFile(join(directory, path), bytes);
    files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  };
  for (const name of [
    ...LEGACY_IMPORT_COLLECTIONS,
    ...(receipts ? ["ritualWriteReceipts" as const] : []),
  ]) {
    const rows = name === "ritualWriteReceipts" ? [] : source.input[name];
    await add(
      `${name}.bson.gz`,
      gzipSync(
        Buffer.concat(
          rows.map((row) => serialize(row as Record<string, unknown>)),
        ),
      ),
    );
    await add(
      `${name}.metadata.json.gz`,
      gzipSync(JSON.stringify({ collectionName: name, indexes: [] })),
    );
  }
  await add(
    "prelude.json.gz",
    gzipSync(
      JSON.stringify({ ServerVersion: "synthetic", ToolVersion: "synthetic" }),
    ),
  );
  const manifest: Record<string, unknown> & { files: typeof files } = {
    createdAt: "2026-09-13T00:00:00.000Z",
    source: "synthetic-only",
    database,
    tool: "synthetic",
    mode: "logical",
    files,
    verification: {},
  };
  const options: LegacyBackupOptions = {
    directory,
    expectedDatabase: database,
    expectedManifestSha256: "",
    ...source.options,
  };
  const saveManifest = async () => {
    const bytes = JSON.stringify(manifest);
    await writeFile(join(directory, "manifest.json"), bytes);
    options.expectedManifestSha256 = hash(bytes);
  };
  const replace = async (
    suffix: string,
    bytes: Uint8Array,
    updateManifest = true,
  ) => {
    const file = files.find((entry) => entry.path === `${database}/${suffix}`)!;
    await writeFile(join(directory, file.path), bytes);
    if (updateManifest) {
      file.bytes = bytes.length;
      file.sha256 = hash(bytes);
      await saveManifest();
    }
  };
  await saveManifest();
  return {
    source,
    directory,
    database,
    files,
    manifest,
    options,
    saveManifest,
    replace,
  };
}
async function rejected(
  work: Promise<unknown>,
  code?: LegacyBackupError["code"],
) {
  let caught: unknown;
  try {
    await work;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LegacyBackupError);
  expect((caught as Error).message).not.toContain(importSecret);
  expect((caught as Error).message).not.toContain("/tmp/");
  expect(Reflect.ownKeys(caught as object).sort()).toEqual([
    "code",
    "message",
    "name",
    "stack",
  ]);
  if (code) expect((caught as LegacyBackupError).code).toBe(code);
}
describe("verified logical backup preparation", () => {
  it("verifies source bytes and returns only protected prepared data plus hashed evidence", async () => {
    const f = await fixture();
    const original = await Promise.all(
      f.files.map((file) => readFile(join(f.directory, file.path))),
    );
    const result = await load(f.options);
    expect(result.source.manifestSha256).toBe(f.options.expectedManifestSha256);
    expect(result.source.files).toHaveLength(21);
    expect(result.source.collections).toHaveLength(10);
    expect(result.sourceDescriptorSha256).toBe(
      hash(serializeLegacyImportValue(result.source)),
    );
    expect(result.prepared.auth.users).toHaveLength(2);
    expect(result.prepared.rituals.revisions).toHaveLength(6);
    expect(result.prepared.study.snapshots).toHaveLength(3);
    expect(serializeLegacyImportValue(result)).not.toContain(importSecret);
    expect(
      result.source.collections.find((c) => c.collection === "sessions")?.rows,
    ).toBe(1);
    expect(
      result.source.collections.every((c) =>
        /^[0-9a-f]{64}$/.test(c.frameEvidenceSha256),
      ),
    ).toBe(true);
    expect(
      await Promise.all(
        f.files.map((file) => readFile(join(f.directory, file.path))),
      ),
    ).toEqual(original);
  });
  it("accepts explicit present-empty receipts and default UUID allocation", async () => {
    const f = await fixture(true);
    f.options.config.receiptPolicy = "require-empty-collection";
    delete f.options.generateId;
    const result = await load(f.options);
    expect(result.source.files).toHaveLength(23);
    expect(result.prepared.sourceDispositions.ritualWriteReceipts).toBe(
      "present-empty",
    );
  });
  it("copies source configuration and dates before filesystem awaits", async () => {
    const f = await fixture(),
      at = f.options.importedAt.getTime();
    const pending = load(f.options);
    f.options.importedAt.setTime(0);
    f.options.config.files.sourceBucket = "changed";
    const result = await pending;
    expect(result.prepared.importedAt.getTime()).toBe(at);
    expect(result.prepared.config.files.sourceBucket).toBe("synthetic-legacy");
  });
  it("rejects a changed source after allocation, rather than returning a stale checkpoint", async () => {
    const f = await fixture();
    const generate = f.options.generateId!;
    let changed = false;
    f.options.generateId = () => {
      if (!changed) {
        changed = true;
        writeFileSync(join(f.directory, f.files[0].path), "changed");
      }
      return generate();
    };
    await rejected(load(f.options), "SOURCE_CHANGED");
  });
  it("rejects a changed manifest after allocation", async () => {
    const f = await fixture();
    const generate = f.options.generateId!;
    f.options.generateId = () => {
      writeFileSync(join(f.directory, "manifest.json"), "{}");
      return generate();
    };
    await rejected(load(f.options), "SOURCE_CHANGED");
  });
  it("rejects added files after allocation", async () => {
    const f = await fixture();
    const generate = f.options.generateId!;
    f.options.generateId = () => {
      writeFileSync(join(f.directory, f.database, "extra"), "private");
      return generate();
    };
    await rejected(load(f.options), "SOURCE_CHANGED");
  });
  it("honors cancellation before reads and after pure preparation", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort(importSecret);
    await rejected(
      load({ ...f.options, signal: controller.signal }),
      "CANCELLED",
    );
    const later = new AbortController(),
      generate = f.options.generateId!;
    f.options.generateId = () => {
      later.abort(importSecret);
      return generate();
    };
    await rejected(load({ ...f.options, signal: later.signal }), "CANCELLED");
  });
  it("honors cancellation during asynchronous capture", async () => {
    const f = await fixture(),
      controller = new AbortController();
    const pending = load({ ...f.options, signal: controller.signal });
    setTimeout(() => controller.abort(importSecret), 0);
    await rejected(pending, "CANCELLED");
  });
  it.each([
    "manifestBytes",
    "compressedBytes",
    "inflatedBytes",
    "metadataBytes",
    "rows",
  ] as const)("enforces tightened %s", async (key) => {
    const f = await fixture();
    await rejected(
      load({ ...f.options, limits: { [key]: 1 } }),
      "LIMIT_EXCEEDED",
    );
  });
  it("enforces its elapsed-time deadline", async () => {
    const f = await fixture();
    await rejected(
      load({ ...f.options, limits: { timeoutMs: 1 } }),
      "CANCELLED",
    );
  });
  it.each([0, -1, 1.5, Infinity, "1", 100_001])(
    "refuses invalid/increased row limit %#",
    async (rows) => {
      const f = await fixture();
      await rejected(
        load({ ...f.options, limits: { rows } as never }),
        "INVALID_BACKUP",
      );
    },
  );
  it.each([
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.directory = ".";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.directory += "/..";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.expectedManifestSha256 = "wrong";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.expectedDatabase = "../private";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.expectedDatabase = "..";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.expectedDatabase = "bad\ud800";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.generateId = 1 as never;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.signal = {} as never;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.importedAt = "date" as never;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      (f.options as unknown as Record<string, unknown>).unknown = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.options.limits = { unknown: 1 } as never;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      Object.defineProperty(f.options, "directory", {
        get() {
          throw new Error(importSecret);
        },
        enumerable: true,
      });
    },
  ])("refuses invalid maintenance options %#", async (mutate) => {
    const f = await fixture();
    mutate(f);
    await rejected(load(f.options), "INVALID_BACKUP");
  });
  it.each([
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.manifest.database = "wrong";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.manifest.unknown = true;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.manifest.files = [];
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files[0].path = "../private";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files[0].path = `${f.database}/unknown.bson.gz`;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files[0].bytes = -1;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files[0].sha256 = "wrong";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files.push({ ...f.files[0] });
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files.pop();
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.files.splice(1, 1);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      (f.files[0] as unknown as Record<string, unknown>).extra = true;
    },
  ])("refuses unclassified or incomplete manifests %#", async (mutate) => {
    const f = await fixture();
    mutate(f);
    await f.saveManifest();
    await rejected(load(f.options), "INVALID_BACKUP");
  });
  it.each([
    Buffer.from("not gzip"),
    gzipSync("not BSON"),
    gzipSync(Buffer.from([5, 0, 0, 0, 1])),
  ])("refuses corrupt compressed or BSON input %#", async (bytes) => {
    const f = await fixture();
    await f.replace("users.bson.gz", bytes);
    await rejected(load(f.options), "INVALID_BACKUP");
  });
  it("refuses CRC corruption, invalid metadata/UTF8, changed bytes and unknown files", async () => {
    const f = await fixture();
    const good = await readFile(join(f.directory, f.files[0].path));
    const bad = Buffer.from(good);
    bad[bad.length - 8] ^= 255;
    await f.replace("users.bson.gz", bad);
    await rejected(load(f.options), "INVALID_BACKUP");
    await f.replace("users.bson.gz", good);
    await f.replace("users.metadata.json.gz", gzipSync("[]"));
    await rejected(load(f.options), "INVALID_BACKUP");
    await f.replace("users.metadata.json.gz", gzipSync(Buffer.from([0xff])));
    await rejected(load(f.options), "INVALID_BACKUP");
    await f.replace("users.metadata.json.gz", gzipSync("{}"));
    await f.replace("users.bson.gz", Buffer.from("changed"), false);
    await rejected(load(f.options), "SOURCE_CHANGED");
    await writeFile(join(f.directory, "extra"), "private");
    await rejected(load(f.options), "SOURCE_CHANGED");
  });
  it("refuses symlink files/directories and nonregular source entries", async () => {
    const f = await fixture();
    const path = join(f.directory, f.files[0].path);
    await unlink(path);
    await symlink(join(f.directory, f.files[1].path), path);
    await rejected(load(f.options), "SOURCE_CHANGED");
    await unlink(path);
    await mkdir(path);
    await rejected(load(f.options), "INVALID_BACKUP");
    const linked = f.directory + "-link";
    roots.push(linked);
    await symlink(f.directory, linked);
    await rejected(load({ ...f.options, directory: linked }), "INVALID_BACKUP");
  });
  it("refuses nonempty v1 receipts without invoking migration writes", async () => {
    const f = await fixture(true);
    await f.replace(
      "ritualWriteReceipts.bson.gz",
      gzipSync(serialize({ _id: "old-operation" })),
    );
    await rejected(load(f.options), "INVALID_BACKUP");
  });
  it.each(["manifest.json", "synthetic/users.bson.gz"])(
    "refuses a FIFO at %s without waiting for a writer",
    async (relativePath) => {
      const f = await fixture();
      const path = join(f.directory, relativePath);
      await unlink(path);
      execFileSync("mkfifo", [path]);
      const loading = load(f.options).then(
        () => null,
        (error: unknown) => error,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          loading,
          new Promise<"blocked">((resolve) => {
            timer = setTimeout(() => resolve("blocked"), 500);
          }),
        ]);
        expect(outcome).toBeInstanceOf(LegacyBackupError);
        expect((outcome as LegacyBackupError).code).toBe("INVALID_BACKUP");
      } finally {
        clearTimeout(timer);
        // Also release an old, blocking implementation when this test fails.
        const writer = await open(
          path,
          constants.O_RDWR | constants.O_NONBLOCK,
        );
        try {
          await loading;
        } finally {
          await writer.close();
        }
      }
    },
  );
});
