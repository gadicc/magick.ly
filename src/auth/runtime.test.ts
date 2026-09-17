import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../db/neonFull", () => ({
  db: {
    transaction: vi.fn(() => {
      throw new Error("Unexpected SQL");
    }),
  },
}));

const configured = {
  BETTER_AUTH_URL: "http://localhost:3004",
  // Loom prefers a shell's versioned secrets over the single secret below.
  BETTER_AUTH_SECRETS: undefined,
  BETTER_AUTH_SECRET: "synthetic-auth-test-secret-over-thirty-two-characters",
  GOOGLE_CLIENT_ID: "synthetic-client",
  GOOGLE_CLIENT_SECRET: "synthetic-secret",
};

// The runtime reads the environment once, while its module evaluates.
function loadRuntime(environment: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(environment))
    vi.stubEnv(name, value);
  return import("./runtime");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SQL auth runtime", () => {
  it("uses the configured deployment origin", async () => {
    const { sqlAuth } = await loadRuntime(configured);
    const context = await sqlAuth.$context;
    expect(context.options.baseURL).toBe("http://localhost:3004");
  });

  it.each(["BETTER_AUTH_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])(
    "names %s when it is unset or blank",
    async (name) => {
      for (const value of [undefined, "", "  "]) {
        vi.resetModules();
        await expect(
          loadRuntime({ ...configured, [name]: value }),
        ).rejects.toThrow(`Missing SQL auth setting. Set ${name}.`);
      }
    },
  );

  it("still rejects a malformed origin", async () => {
    await expect(
      loadRuntime({ ...configured, BETTER_AUTH_URL: "localhost:3004" }),
    ).rejects.toThrow("Invalid SQL auth origin");
  });
});
