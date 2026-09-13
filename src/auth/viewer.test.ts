import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { getCurrentSqlViewer } from "./viewer";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn() }));
vi.mock("./session", () => ({ getCurrentSqlSession: mocks.session }));
vi.mock("../db/neonFull", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.access }) }) },
}));

const userId = createUuidV7();
const sessionId = createUuidV7();
const current = {
  user: {
    id: userId,
    name: "Synthetic user",
    image: null,
    admin: true,
  },
  session: { id: sessionId },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(current);
  mocks.access.mockResolvedValue([{ admin: true }]);
});

describe("fresh SQL viewer", () => {
  it("derives global access from SQL and rechecks the same session", async () => {
    await expect(getCurrentSqlViewer()).resolves.toEqual({
      user: { id: userId, name: "Synthetic user", image: null },
      admin: true,
    });
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.access).toHaveBeenCalledTimes(1);
  });

  it("does not query access without a current session", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(getCurrentSqlViewer()).resolves.toBeNull();
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...current, session: { id: createUuidV7() } },
    { ...current, user: { ...current.user, id: createUuidV7() } },
  ])(
    "rejects revocation or account change during the access read",
    async (next) => {
      mocks.session.mockResolvedValueOnce(current).mockResolvedValueOnce(next);
      await expect(getCurrentSqlViewer()).resolves.toBeNull();
    },
  );

  it("propagates SQL failures instead of treating them as anonymous", async () => {
    const failure = new Error("Synthetic SQL unavailable");
    mocks.access.mockRejectedValue(failure);
    await expect(getCurrentSqlViewer()).rejects.toBe(failure);
  });
});
