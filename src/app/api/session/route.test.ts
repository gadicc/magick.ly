import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../../../lib/ids";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ viewer: vi.fn() }));
vi.mock("@/auth/viewer", () => ({ getCurrentSqlViewer: mocks.viewer }));
const userId = createUuidV7();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({
    user: { id: userId, name: "Synthetic user", image: null },
    admin: true,
  });
});
describe("fresh browser identity endpoint", () => {
  it("returns only identity/display fields and current global access", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(await response.json()).toEqual({
      user: { id: userId, name: "Synthetic user", image: null },
      admin: true,
    });
    expect(mocks.viewer).toHaveBeenCalledTimes(1);
  });
  it("refuses expired or signed-out sessions without querying access", async () => {
    mocks.viewer.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ user: null, admin: false });
    expect(mocks.viewer).toHaveBeenCalledTimes(1);
  });
  it("never assigns administrator access from the auth profile", async () => {
    mocks.viewer.mockResolvedValue({
      user: { id: userId, name: "Synthetic user", image: null, admin: true },
      admin: false,
    });
    expect(await (await GET()).json()).toMatchObject({ admin: false });
  });
  it("hides SQL/provider diagnostics and retains no-store on failures", async () => {
    mocks.viewer.mockRejectedValue(new Error("sensitive SQL/token payload"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "SESSION_UNAVAILABLE" });
  });
});
