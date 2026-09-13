import { describe, expect, it, vi } from "vitest";
import { GET, POST, runtime } from "./route";

const mocks = vi.hoisted(() => ({
  auth: { handler: vi.fn() },
  get: vi.fn(async () => new Response("get")),
  post: vi.fn(async () => new Response("post")),
  toNext: vi.fn(),
  guardedCalls: 0,
  guard: vi.fn(
    (handler: (request: Request) => Promise<Response>) =>
      async (request: Request) => {
        mocks.guardedCalls++;
        return handler(request);
      },
  ),
}));
vi.mock("@/auth/runtime", () => ({ sqlAuth: mocks.auth }));
vi.mock("@/auth/cutoverReadiness", () => ({
  guardSqlAuthHandler: mocks.guard,
}));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: mocks.toNext.mockReturnValue({
    GET: mocks.get,
    POST: mocks.post,
  }),
}));

describe("Better Auth route", () => {
  it("exposes the SQL auth handler at the existing /api/auth catch-all", async () => {
    expect(runtime).toBe("nodejs");
    const get = new Request("https://example.test/api/auth/get-session");
    const post = new Request("https://example.test/api/auth/sign-out", {
      method: "POST",
    });
    await GET(get);
    await POST(post);
    expect(mocks.guardedCalls).toBe(2);
    expect(mocks.get).toHaveBeenCalledWith(get);
    expect(mocks.post).toHaveBeenCalledWith(post);
  });
});
