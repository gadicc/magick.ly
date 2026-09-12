import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { afterAll } from "vitest";
import * as schema from "../src/db/schema/index";

const harness = await createMemoryPgliteHarness({
  fixtureDir: "tests/fixtures/db",
  schema,
});

let closePromise: Promise<void> | undefined;

/** Closes this test file's PGlite client exactly once. */
export function closeMemoryPglite() {
  closePromise ??= harness.client.close();
  return closePromise;
}

afterAll(closeMemoryPglite);

export const { client, db, tableLoader } = harness;
