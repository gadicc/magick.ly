import { NetworkOnly, type RuntimeCaching } from "serwist";
import { isPublicRitualId } from "../doc/publicRituals";
import { isUuidV7 } from "../lib/ids";

/** Every response variant of these paths is private, including RSC prefetches. */
export function isPrivateRuntimeUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return true;
  }
  if (path === "/_next/image") {
    const source = url.searchParams.get("url");
    if (!source) return false;
    try {
      const target = new URL(source, origin);
      // Nested optimizer requests are not a supported private image transport.
      return (
        decodeURIComponent(target.pathname) === "/_next/image" ||
        isPrivateRuntimeUrl(target, origin)
      );
    } catch {
      return true;
    }
  }
  if (path.startsWith("/api/")) {
    // Existing content-addressed public images and whitelisted component renders
    // are the only API responses eligible for the ordinary public asset cache.
    return !/^\/api\/(?:file2|render\/[^/]+|treeOfLife)\/?$/.test(path);
  }
  if (path === "/doc" || path.startsWith("/doc/")) {
    const id = path.slice("/doc/".length).replace(/\/$/, "");
    return !isPublicRitualId(id);
  }
  return [
    "/admin",
    "/temples",
    "/upload",
    "/signin",
    "/gd/rituals",
    "/chat/train",
  ].some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

/** These names are owned by the installed/previous Magickly Serwist configuration. */
const legacyPrivateCapableCaches = new Set([
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "apis",
  "others",
  "next-data",
  "static-data-assets",
  "next-image",
  "static-image-assets",
]);

/** Remove only private entries from known old caches; keep public assets and all recovery DBs. */
export async function clearLegacyPrivateResponses(
  storage: CacheStorage,
  origin: string,
): Promise<void> {
  for (const name of await storage.keys()) {
    if (!legacyPrivateCapableCaches.has(name)) continue;
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (isPrivateRuntimeUrl(url, origin))
        await cache.delete(request, { ignoreVary: true });
    }
  }
}

/** Install before defaultCache; private responses must never fall through to its generic API/RSC caches. */
export function privateRuntimeCaching(
  origin: string,
  anonymousRitualShell?: () => Promise<Response>,
): RuntimeCaching[] {
  const strategy = new NetworkOnly();
  const handler: RuntimeCaching["handler"] = async (options) => {
    try {
      return await strategy.handle(options);
    } catch (error) {
      const { request } = options;
      const url = new URL(request.url);
      const match = /^\/doc\/([^/]+)\/?$/.exec(url.pathname);
      if (
        anonymousRitualShell &&
        url.origin === origin &&
        request.method === "GET" &&
        request.mode === "navigate" &&
        match &&
        (isUuidV7(match[1]) || /^[a-f\d]{24}$/i.test(match[1])) &&
        ![
          "rsc",
          "next-router-state-tree",
          "next-router-prefetch",
          "next-router-segment-prefetch",
          "authorization",
          "next-action",
          "x-nextjs-data",
        ].some((name) => request.headers.has(name)) &&
        !/prefetch/i.test(
          `${request.headers.get("purpose")} ${request.headers.get("sec-purpose")}`,
        ) &&
        (request.headers.get("accept") ?? "text/html").includes("text/html")
      )
        return anonymousRitualShell();
      throw error;
    }
  };
  // Keep fallback outside Strategy plugins: Serwist 9.5's development
  // handlerDidError branch throws after a successful plugin fallback.
  return [
    {
      matcher: ({ url }) => isPrivateRuntimeUrl(url, origin),
      handler: anonymousRitualShell ? handler : strategy,
    },
  ];
}
