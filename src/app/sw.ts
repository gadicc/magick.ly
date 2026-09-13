import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { createPublicRitualShells } from "../doc/publicShells";
import {
  clearLegacyPrivateResponses,
  privateRuntimeCaching,
} from "../offline/privateRequests";

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the
// actual precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const precacheEntries = self.__SW_MANIFEST ?? [];
const publicRituals = createPublicRitualShells(
  precacheEntries,
  self.location.origin,
  process.env.NEXT_DEPLOYMENT_ID,
);

const serwist = new Serwist({
  precacheEntries,
  precacheOptions: publicRituals.precacheOptions,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    ...privateRuntimeCaching(
      self.location.origin,
      publicRituals.privateReaderShell,
    ),
    ...publicRituals.runtimeCaching,
    ...defaultCache,
  ],
});

serwist.addEventListeners();

self.addEventListener("install", (event) =>
  event.waitUntil(
    Promise.all([publicRituals.warm(), publicRituals.warmPrivateReaderShell()]),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    clearLegacyPrivateResponses(caches, self.location.origin).then(() =>
      publicRituals.clearObsolete(),
    ),
  ),
);
