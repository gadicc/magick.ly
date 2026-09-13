import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import {
  templeMemberships,
  temples,
  userGroupGrants,
  userGroups,
} from "../db/schema/memberships";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import type { RitualPermissionResponseV1 } from "../offline/permissionContract";
import {
  createSqlRitualCreationOptionsReader,
  createSqlRitualSourceDeliveryFromServices,
} from "./sqlEditorServices";

vi.mock("server-only", () => ({}));

const actorId = createUuidV7();
const ritualId = createUuidV7();
const revisionId = createUuidV7();
const request = {
  version: 1 as const,
  requestId: createUuidV7(),
  expectedActorId: actorId,
  ritualId,
};
const granted = (): RitualPermissionResponseV1 => ({
  version: 1,
  requestId: request.requestId,
  ownerId: actorId,
  ritualId,
  kind: "granted",
  grant: {
    version: 1,
    leaseId: createUuidV7(),
    ownerId: actorId,
    ritualId,
    checkedAtMs: 100,
    respondedAtMs: 101,
    expiresAtMs: 200,
    sourceEdit: true,
  },
  rendered: { kind: "temporarily-unavailable" },
  editor: { currentRevisionId: revisionId, parentVersion: 4 },
});
const source = {
  ritual: { title: "Protected title" },
  currentRevisionId: revisionId,
  version: 4,
  revision: { id: revisionId, source: "p Protected" },
} as Awaited<
  ReturnType<
    ReturnType<
      typeof import("./sqlReads").createSqlRitualReader
    >["getCurrentSource"]
  >
>;
const schema = {
  user,
  userAccess,
  userGroups,
  userGroupGrants,
  temples,
  templeMemberships,
};
const harness = await createMemoryPgliteHarness({ schema });
const database = drizzle(harness.client, { schema });
afterAll(() => harness.client.close());

describe("SQL source delivery race fence", () => {
  it("returns the source only after a matching final permission snapshot", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(granted())
      .mockResolvedValueOnce(granted());
    const read = vi.fn().mockResolvedValue(source);
    const deliver = createSqlRitualSourceDeliveryFromServices(check, read);
    await expect(deliver(request)).resolves.toMatchObject({
      permission: { kind: "granted" },
      source: {
        title: "Protected title",
        revisionId,
        parentVersion: 4,
        source: "p Protected",
      },
    });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("returns the latest denial without source after revocation during the read", async () => {
    const denied: RitualPermissionResponseV1 = {
      version: 1,
      requestId: request.requestId,
      ownerId: actorId,
      ritualId,
      kind: "denied",
    };
    const check = vi
      .fn()
      .mockResolvedValueOnce(granted())
      .mockResolvedValueOnce(denied);
    const deliver = createSqlRitualSourceDeliveryFromServices(
      check,
      vi.fn().mockResolvedValue(source),
    );
    await expect(deliver(request)).resolves.toMatchObject({
      permission: { kind: "denied" },
      source: null,
    });
  });

  it("does not pair a source with a newly selected revision", async () => {
    const changed = granted();
    if (changed.kind !== "granted") throw new Error("test setup");
    changed.editor = {
      currentRevisionId: createUuidV7(),
      parentVersion: 5,
    };
    const deliver = createSqlRitualSourceDeliveryFromServices(
      vi.fn().mockResolvedValueOnce(granted()).mockResolvedValueOnce(changed),
      vi.fn().mockResolvedValue(source),
    );
    await expect(deliver(request)).resolves.toMatchObject({
      permission: { editor: changed.editor },
      source: null,
    });
  });
});

describe("fresh SQL ritual creation scope options", () => {
  it("returns only currently administered scopes, then observes a new global grant", async () => {
    await database.delete(templeMemberships);
    await database.delete(userGroupGrants);
    await database.delete(temples);
    await database.delete(userGroups);
    await database.delete(userAccess);
    await database.delete(user);
    const allowedGroup = createUuidV7();
    const otherGroup = createUuidV7();
    const allowedTemple = createUuidV7();
    const otherTemple = createUuidV7();
    await database.insert(user).values({
      id: actorId,
      name: "Synthetic editor",
      email: "synthetic-editor@example.test",
    });
    await database.insert(userGroups).values([
      { id: allowedGroup, name: "Allowed group" },
      { id: otherGroup, name: "Other group" },
    ]);
    await database.insert(temples).values([
      { id: allowedTemple, name: "Allowed temple", slug: "allowed" },
      { id: otherTemple, name: "Other temple", slug: "other" },
    ]);
    await database.insert(userGroupGrants).values({
      userId: actorId,
      groupId: allowedGroup,
      admin: true,
    });
    await database.insert(templeMemberships).values({
      id: createUuidV7(),
      userId: actorId,
      templeId: allowedTemple,
      grade: 0,
      admin: true,
      addedAt: new Date("2026-09-13T12:00:00.000Z"),
    });
    const read = createSqlRitualCreationOptionsReader(
      database,
      async () => actorId,
    );
    await expect(read()).resolves.toEqual({
      version: 1,
      ownerId: actorId,
      public: false,
      groups: [{ id: allowedGroup, name: "Allowed group" }],
      temples: [{ id: allowedTemple, name: "Allowed temple" }],
    });

    await database.insert(userAccess).values({ userId: actorId, admin: true });
    await expect(read()).resolves.toMatchObject({
      public: true,
      groups: [{ name: "Allowed group" }, { name: "Other group" }],
      temples: [{ name: "Allowed temple" }, { name: "Other temple" }],
    });
  });
});
