import { beforeEach, describe, expect, it, vi } from "vitest";
import { trainingAccess } from "./access";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findOne: vi.fn() }));
vi.mock("../../../auth", () => ({ auth: mocks.auth }));
vi.mock("../../../api-lib/db", async () => ({
  ObjectId: (await import("bson")).ObjectId,
  db: { collection: () => ({ findOne: mocks.findOne }) },
}));

beforeEach(() => vi.resetAllMocks());

describe("chat training access", () => {
  it("requires authentication before looking up privileges", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(trainingAccess()).resolves.toBe(401);
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("denies invalid legacy user IDs", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "invalid" } });
    await expect(trainingAccess()).resolves.toBe(403);
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("reads the current server-side global admin flag", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011" } });
    mocks.findOne.mockResolvedValue({ admin: true });
    await expect(trainingAccess()).resolves.toBe(200);
    expect(mocks.findOne.mock.calls[0][0]._id.toHexString()).toBe(
      "507f1f77bcf86cd799439011",
    );
  });

  it.each([null, {}, { admin: false }])(
    "denies non-admin/deleted users even if the session has an admin flag",
    async (user) => {
      mocks.auth.mockResolvedValue({
        user: { id: "507f1f77bcf86cd799439011", admin: true },
      });
      mocks.findOne.mockResolvedValue(user);
      await expect(trainingAccess()).resolves.toBe(403);
    },
  );
});
