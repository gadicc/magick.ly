import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../auth/session", () => ({
  getCurrentSqlUserId: vi.fn(async () => null),
}));
vi.mock("../db/neonFull", () => ({ db: {} }));

import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { createSqlRitualRuntime } from "./sqlRitualRuntime";

const dependencies = {
  db: {} as SqlRitualReadDatabase,
  getVerifiedActorId: async () => null,
};

const configured = {
  MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS: '["private-v1"]',
  FILES_STORAGE_PROVIDER: "cloudflare-r2",
  FILES_S3_REGION: "auto",
  FILES_S3_FORCE_PATH_STYLE: "true",
  FILES_S3_ENDPOINT:
    "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  FILES_S3_BUCKET: "synthetic-private",
  FILES_S3_ACCESS_KEY_ID: "synthetic-access",
  FILES_S3_SECRET_ACCESS_KEY: "synthetic-secret",
};
const localMinio = {
  ...configured,
  NODE_ENV: "production",
  MAGICKLI_LOCAL_ACCEPTANCE: "1",
  BETTER_AUTH_URL: "http://127.0.0.1:3115",
  DATABASE_URL:
    "postgresql://local:synthetic@127.0.0.1:5432/magickli_acceptance_20260914",
  FILES_STORAGE_PROVIDER: "minio",
  FILES_S3_ENDPOINT: "http://127.0.0.1:9125",
  FILES_S3_BUCKET: "magickli-local-acceptance",
};

describe("SQL ritual runtime composition", () => {
  it("stays unavailable without explicit policy and private storage settings", () => {
    const runtime = createSqlRitualRuntime({}, dependencies);
    expect(runtime.publicationPoliciesConfigured).toBe(false);
    expect(runtime.storageConfigured).toBe(false);
  });

  it("accepts a complete locally validated configuration without provider I/O", () => {
    const runtime = createSqlRitualRuntime(configured, dependencies);
    expect(runtime.publicationPoliciesConfigured).toBe(true);
    expect(runtime.storageConfigured).toBe(true);
  });

  it("accepts explicit loopback MinIO without provider I/O", () => {
    const runtime = createSqlRitualRuntime(localMinio, dependencies);
    expect(runtime.publicationPoliciesConfigured).toBe(true);
    expect(runtime.storageConfigured).toBe(true);
  });

  it.each([
    { ...localMinio, VERCEL: "1" },
    {
      ...localMinio,
      DATABASE_URL_UNPOOLED: "postgresql://remote.example:5432/magickli",
    },
  ])("keeps unsafe local storage unavailable", (environment) => {
    const runtime = createSqlRitualRuntime(environment, dependencies);
    expect(runtime.publicationPoliciesConfigured).toBe(true);
    expect(runtime.storageConfigured).toBe(false);
  });

  it.each([
    {
      ...configured,
      MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS: '["INVALID POLICY"]',
    },
    {
      ...configured,
      MAGICKLI_RITUAL_BUNDLE_PUBLICATION_POLICY_IDS: "not-json",
    },
  ])(
    "rejects malformed policy input independently of storage",
    (environment) => {
      const runtime = createSqlRitualRuntime(environment, dependencies);
      expect(runtime.publicationPoliciesConfigured).toBe(false);
      expect(runtime.storageConfigured).toBe(true);
    },
  );

  it.each([
    { ...configured, FILES_STORAGE_PROVIDER: "r2" },
    { ...configured, FILES_S3_REGION: "us-east-1" },
    { ...configured, FILES_S3_FORCE_PATH_STYLE: "false" },
  ])(
    "rejects noncanonical Cloudflare file storage without weakening SQL policy",
    (environment) => {
      const runtime = createSqlRitualRuntime(environment, dependencies);
      expect(runtime.publicationPoliciesConfigured).toBe(true);
      expect(runtime.storageConfigured).toBe(false);
    },
  );
});
