import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../../../lib/ids";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn() }));
vi.mock("@/auth/session", () => ({ getCurrentSqlSession: mocks.session }));
vi.mock("@/db/neonFull", () => ({
  db: { select: () => ({ from: () => ({ where: mocks.access }) }) },
}));
const userId = createUuidV7(),
  sessionId = createUuidV7();
const current = {
  user: {
    id: userId,
    name: "Synthetic user",
    image: null,
    email: "private@example.test",
  },
  session: { id: sessionId, token: "must-not-reach-browser" },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(current);
  mocks.access.mockResolvedValue([{ admin: true }]);
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
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
  it("refuses expired or signed-out sessions without querying access", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ user: null, admin: false });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("never assigns administrator access from the auth profile", async () => {
    mocks.session.mockResolvedValue({
      ...current,
      user: { ...current.user, admin: true },
    });
    mocks.access.mockResolvedValue([]);
    expect(await (await GET()).json()).toMatchObject({ admin: false });
  });
  it.each([
    null,
    { ...current, session: { id: createUuidV7() } },
    { ...current, user: { ...current.user, id: createUuidV7() } },
  ])(
    "rejects revocation or account/session changes during the access read",
    async (rechecked) => {
      mocks.session
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(rechecked);
      expect((await GET()).status).toBe(401);
    },
  );
  it("hides SQL/provider diagnostics and retains no-store on failures", async () => {
    mocks.access.mockRejectedValue(new Error("sensitive SQL/token payload"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "SESSION_UNAVAILABLE" });
  });
});
