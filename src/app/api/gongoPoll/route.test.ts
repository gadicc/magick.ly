import { describe, expect, it } from "vitest";

describe("legacy Gongo protocol fence", () => {
  it("never accepts old reads or writes after SQL cutover", async () => {
    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      error: "LEGACY_CLIENT_UPGRADE_REQUIRED",
      recovery: "Open this site in the current app to preserve offline work.",
    });
  });
});
