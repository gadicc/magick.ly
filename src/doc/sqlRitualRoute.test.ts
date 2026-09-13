import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, expect, it, vi } from "vitest";
import * as aliasSchema from "../db/schema/legacyIds";
import { resolveRitualRouteId } from "./sqlRitualRoute";

vi.mock("server-only", () => ({}));

const harness = await createMemoryPgliteHarness({ schema: aliasSchema });
const db = drizzle(harness.client, { schema: aliasSchema });
const DOC_ID = "019947c5-abcd-7000-8000-000000000001";
const OTHER_ID = "019947c5-abcd-7000-8000-000000000002";
const ALIAS = "0123456789abcdef01234567";

afterAll(async () => harness.client.close());

it("resolves only the Mongo docs/ObjectId namespace", async () => {
  await db.insert(aliasSchema.legacyIdAliases).values([
    {
      sourceSystem: "mongodb",
      entityType: "docs",
      legacyIdType: "objectid",
      legacyIdValue: ALIAS,
      canonicalId: DOC_ID,
    },
    {
      sourceSystem: "mongodb",
      entityType: "users",
      legacyIdType: "objectid",
      legacyIdValue: ALIAS,
      canonicalId: OTHER_ID,
    },
  ]);
  await expect(resolveRitualRouteId(db, ALIAS)).resolves.toBe(DOC_ID);
  await expect(resolveRitualRouteId(db, ALIAS.toUpperCase())).resolves.toBe(
    DOC_ID,
  );
  await expect(
    resolveRitualRouteId(db, "111111111111111111111111"),
  ).resolves.toBeNull();
  await expect(resolveRitualRouteId(db, DOC_ID)).resolves.toBe(DOC_ID);
});
