import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVercelBuildEnvironment } from "../node_modules/@gadicc/loom/esm/src/cli/vercelBuildEnv.js";

// Exercise the installed release preparer against the real policy. All pulled
// values/metadata below are synthetic; no app env or provider is consulted.
const readable = {
  BETTER_AUTH_URL: "https://app.example",
  GOOGLE_CLIENT_ID: "synthetic-google-client",
  MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS: "synthetic-policy-v1",
  FILES_STORAGE_PROVIDER: "cloudflare-r2",
  FILES_S3_REGION: "auto",
  FILES_S3_FORCE_PATH_STYLE: "true",
  FILES_S3_ENDPOINT:
    "https://00000000000000000000000000000000.r2.cloudflarestorage.com",
  FILES_S3_BUCKET: "magickli-files-production",
  PINECONE_INDEX_NAME: "synthetic-index",
  PINECONE_NAME_SPACE: "synthetic-namespace",
};
const sensitive = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "FILES_S3_ACCESS_KEY_ID",
  "FILES_S3_SECRET_ACCESS_KEY",
  "OPENAI_API_KEY",
  "PINECONE_API_KEY",
  "DISCOURSE_API_KEY",
];
const directories: string[] = [];

function fixture(omit?: string) {
  const directory = mkdtempSync(join(tmpdir(), "magickli-release-env-test-"));
  directories.push(directory);
  const paths = {
    envFile: join(directory, "synthetic.env"),
    metadataFile: join(directory, "metadata.json"),
    manifestFile: join(directory, "placeholders.json"),
    policyFile: fileURLToPath(
      new URL("../.github/vercel-production-env.json", import.meta.url),
    ),
  };
  writeFileSync(
    paths.envFile,
    Object.entries(readable)
      .filter(([key]) => key !== omit)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
      .join(""),
  );
  writeFileSync(
    paths.metadataFile,
    JSON.stringify({
      envs: [...Object.keys(readable), ...sensitive]
        .filter((key) => key !== omit)
        .map((key) => ({
          key,
          target: ["production"],
          type: sensitive.includes(key) ? "sensitive" : "encrypted",
        })),
    }),
  );
  return paths;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("production environment policy after legacy storage relocation", () => {
  it("prepares a canonical-only release with no retired Mongo/Auth.js/AWS entries", () => {
    const paths = fixture();
    const result = prepareVercelBuildEnvironment(paths, { out: vi.fn() });
    const prepared = parseEnv(readFileSync(paths.envFile, "utf8"));
    expect(prepared).toMatchObject(readable);
    expect(result.placeholders.map(({ key }) => key).sort()).toEqual(
      [...sensitive].sort(),
    );
    expect(Object.keys(prepared).sort()).toEqual(
      [...Object.keys(readable), ...sensitive].sort(),
    );
  });

  it.each([
    ...Object.keys(readable).filter((key) => key.startsWith("FILES_")),
    "FILES_S3_ACCESS_KEY_ID",
    "FILES_S3_SECRET_ACCESS_KEY",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
  ])("still refuses missing canonical %s", (key) => {
    const paths = fixture(key);
    expect(() =>
      prepareVercelBuildEnvironment(paths, { out: vi.fn() }),
    ).toThrow(`Missing Vercel Production variable`);
  });
});
