// @vitest-environment node
import { expect, it } from "vitest";

it("imports with Gongo's real server adapter without touching IndexedDB", async () => {
  expect(globalThis.window).toBeUndefined();
  expect(globalThis.indexedDB).toBeUndefined();

  const app = await import("./db");
  expect((app.default as unknown as { idb?: unknown }).idb).toBeUndefined();
  await expect(app.fenceLegacyNetworkForSql()).rejects.toThrow(
    "Legacy browser recovery requires browser storage.",
  );
});
