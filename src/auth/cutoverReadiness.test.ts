import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  completedLegacyImportRun,
  createSqlAuthCutoverReadiness,
  guardSqlAuthHandler,
} from "./cutoverReadiness";

vi.mock("server-only", () => ({}));
vi.mock("../db/neonFull", () => ({ db: {} }));

const digest = "a".repeat(64);
const complete = {
  runId: createUuidV7(),
  slot: 1,
  profile: "magickli-legacy-import-run-v1",
  expectedRowsSha256: digest,
  reconciliationSha256: digest,
  completedAt: new Date("2026-09-13T12:00:00Z"),
};

describe("SQL auth import readiness", () => {
  it("accepts only the exact completed protected singleton", async () => {
    expect(completedLegacyImportRun(complete)).toBe(true);
    await expect(
      createSqlAuthCutoverReadiness(async () => [complete])(),
    ).resolves.toBe(true);
    for (const rows of [
      [],
      [complete, complete],
      [{ ...complete, slot: 2 }],
      [{ ...complete, profile: "other" }],
      [{ ...complete, completedAt: null }],
      [{ ...complete, completedAt: new Date(Number.NaN) }],
      [{ ...complete, expectedRowsSha256: "A".repeat(64) }],
      [{ ...complete, reconciliationSha256: "b".repeat(64) }],
    ])
      await expect(
        createSqlAuthCutoverReadiness(async () => rows)(),
      ).resolves.toBe(false);
  });

  it("fails closed when the readiness read is unavailable", async () => {
    await expect(
      createSqlAuthCutoverReadiness(async () => {
        throw new Error("Synthetic SQL failure");
      })(),
    ).resolves.toBe(false);
  });

  it("does not invoke Better Auth until readiness succeeds", async () => {
    const handler = vi.fn(async () => new Response("accepted"));
    const request = new Request(
      "https://preview.example.test/api/auth/callback/google?bypass=1",
      { method: "POST" },
    );
    const blocked = await guardSqlAuthHandler(
      handler,
      async () => false,
    )(request);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    expect(await blocked.json()).toEqual({ error: "AUTH_CUTOVER_NOT_READY" });
    expect(handler).not.toHaveBeenCalled();

    const accepted = await guardSqlAuthHandler(
      handler,
      async () => true,
    )(request);
    expect(await accepted.text()).toBe("accepted");
    expect(handler).toHaveBeenCalledWith(request);
  });
});
