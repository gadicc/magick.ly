import { createHash } from "node:crypto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import {
  OfflineLifecycleCoordinator,
  type OfflineLifecycleState,
} from "./lifecycle";
import { LockedRecoveryQueue } from "./recovery";
import { OfflineRitualRepository } from "./repository";
import { refreshOfflineRitual } from "./ritualDownload";
import { RitualOfflineDatabase } from "./storage";

const OWNER = "019947c5-abcd-7000-8000-000000000001";
const RITUAL = "019947c5-abcd-7000-8000-000000000002";
const BUNDLE = "019947c5-abcd-7000-8000-000000000003";
const ASSET = "019947c5-abcd-7000-8000-000000000004";
const ALIAS = "0123456789abcdef01234567";
const NOW = 2_000_000_000_000;
const bytes = new TextEncoder().encode("synthetic image");
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const renderedJson = JSON.stringify({
  type: "root",
  children: [{ type: "img", src: "/owned/image.png#mark" }],
});
const descriptor = {
  descriptorSha256: hash("descriptor"),
  contentSha256: hash(renderedJson),
  outputFormat: "json-rich-text" as const,
  outputFormatVersion: "1" as const,
};
const manifest = {
  version: 1 as const,
  bundleId: BUNDLE,
  ritualId: RITUAL,
  descriptor,
  title: "Synthetic private ritual",
  renderedJson,
  assets: [
    {
      key: ASSET,
      reference: "/owned/image.png",
      sha256: hash(bytes),
      mime: "image/png" as const,
      bytes: bytes.byteLength,
      purpose: "read" as const,
    },
  ],
  occurrences: [
    {
      path: [0],
      src: "/owned/image.png#mark",
      displayFragment: "#mark",
      assetKey: ASSET,
    },
  ],
};
const manifestJson = JSON.stringify(manifest);
const manifestSha256 = hash(manifestJson);
const databases: RitualOfflineDatabase[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

async function setup() {
  const database = new RitualOfflineDatabase(
    `download-${crypto.randomUUID()}`,
    {
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    },
  );
  databases.push(database);
  const repository = new OfflineRitualRepository(database, () => NOW);
  const account = await repository.activateAccount(OWNER);
  const stateListeners = new Set<(state: OfflineLifecycleState) => void>();
  const coordinator = new OfflineLifecycleCoordinator(
    repository,
    {
      document: new EventTarget(),
      window: new EventTarget(),
      visible: () => true,
      now: () => NOW,
      setTimer: () => 1,
      clearTimer: () => {},
      createObjectURL: () => "blob:synthetic",
      revokeObjectURL: () => {},
      messages: { post: () => {}, subscribe: () => () => {} },
    },
    new LockedRecoveryQueue(),
    { state: (next) => stateListeners.forEach((listener) => listener(next)) },
  );
  await coordinator.start();
  const registration = coordinator.register({
    ritualId: RITUAL,
    capability: "read",
    hide: () => {},
    available: () => {},
  });
  const subscribeState = (listener: (next: OfflineLifecycleState) => void) => {
    stateListeners.add(listener);
    listener(coordinator.state);
    return () => stateListeners.delete(listener);
  };
  return {
    account,
    coordinator,
    database,
    repository,
    registration,
    runtime: { repository, coordinator, subscribeState },
  };
}

function withUrl(response: Response, url: string) {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function transport() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/rituals/permission") {
      const request = JSON.parse(String(init?.body));
      const permission = {
        version: 1,
        requestId: request.requestId,
        ownerId: OWNER,
        ritualId: RITUAL,
        kind: "granted",
        rendered: { kind: "available", descriptor },
        editor: null,
        grant: {
          version: 1,
          leaseId: "019947c5-abcd-7000-8000-000000000005",
          ownerId: OWNER,
          ritualId: RITUAL,
          checkedAtMs: NOW,
          respondedAtMs: NOW,
          expiresAtMs: NOW + 10_000,
          sourceEdit: false,
        },
      };
      const body = JSON.stringify({
        version: 1,
        requestId: request.requestId,
        ownerId: OWNER,
        ritualId: RITUAL,
        routeAlias: new Headers(init?.headers).get("x-magickli-ritual-alias"),
        permission,
        bundle: { bundleId: BUNDLE, manifestJson, manifestSha256 },
      });
      return withUrl(
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
            "Content-Length": String(new TextEncoder().encode(body).byteLength),
          },
        }),
        "https://synthetic.example/api/rituals/permission",
      );
    }
    const assetPath = `/api/rituals/assets/${RITUAL}/${BUNDLE}/${ASSET}`;
    expect(path).toBe(assetPath);
    return withUrl(
      new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "image/png",
          "Content-Length": String(bytes.byteLength),
          "X-Content-SHA256": hash(bytes),
        },
      }),
      `https://synthetic.example${assetPath}`,
    );
  });
}

it("installs a validated delivery atomically under the active epoch", async () => {
  vi.stubGlobal("location", new URL("https://synthetic.example/doc/" + RITUAL));
  const fixture = await setup();
  expect(
    await refreshOfflineRitual(fixture.runtime, fixture.registration, RITUAL, {
      fetcher: transport() as typeof fetch,
      routeAlias: ALIAS,
    }),
  ).toBe(true);
  expect(
    await fixture.repository.readBundle(fixture.account, RITUAL),
  ).toMatchObject({
    bundleId: BUNDLE,
    manifestSha256,
    occurrences: [{ assetKey: ASSET, path: [0] }],
    routeAliases: [ALIAS],
  });
  expect(
    await fixture.repository.resolveDownloadedRitualAlias(
      fixture.account,
      ALIAS,
    ),
  ).toBe(RITUAL);
  expect(
    await (
      await fixture.repository.readAsset(fixture.account, RITUAL, ASSET)
    )?.text(),
  ).toBe("synthetic image");
  fixture.registration.dispose();
  fixture.coordinator.dispose();
});
