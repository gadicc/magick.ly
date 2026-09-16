import { realpathSync } from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import { legacyStaticImageAliases } from "./src/files/legacyStaticImages";
import { RITUAL_PUBLICATION_STATIC_PATHS } from "./src/files/ritualPublicationStaticPaths";

// Vercel standalone can retain this package symlink while dropping a file traced
// through it. Trace the physical target while the runtime keeps the stable alias.
const resvgWasmTraceFile = `./${path
  .relative(
    process.cwd(),
    realpathSync(
      path.join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm"),
    ),
  )
  .split(path.sep)
  .join("/")}`;

const physicalTraceFile = (file: string) =>
  `./${path.relative(process.cwd(), realpathSync(file)).split(path.sep).join("/")}`;
const cssTreeDirectory = path.dirname(
  realpathSync(path.join(process.cwd(), "node_modules/css-tree/package.json")),
);
const cssTreeDynamicDataTraceFiles = [
  path.join(cssTreeDirectory, "data/patch.json"),
  ...["at-rules.json", "properties.json", "syntaxes.json"].map((file) =>
    path.join(cssTreeDirectory, "../mdn-data/css", file),
  ),
].map(physicalTraceFile);

const ritualPublicationTraceFiles = [
  // Next 16 resolves include values from the project root and route keys with picomatch.
  ...RITUAL_PUBLICATION_STATIC_PATHS.map((pathname) => `./public${pathname}`),
  "./public/fonts/*.ttf",
  resvgWasmTraceFile,
  ...cssTreeDynamicDataTraceFiles,
];

export default async function (phase: string): Promise<NextConfig> {
  const nextConfig: NextConfig = {
    redirects: () =>
      Object.entries(legacyStaticImageAliases).map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),
    // See also alternative with patch-package:
    // https://stackoverflow.com/a/77722836/1839099
    // css-tree's ESM data entry uses createRequire(import.meta.url). Keep the
    // package native so its relative data paths remain runtime-relative.
    serverExternalPackages: ["pdf-parse", "@resvg/resvg-wasm", "css-tree"],
    outputFileTracingIncludes: {
      "/api/treeOfLife": ["./public/fonts/*.ttf", resvgWasmTraceFile],
      "/api/render/*": ["./public/fonts/*.ttf", resvgWasmTraceFile],
      "/api/rituals/publication": [...ritualPublicationTraceFiles],
      "/api/rituals/publication/backfill": [...ritualPublicationTraceFiles],
    },
    experimental: {},
    webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
      // https://stackoverflow.com/questions/64926174/module-not-found-cant-resolve-fs-in-next-js-application
      // ./node_modules/nlopt-js/dist/index.js; Module not found: Can't resolve 'fs'
      config.resolve.fallback = { fs: false };

      config.module.rules.push({
        test: /\.json5$/i,
        type: "json", // emit as JSON module
        parser: { parse: JSON5.parse },
      });

      config.module.rules.push({
        test: /\.svg$/,
        use: ["@svgr/webpack"],
      });

      return config;
    },
  };

  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    const withSerwist = (await import("@serwist/next")).default({
      // https://serwist.pages.dev/docs/next/configuring/cache-on-navigation
      // The auxiliary worker persists credentialed HTML despite private/no-store.
      // Public ritual shells are warmed explicitly by our service worker.
      cacheOnNavigation: false,

      // Note: This is only an example. If you use Pages Router,
      // use something else that works, such as "service-worker/index.ts".
      swSrc: "src/app/sw.ts",
      swDest: "public/sw.js",

      //   reloadOnOnline: true,

      disable: process.env.NODE_ENV !== "production",

      // https://serwist.pages.dev/docs/next/configuring/reload-on-online
      // Hopefully fixes issue where app reloads after phone lock/unlock on Android Chrome.
      reloadOnOnline: false,

      // Handled in src/serwistStuff.tsx
      // https://serwist.pages.dev/docs/next/configuring/register
      register: false,
    });
    return withSerwist(nextConfig);
  }

  return nextConfig;
}
