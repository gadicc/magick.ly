import { webcrypto } from "node:crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPublicRitualShells } from "./publicShells";

const origin = "https://synthetic-public.example";
const canonical = `${origin}/doc/neophyte`;
const manifest = (id = "build-a", asset = "a") => [
  { url: `/_next/static/${id}/_buildManifest.js`, revision: "manifest" },
  { url: `/_next/static/chunks/app-${asset}.js`, revision: null },
];
const html = (id = "build-a", asset = "a", extra = "", deploymentId?: string) =>
  `<html${deploymentId ? ` data-dpl-id="${deploymentId}"` : ""}><script src="/_next/static/chunks/app-${asset}.js${deploymentId ? `?dpl=${deploymentId}` : ""}"></script><script>${JSON.stringify(JSON.stringify({ b: id }))}</script>${extra}</html>`;
function response(url: string, body = html(), headers: HeadersInit = {}) {
  const result = new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "s-maxage=31536000",
      Vary: "rsc, next-router-state-tree, Accept-Encoding",
      ...headers,
    },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function request(
  path = "/doc/neophyte?myRole=hierophant",
  options: RequestInit = {},
) {
  const value = new Request(new URL(path, origin), {
    headers: { Accept: "text/html" },
    ...options,
  });
  Object.defineProperty(value, "mode", { value: "navigate" });
  return value;
}
class MemoryCache {
  entries = new Map<string, { request: Request; response: Response }>();
  async put(request: Request, response: Response) {
    this.entries.set(request.url, {
      request: request.clone(),
      response: response.clone(),
    });
  }
  async match(request: Request) {
    const saved = this.entries.get(request.url);
    if (!saved) return undefined;
    const vary = saved.response.headers.get("vary")?.split(/\s*,\s*/) ?? [];
    if (
      vary.some(
        (header) =>
          saved.request.headers.get(header) !== request.headers.get(header),
      )
    )
      return undefined;
    return saved.response.clone();
  }
}
class FixtureFetchEvent {
  request: Request;
  preloadResponse: Promise<Response | undefined>;
  constructor(request: Request, preload?: Response) {
    this.request = request;
    this.preloadResponse = Promise.resolve(preload);
  }
  waitUntil = vi.fn();
}
let Serwist: typeof import("serwist").Serwist;
const cacheMap = new Map<string, MemoryCache>();
const network = vi.fn();
beforeAll(async () => {
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("location", new URL(origin));
  vi.stubGlobal("FetchEvent", FixtureFetchEvent);
  vi.stubGlobal("ExtendableEvent", FixtureFetchEvent);
  vi.stubGlobal("__WB_DISABLE_DEV_LOGS", true);
  vi.stubGlobal("addEventListener", vi.fn());
  ({ Serwist } = await import("serwist"));
});
beforeEach(() => {
  cacheMap.clear();
  network.mockReset();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", network);
  vi.stubGlobal("caches", {
    async open(name: string) {
      if (!cacheMap.has(name)) cacheMap.set(name, new MemoryCache());
      return cacheMap.get(name);
    },
    async keys() {
      return [...cacheMap.keys()];
    },
    async match(request: Request, options: MultiCacheQueryOptions) {
      return options.cacheName
        ? cacheMap.get(options.cacheName)?.match(request)
        : undefined;
    },
    async delete(name: string) {
      return cacheMap.delete(name);
    },
  });
  network.mockImplementation(async (request: Request) => response(request.url));
});
afterEach(() => vi.restoreAllMocks());
function setup(entries = manifest(), deploymentId?: string) {
  const shells = createPublicRitualShells(entries, origin, deploymentId);
  const sw = new Serwist({
    runtimeCaching: [
      ...shells.runtimeCaching,
      { matcher: () => true, handler: async () => new Response("OTHER ROUTE") },
    ],
  });
  const dispatch = (value: Request, preload?: Response) =>
    sw.handleRequest({
      request: value,
      event: new FixtureFetchEvent(value, preload) as unknown as FetchEvent,
    })!;
  return { ...shells, dispatch };
}

describe("anonymous public ritual shell route through installed Serwist", () => {
  it("warms exactly three query-free anonymous shells and serves a first new query offline", async () => {
    const route = setup();
    await route.warm();
    expect(
      network.mock.calls
        .map(([request]) => new URL(request.url).pathname)
        .sort(),
    ).toEqual(["/doc/neophyte", "/doc/theoricus", "/doc/zelator"]);
    for (const [request] of network.mock.calls) {
      expect(request.credentials).toBe("omit");
      expect(request.redirect).toBe("error");
      expect(request.cache).toBe("no-store");
      expect([...request.headers]).toEqual([["accept", "text/html"]]);
      expect(new URL(request.url).search).toBe("");
    }
    network.mockRejectedValue(new TypeError("OFFLINE"));
    expect(
      await (
        await route.dispatch(
          request(
            "/doc/neophyte?candidateName=Uncached+name&candidateMotto=A%26B#Opening",
          ),
        )
      ).text(),
    ).toBe(html());
    expect(network).toHaveBeenCalledTimes(3);
    const cache = cacheMap.get(await route.cacheName)!;
    expect(cache.entries.size).toBe(3);
    expect([...cache.entries.keys()].every((key) => !new URL(key).search)).toBe(
      true,
    );
  });

  it("never consumes a credentialed navigation preload or old default-cache body", async () => {
    const route = setup();
    const old = new MemoryCache();
    await old.put(
      new Request(canonical),
      response(canonical, "AUTHENTICATED_SENTINEL"),
    );
    cacheMap.set("others", old);
    cacheMap.set("pages", old);
    const eventBody = response(canonical, "AUTHENTICATED_QUERY_PRELOAD");
    const value = await route.dispatch(
      request("/doc/neophyte?candidateName=PRIVATE_QUERY"),
      eventBody,
    );
    expect(await value.text()).toBe(html());
    expect(network).toHaveBeenCalledOnce();
    expect(
      await cacheMap
        .get(await route.cacheName)!
        .entries.get(canonical)!
        .response.clone()
        .text(),
    ).not.toMatch(/AUTHENTICATED|PRIVATE_QUERY/);
  });

  it("leaves direct fetch requests to the existing router", async () => {
    const route = setup();
    const value = await route.dispatch(
      new Request(`${canonical}?candidateName=Fetch`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(await value.text()).toBe("OTHER ROUTE");
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ["/doc/neophyte?unknown=1", {}],
    ["/doc/theoricus?candidateName=X", {}],
    ["/doc/000000000000000000000010?myRole=member", {}],
    ["/doc/01993000-0000-7000-8000-000000000001", {}],
    ["/doc/neophyte/edit", {}],
    ["/doc/neophyte/revisions", {}],
    ["/api/auth/session", {}],
    ["/doc/neophyte?_rsc=abc", {}],
    ["https://elsewhere.example/doc/neophyte", {}],
    ["/doc/neophyte", { method: "POST" }],
    ["/doc/neophyte", { headers: { RSC: "1" } }],
    ["/doc/neophyte", { headers: { "X-Nextjs-Data": "1" } }],
    ["/doc/neophyte", { headers: { "Next-Router-Prefetch": "1" } }],
    ["/doc/neophyte", { headers: { "Next-Router-State-Tree": "[]" } }],
    ["/doc/neophyte", { headers: { Authorization: "SYNTHETIC" } }],
    ["/doc/neophyte", { headers: { Accept: "application/json" } }],
    ["/doc/neophyte", { headers: { Purpose: "prefetch" } }],
  ] as const)("does not canonicalize %s %j", async (path, options) => {
    const route = setup();
    const result = await route.dispatch(request(path, options));
    if ("method" in options && options.method === "POST")
      expect(result).toBeUndefined();
    else expect(await result.text()).toBe("OTHER ROUTE");
    expect(network).not.toHaveBeenCalled();
    expect(cacheMap.size).toBe(0);
  });

  it.each([
    ["private", { "Cache-Control": "private, max-age=60" }],
    ["no-store", { "Cache-Control": "public, no-store" }],
    ["no explicit public policy", { "Cache-Control": "max-age=60" }],
    ["RSC", { "Content-Type": "text/x-component" }],
    ["vary cookie", { Vary: "Cookie" }],
    ["vary authorization", { Vary: "Authorization" }],
    ["vary star", { Vary: "*" }],
  ])("refuses to cache a %s response", async (_name, headers) => {
    network.mockImplementation(async (request: Request) =>
      response(request.url, html(), headers),
    );
    const route = setup();
    await expect(route.dispatch(request())).rejects.toThrow(
      "not explicitly cacheable",
    );
    expect(cacheMap.get(await route.cacheName)!.entries.size).toBe(0);
  });

  it("rejects redirects, login destinations and errors", async () => {
    const route = setup();
    for (const kind of ["redirected", "login", "status"]) {
      network.mockImplementation(async () => {
        const value = response(
          kind === "login" ? `${origin}/login` : canonical,
        );
        Object.defineProperty(
          value,
          kind === "status" ? "status" : "redirected",
          { value: kind === "status" ? 500 : kind === "redirected" },
        );
        return value;
      });
      await expect(route.dispatch(request())).rejects.toThrow(
        "not explicitly cacheable",
      );
    }
  });

  it("separates build identities, rejects foreign build/asset HTML and cleans only obsolete owned caches", async () => {
    const a = setup();
    await a.warm();
    const aName = await a.cacheName;
    const b = setup(manifest("build-b", "b"));
    expect(await b.cacheName).not.toBe(aName);
    await expect(b.dispatch(request())).rejects.toThrow("another build");
    network.mockImplementation(async (request: Request) =>
      response(request.url, html("build-b", "a")),
    );
    await expect(b.dispatch(request())).rejects.toThrow("assets outside");
    network.mockImplementation(async (request: Request) =>
      response(request.url, html("build-b", "b")),
    );
    await b.warm();
    cacheMap.set("private-unrelated", new MemoryCache());
    cacheMap.set("pages", new MemoryCache());
    cacheMap.set("pages-rsc", new MemoryCache());
    cacheMap.set("others", new MemoryCache());
    await b.clearObsolete();
    expect(cacheMap.has(aName)).toBe(false);
    expect(cacheMap.has(await b.cacheName)).toBe(true);
    expect(cacheMap.has("private-unrelated")).toBe(true);
    expect(cacheMap.has("pages")).toBe(false);
    expect(cacheMap.has("pages-rsc")).toBe(true);
    expect(cacheMap.has("others")).toBe(true);
  });

  it("validates Next's deployment marker and associated asset query", async () => {
    const route = setup(manifest(), "deployment-a");
    await expect(route.dispatch(request())).rejects.toThrow(
      "another deployment",
    );
    network.mockImplementation(async (request: Request) =>
      response(request.url, html("ignored-build-id", "a", "", "deployment-a")),
    );
    expect(await (await route.dispatch(request())).text()).toContain(
      'data-dpl-id="deployment-a"',
    );
  });

  it("keeps a failed install refresh from activating without all public shells", async () => {
    const route = setup();
    network.mockRejectedValue(new TypeError("OFFLINE"));
    await expect(route.warm()).rejects.toThrow("OFFLINE");
    expect(cacheMap.get(await route.cacheName)!.entries.size).toBe(0);
  });
});

it("serves safe online HTML if cache writes fail, while installation still requires durable shells", async () => {
  const route = setup();
  const cache = await caches.open(await route.cacheName);
  vi.spyOn(cache, "put").mockRejectedValue(new Error("SYNTHETIC_QUOTA"));
  expect(await (await route.dispatch(request())).text()).toBe(html());
  await expect(route.warm()).rejects.toThrow("SYNTHETIC_QUOTA");
});

describe("exact deployment precache alternatives", () => {
  const asset = "/_next/static/chunks/app-a.js";
  it("serves this deployment's known asset from the real Serwist precache offline", async () => {
    const shells = setup(manifest(), "deployment-a");
    const sw = new Serwist({
      precacheEntries: manifest(),
      precacheOptions: shells.precacheOptions,
    });
    const cache = await caches.open(sw.precacheStrategy.cacheName);
    await cache.put(
      new Request(new URL(asset, origin)),
      new Response("BUILD_A_ASSET"),
    );
    network.mockRejectedValue(new Error("OFFLINE"));
    const value = new Request(new URL(`${asset}?dpl=deployment-a`, origin));
    const result = await sw.handleRequest({
      request: value,
      event: new FixtureFetchEvent(value) as unknown as FetchEvent,
    });
    expect(await result!.text()).toBe("BUILD_A_ASSET");
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    `${asset}?dpl=deployment-b`,
    `${asset}?dpl=deployment-a&theme=private`,
    `${asset}?dpl=deployment-a&dpl=deployment-a`,
    "/_next/static/chunks/unknown.js?dpl=deployment-a",
    "/doc/neophyte?dpl=deployment-a",
    "/api/example?dpl=deployment-a",
    `https://foreign.example${asset}?dpl=deployment-a`,
  ])("does not normalize %s", (path) => {
    const route = setup(manifest(), "deployment-a");
    expect(
      route.precacheOptions.urlManipulation!({ url: new URL(path, origin) }),
    ).toEqual([]);
  });
});

it("refuses missing or ambiguous build manifests before any shell fetch", () => {
  expect(() => createPublicRitualShells([], origin)).toThrow(
    "unique Next precache build identity",
  );
  expect(() =>
    createPublicRitualShells([...manifest("a"), ...manifest("b")], origin),
  ).toThrow("unique Next precache build identity");
  expect(network).not.toHaveBeenCalled();
  expect(cacheMap.size).toBe(0);
});

it("keeps online navigation available when cache storage cannot open, but refuses install", async () => {
  const route = setup();
  vi.spyOn(caches, "open").mockRejectedValue(
    new Error("SYNTHETIC_STORAGE_UNAVAILABLE"),
  );
  expect(await (await route.dispatch(request())).text()).toBe(html());
  expect(network).toHaveBeenCalledOnce();
  await expect(route.warm()).rejects.toThrow("SYNTHETIC_STORAGE_UNAVAILABLE");
  expect(network).toHaveBeenCalledOnce();
});

it("shares a pending canonical fetch between simultaneous query navigations", async () => {
  const route = setup();
  let resolve!: (response: Response) => void;
  network.mockImplementation(
    () =>
      new Promise<Response>((yes) => {
        resolve = yes;
      }),
  );
  const first = route.dispatch(request("/doc/neophyte?candidateMotto=First"));
  const second = route.dispatch(request("/doc/neophyte?candidateMotto=Second"));
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
  resolve(response(canonical));
  expect(await (await first).text()).toBe(html());
  expect(await (await second).text()).toBe(html());
  expect(network).toHaveBeenCalledOnce();
});
