import { beforeEach, describe, expect, it, vi } from "vitest";
import { trainingAccess } from "./access";

const mocks = vi.hoisted(() => ({ viewer: vi.fn() }));
vi.mock("../../../auth/viewer", () => ({
  getCurrentSqlViewer: mocks.viewer,
}));

beforeEach(() => vi.resetAllMocks());

describe("chat training access", () => {
  it("requires current SQL authentication", async () => {
    mocks.viewer.mockResolvedValue(null);
    await expect(trainingAccess()).resolves.toBe(401);
  });

  it("denies a current non-admin", async () => {
    mocks.viewer.mockResolvedValue({
      user: { id: "01993000-0000-7000-8000-000000000001" },
      admin: false,
    });
    await expect(trainingAccess()).resolves.toBe(403);
  });

  it("accepts only the fresh SQL global-admin projection", async () => {
    mocks.viewer.mockResolvedValue({
      user: { id: "01993000-0000-7000-8000-000000000001" },
      admin: true,
    });
    await expect(trainingAccess()).resolves.toBe(200);
    expect(mocks.viewer).toHaveBeenCalledOnce();
  });
});
