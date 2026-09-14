import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_ACCEPTANCE_DATABASE,
  LOCAL_ACCEPTANCE_ORIGIN,
  LOCAL_ACCEPTANCE_ROLE,
  prepareLocalAcceptanceOutput,
  readLocalAcceptanceConfig,
} from "./config";

const environment = {
  DATABASE_URL_UNPOOLED: `postgresql://${LOCAL_ACCEPTANCE_ROLE}:synthetic-password@127.0.0.1:5432/${LOCAL_ACCEPTANCE_DATABASE}`,
  DATABASE_URL: `postgresql://${LOCAL_ACCEPTANCE_ROLE}:synthetic-password@127.0.0.1:5432/${LOCAL_ACCEPTANCE_DATABASE}`,
  BETTER_AUTH_URL: LOCAL_ACCEPTANCE_ORIGIN,
  BETTER_AUTH_SECRET:
    "synthetic-local-secret-with-more-than-thirty-two-characters",
};

describe("local acceptance target guard", () => {
  it("accepts only the exact private ignored output and loopback target", () => {
    const config = readLocalAcceptanceConfig(
      {
        ...environment,
        DATABASE_URL_DIRECT: environment.DATABASE_URL_UNPOOLED,
        POSTGRES_URL_NON_POOLING: environment.DATABASE_URL_UNPOOLED,
        MAGICKLI_LOCAL_ACCEPTANCE_OUTPUT: "../ignored-override",
      },
      "/synthetic/repo",
    );
    expect(config).toMatchObject({
      origin: LOCAL_ACCEPTANCE_ORIGIN,
      outputDirectory:
        "/synthetic/repo/output/playwright/local-acceptance/auth",
    });
    expect(
      JSON.stringify({
        ...config,
        databaseUrl: "",
        authSecret: "",
      }),
    ).not.toContain("synthetic-password");
  });

  it.each([
    { DATABASE_URL_UNPOOLED: "postgresql://role:pass@db.example.test/db" },
    {
      DATABASE_URL_UNPOOLED:
        "postgresql://other:pass@127.0.0.1:5432/magickli_acceptance_20260914",
    },
    {
      DATABASE_URL_UNPOOLED:
        "postgresql://magickli_acceptance_20260914:pass@127.0.0.1:5432/other",
    },
    { DATABASE_URL: "postgresql://role:pass@127.0.0.1:5432/other" },
    {
      DATABASE_URL:
        "postgresql://magickli_acceptance_20260914:different@127.0.0.1:5432/magickli_acceptance_20260914",
    },
    {
      DATABASE_URL_DIRECT:
        "postgresql://magickli_acceptance_20260914:different@127.0.0.1:5432/magickli_acceptance_20260914",
    },
    {
      POSTGRES_URL_NON_POOLING:
        "postgresql://magickli_acceptance_20260914:synthetic-password@127.0.0.1:5432/other",
    },
    { BETTER_AUTH_URL: "http://localhost:3115" },
    { BETTER_AUTH_SECRET: "short" },
    { VERCEL_ENV: "preview" },
  ])("refuses target or output drift %#", (patch) => {
    expect(() =>
      readLocalAcceptanceConfig(
        { ...environment, ...patch },
        "/synthetic/repo",
      ),
    ).toThrow(/LOCAL_ACCEPTANCE_/);
  });

  it("rejects a symlinked output boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "magickli-acceptance-"));
    await mkdir(path.join(root, "output"));
    await symlink(os.tmpdir(), path.join(root, "output", "playwright"));
    const config = readLocalAcceptanceConfig(environment, root);
    await expect(prepareLocalAcceptanceOutput(config, root)).rejects.toThrow(
      "LOCAL_ACCEPTANCE_OUTPUT_INVALID",
    );
  });
});
