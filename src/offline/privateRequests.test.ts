// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  clearLegacyPrivateResponses,
  isPrivateRuntimeUrl,
  privateRuntimeCaching,
} from "./privateRequests";

const origin = "https://magickly.example.test";
describe("private service-worker response policy", () => {
  it.each([
    "/api/auth/get-session",
    "/api/session",
    "/api/rituals?rsc=1",
    "/api/files/image.png",
    "/api/gongoPoll",
    "/admin?_rsc=123",
    "/temples/admin/123",
    "/temples/join/example/secret",
    "/doc/018f5555-6666-7777-8888-999999999999",
    "/doc/neophyte/edit",
    "/gd/rituals",
    "/signin?callbackURL=%2Fadmin",
    "/%61dmin",
    "/%61pi/files/image.png",
    "/_next/image?url=%2Fapi%2Ffiles%2Fprivate.png&w=640&q=75",
    "/%",
  ])("bypasses HTTP caches for %s, regardless of response variant", (path) => {
    const url = new URL(path, origin);
    expect(isPrivateRuntimeUrl(url, origin)).toBe(true);
    const [rule] = privateRuntimeCaching(origin);
    expect((rule.matcher as (input: { url: URL }) => boolean)({ url })).toBe(
      true,
    );
    expect(rule.handler.constructor.name).toBe("NetworkOnly");
  });

  it.each([
    "/doc/neophyte",
    "/doc/zelator/",
    "/doc/theoricus?roles=all",
    "/astrology",
    "/api/file2?sha256=abc",
    "/api/render/tree-of-life",
    "/api/treeOfLife",
    "/_next/static/chunk.js",
    "/pics/public.png",
    "/_next/image?url=%2Fpics%2Fpublic.png&w=640&q=75",
  ])("retains the existing public cache policy for %s", (path) => {
    expect(isPrivateRuntimeUrl(new URL(path, origin), origin)).toBe(false);
  });

  it("does not claim unrelated origins", () => {
    expect(
      isPrivateRuntimeUrl(
        new URL("https://another.example.test/admin"),
        origin,
      ),
    ).toBe(false);
  });

  it("removes private entries from known caches while retaining public responses and unrelated caches", async () => {
    const caches = new Map<string, Map<string, Response>>([
      [
        "apis",
        new Map([
          [origin + "/api/session", new Response("private")],
          [origin + "/api/file2?sha256=abc", new Response("legacy image")],
        ]),
      ],
      [
        "pages-rsc-prefetch",
        new Map([
          [origin + "/admin?_rsc=123", new Response("private")],
          [origin + "/astrology", new Response("public")],
        ]),
      ],
      [
        "next-image",
        new Map([
          [
            origin + "/_next/image?url=%2Fapi%2Ffiles%2Fprivate.png",
            new Response("private"),
          ],
        ]),
      ],
      [
        "unrelated-cache",
        new Map([[origin + "/api/session", new Response("not owned")]]),
      ],
    ]);
    const opened: string[] = [];
    const storage = {
      keys: async () => [...caches.keys()],
      open: async (name: string) => {
        opened.push(name);
        const entries = caches.get(name)!;
        return {
          keys: async () => [...entries.keys()].map((url) => new Request(url)),
          delete: async (request: Request) => entries.delete(request.url),
        };
      },
    } as unknown as CacheStorage;
    await clearLegacyPrivateResponses(storage, origin);
    expect([...caches.get("apis")!.keys()]).toEqual([
      origin + "/api/file2?sha256=abc",
    ]);
    expect([...caches.get("pages-rsc-prefetch")!.keys()]).toEqual([
      origin + "/astrology",
    ]);
    expect(caches.get("next-image")!.size).toBe(0);
    expect(opened).not.toContain("unrelated-cache");
    await clearLegacyPrivateResponses(storage, origin);
    expect(caches.get("unrelated-cache")!.size).toBe(1);
  });

  it("does not report cleanup success after CacheStorage fails", async () => {
    const storage = {
      keys: async () => ["apis"],
      open: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    } as unknown as CacheStorage;
    await expect(clearLegacyPrivateResponses(storage, origin)).rejects.toThrow(
      "storage unavailable",
    );
  });
});
