import type { PrecacheEntry, PrecacheOptions, RuntimeCaching } from "serwist";
import { isPublicRitualId, publicRitualQueryKeys } from "./publicRituals";

const prefix = "magickli-public-ritual-shells-v1-";
const excludedHeaders = [
  "authorization",
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
  "next-url",
  "next-action",
  "x-nextjs-data",
];

/** Only HTML navigations for a declared bundled ritual qualify. */
export function publicRitualShellPath(
  request: Request,
  origin: string,
): string | null {
  const url = new URL(request.url);
  const id = url.pathname.slice("/doc/".length);
  if (
    url.origin !== origin ||
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    !url.pathname.startsWith("/doc/") ||
    !isPublicRitualId(id)
  )
    return null;
  if (
    excludedHeaders.some((name) => request.headers.has(name)) ||
    /prefetch/i.test(
      `${request.headers.get("purpose")} ${request.headers.get("sec-purpose")}`,
    )
  )
    return null;
  const accept = request.headers.get("accept");
  if (accept && !accept.includes("text/html") && accept !== "*/*") return null;
  if (
    [...url.searchParams.keys()].some(
      (key) => !(publicRitualQueryKeys[id] as readonly string[]).includes(key),
    )
  )
    return null;
  return url.pathname;
}

/** Dedicated immutable shells are fetched anonymously and bound to this precache build. */
export function createPublicRitualShells(
  manifest: readonly (PrecacheEntry | string)[],
  origin: string,
  deploymentId?: string | false,
) {
  const entries = manifest.map((entry) =>
    typeof entry === "string" ? { url: entry, revision: null } : entry,
  );
  const urls = new Set(entries.map((entry) => new URL(entry.url, origin).href));
  const buildIds = [...urls].flatMap((url) => {
    const match = /^\/_next\/static\/([^/]+)\/_buildManifest\.js$/.exec(
      new URL(url).pathname,
    );
    return match ? [match[1]] : [];
  });
  if (buildIds.length !== 1)
    throw new Error(
      "A unique Next precache build identity is required for public ritual shells.",
    );
  const buildId = buildIds[0];
  const identity = JSON.stringify({
    entries: entries.map((entry) => [entry.url, entry.revision ?? null]).sort(),
    deploymentId: deploymentId || null,
  });
  const cacheName = crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(identity))
    .then(
      (hash) =>
        prefix +
        [...new Uint8Array(hash)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
    );
  // Next appends deployment identity to chunk URLs; Serwist's default precache
  // matcher does not remove it. Only this deployment's declared static assets
  // may use the corresponding query-free precache entry.
  const deploymentAsset = (url: URL): URL | null => {
    if (
      !deploymentId ||
      url.origin !== origin ||
      !url.pathname.startsWith("/_next/static/") ||
      url.searchParams.get("dpl") !== deploymentId ||
      [...url.searchParams].length !== 1
    )
      return null;
    const plain = new URL(url);
    plain.search = "";
    return urls.has(plain.href) ? plain : null;
  };
  const precacheOptions: PrecacheOptions = {
    urlManipulation: ({ url }) => {
      const asset = deploymentAsset(url);
      return asset ? [asset] : [];
    },
  };
  const pending = new Map<string, Promise<Response>>();
  const canonical = (path: string) =>
    new Request(new URL(path, origin), {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { Accept: "text/html" },
    });

  function assertShell(response: Response, request: Request, html: string) {
    const policy = response.headers.get("cache-control")?.toLowerCase() ?? "";
    const vary =
      response.headers
        .get("vary")
        ?.toLowerCase()
        .split(/\s*,\s*/) ?? [];
    if (
      response.status !== 200 ||
      response.redirected ||
      response.url !== request.url ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("text/html") ||
      /(?:^|,)\s*(?:private|no-store)\b/.test(policy) ||
      !/(?:^|,)\s*(?:public\b|s-maxage=[1-9]\d*)/.test(policy) ||
      vary.some((key) => ["*", "cookie", "authorization"].includes(key))
    )
      throw new Error(
        "The public ritual shell response is not explicitly cacheable anonymous HTML.",
      );
    // Next16 supplies the deployment identity on <html>, or its initial Flight
    // payload's build id otherwise. Fail closed if an upgrade changes that format.
    const escaped = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (deploymentId) {
      if (
        !new RegExp(
          `<html\\b[^>]*\\bdata-dpl-id=["']${escaped(deploymentId)}["']`,
        ).test(html)
      )
        throw new Error("Public ritual shell belongs to another deployment.");
    } else {
      const ids = [...html.matchAll(/\\"b\\":\\"([^"\\]+)\\"/g)].map(
        (match) => match[1],
      );
      if (!ids.length || ids.some((id) => id !== buildId))
        throw new Error("Public ritual shell belongs to another build.");
    }
    // Check every directly loaded script/stylesheet, including deployment queries.
    const assets = [
      ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"#]+)"[^>]*>/g),
    ]
      .map((match) => match[1].replaceAll("&amp;", "&"))
      .filter((url) =>
        new URL(url, origin).pathname.startsWith("/_next/static/"),
      );
    if (
      !assets.length ||
      assets.some((asset) => {
        const url = new URL(asset, origin);
        return !urls.has((deploymentAsset(url) ?? url).href);
      })
    )
      throw new Error(
        "Public ritual shell references assets outside this precache build.",
      );
  }

  async function load(path: string, required = false): Promise<Response> {
    const request = canonical(path);
    let cache: Cache | undefined;
    try {
      cache = await caches.open(await cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch (error) {
      if (required) throw error;
    }
    let work = pending.get(path);
    if (!work) {
      work = (async () => {
        // Do not call a Serwist Strategy.fetch: it consumes navigation preload
        // before request plugins, which could cache credentialed/query HTML here.
        const response = await fetch(request);
        const html = await response.clone().text();
        assertShell(response, request, html);
        try {
          await cache?.put(request, response.clone());
        } catch (error) {
          if (required) throw error;
        }
        return response;
      })();
      pending.set(path, work);
      void work.finally(() => pending.delete(path)).catch(() => {});
    }
    return (await work).clone();
  }

  const runtimeCaching: RuntimeCaching[] = [
    {
      matcher: ({ request }) => publicRitualShellPath(request, origin) !== null,
      handler: async ({ request }) => {
        const path = publicRitualShellPath(request, origin);
        if (!path) throw new Error("Not a public ritual shell request.");
        return await load(path);
      },
    },
  ];
  return {
    cacheName,
    precacheOptions,
    runtimeCaching,
    /** Installation requires all three shells; a failed refresh leaves the previous worker active. */
    warm: () =>
      Promise.all(
        Object.keys(publicRitualQueryKeys).map((id) =>
          load(`/doc/${id}`, true),
        ),
      ),
    /** Cleanup aligns with Serwist's activation-time removal of obsolete precache assets. */
    clearObsolete: async () => {
      const current = await cacheName;
      // The disabled Serwist auxiliary navigation worker cached credentialed
      // HTML in this unversioned cache without respecting private/no-store.
      await caches.delete("pages");
      await Promise.all(
        (await caches.keys())
          .filter((name) => name.startsWith(prefix) && name !== current)
          .map((name) => caches.delete(name)),
      );
    },
  };
}
