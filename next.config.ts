import JSON5 from "json5";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import { legacyStaticImageAliases } from "./src/files/legacyStaticImages";

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
    serverExternalPackages: ["pdf-parse", "@resvg/resvg-wasm"],
    outputFileTracingIncludes: {
      "/api/treeOfLife": [
        "./public/fonts/*.ttf",
        "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
      ],
      "/api/render/*": [
        "./public/fonts/*.ttf",
        "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
      ],
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

      config.module.rules.push({
        test: /\.ya?ml$/,
        type: "json", // Required by Webpack v4
        use: "yaml-loader",
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
