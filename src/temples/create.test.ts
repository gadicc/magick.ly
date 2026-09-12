import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import {
  templeInvites,
  templeMemberships,
  temples,
} from "../db/schema/memberships";
import { templeCreationReceipts } from "../db/schema/templeCommands";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import {
  type CreateTempleRequest,
  createSqlTempleCreator,
  type TempleCreationDatabase,
} from "./create";

vi.mock("server-only", () => ({}));
const schema = {
  user,
  userAccess,
  temples,
  templeInvites,
  templeMemberships,
  templeCreationReceipts,
};
const harness = await createMemoryPgliteHarness({ schema });
const { db } = harness;
afterAll(() => harness.client.close());
const actorId = createUuidV7(),
  otherActorId = createUuidV7();
const when = new Date("2026-09-12T12:00:00.123Z");
const request = (name = "Order of Hermès"): CreateTempleRequest => ({
  version: 1,
  operationId: createUuidV7(),
  expectedActorId: actorId,
  name,
});
const creator = (
  actor: string | null = actorId,
  database: TempleCreationDatabase = db,
) =>
  createSqlTempleCreator(database, async () => actor, {
    now: () => new Date(when),
  });
async function counts() {
  return {
    temples: (await db.select().from(temples)).length,
    memberships: (await db.select().from(templeMemberships)).length,
    invites: (await db.select().from(templeInvites)).length,
    receipts: (await db.select().from(templeCreationReceipts)).length,
  };
}
beforeEach(async () => {
  await db.delete(templeCreationReceipts);
  await db.delete(templeMemberships);
  await db.delete(templeInvites);
  await db.delete(temples);
  await db.delete(userAccess);
  await db.delete(user);
  await db.insert(user).values([
    {
      id: actorId,
      name: "Synthetic ordinary user",
      email: "ordinary@example.test",
    },
    {
      id: otherActorId,
      name: "Synthetic other user",
      email: "other@example.test",
    },
  ]);
});

describe("atomic SQL temple creation", () => {
  it("allows an ordinary existing user and atomically creates their temple and grade-zero admin without an invite", async () => {
    await db.insert(userAccess).values({ userId: actorId, admin: false });
    const command = request("  Order of Hermès  ");
    const result = await creator()(command);
    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      slug: "order-of-hermes",
    });
    if (!result.ok) throw new Error("Expected synthetic creation");
    expect(isUuidV7(result.templeId)).toBe(true);
    expect(isUuidV7(result.firstAdminMembershipId)).toBe(true);
    expect(result.templeId).not.toBe(result.firstAdminMembershipId);
    expect(await db.select().from(temples)).toEqual([
      {
        id: result.templeId,
        name: "Order of Hermès",
        slug: "order-of-hermes",
        createdById: actorId,
        createdAt: when,
        updatedAt: when,
        legacySyncUpdatedAtMilliseconds: null,
      },
    ]);
    expect(await db.select().from(templeMemberships)).toEqual([
      {
        id: result.firstAdminMembershipId,
        userId: actorId,
        templeId: result.templeId,
        grade: 0,
        admin: true,
        addedAt: when,
        createdAt: when,
        updatedAt: when,
        memberSince: null,
        motto: null,
        legacySyncUpdatedAtMilliseconds: null,
      },
    ]);
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
    const [receipt] = await db.select().from(templeCreationReceipts);
    expect(receipt).toMatchObject({
      operationId: command.operationId,
      actorId,
      templeId: result.templeId,
      firstAdminMembershipId: result.firstAdminMembershipId,
      slug: result.slug,
      createdAt: when,
    });
    expect(receipt.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt).not.toHaveProperty("joinPass");
    expect((await db.select().from(userAccess))[0].admin).toBe(false);
  });

  it("does not require an access row or any prior temple membership", async () => {
    expect(await db.select().from(userAccess)).toEqual([]);
    expect(await creator()(request())).toMatchObject({ ok: true });
  });

  it.each([null, "bad-id", "012345678901234567890123", createUuidV7()])(
    "rejects an absent or nonexisting verified user (%s)",
    async (id) => {
      const command = request();
      if (isUuidV7(id)) command.expectedActorId = id;
      expect(await creator(id)(command)).toMatchObject({
        ok: false,
        code: "NOT_AUTHENTICATED",
        retryable: false,
      });
      expect(await counts()).toEqual({
        temples: 0,
        memberships: 0,
        invites: 0,
        receipts: 0,
      });
    },
  );

  it("rejects account switching before querying or creating anything", async () => {
    const result = await creator(otherActorId)(request());
    expect(result).toMatchObject({ ok: false, code: "ACCOUNT_CHANGED" });
    expect(await counts()).toEqual({
      temples: 0,
      memberships: 0,
      invites: 0,
      receipts: 0,
    });
    expect(await creator(actorId.toUpperCase())(request())).toMatchObject({
      ok: true,
    });
  });

  it.each([
    null,
    {},
    { version: 2 },
    { name: "" },
    { name: "  \n\t" },
    { name: "a".repeat(201) },
    { name: "bad\0name" },
    { name: "bad\ud800" },
    { operationId: "550e8400-e29b-41d4-a716-446655440000" },
    { operationId: "bad" },
    { operationId: createUuidV7().toUpperCase() },
    { expectedActorId: actorId.toUpperCase() },
    { createdById: otherActorId },
    { joinPass: "unapproved-invite-code" },
    { grade: 100, admin: true },
  ])(
    "rejects invalid or overposted commands %# without calling session verification",
    async (patch) => {
      const verified = vi.fn(async () => actorId);
      const create = createSqlTempleCreator(db, verified);
      const input =
        patch === null || Object.keys(patch).length === 0
          ? patch
          : { ...request(), ...patch };
      expect(await create(input)).toMatchObject({
        ok: false,
        code: "INVALID_REQUEST",
      });
      expect(verified).not.toHaveBeenCalled();
      expect(await counts()).toEqual({
        temples: 0,
        memberships: 0,
        invites: 0,
        receipts: 0,
      });
    },
  );

  it("replays the same immutable operation without generating identities or touching rows", async () => {
    const command = request();
    const first = await creator()(command);
    const before = await db.select().from(templeCreationReceipts);
    const generateId = vi.fn(() => {
      throw new Error("Must not allocate on replay");
    });
    const now = vi.fn(() => {
      throw new Error("Must not change creation time");
    });
    const again = await createSqlTempleCreator(db, async () => actorId, {
      generateId,
      now,
    })(command);
    expect(again).toEqual({ ...first, replayed: true });
    expect(generateId).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(await db.select().from(templeCreationReceipts)).toEqual(before);
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("does not expose another actor's receipt result or accept changed payload under the same operation", async () => {
    const command = request();
    const first = await creator()(command);
    if (!first.ok) throw new Error("Expected synthetic creation");
    for (const result of [
      await creator()({ ...command, name: command.name + " " }),
      await creator(otherActorId)({
        ...command,
        expectedActorId: otherActorId,
      }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        code: "IDEMPOTENCY_KEY_REUSED",
        retryable: false,
      });
      expect(JSON.stringify(result)).not.toContain(first.templeId);
      expect(JSON.stringify(result)).not.toContain(
        first.firstAdminMembershipId,
      );
    }
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("reconciles a committed creation after the response is lost", async () => {
    const command = request();
    const lostAcknowledgement: TempleCreationDatabase = {
      transaction: async (work, config) => {
        await db.transaction(work, config);
        throw new Error("synthetic connection dropped after commit");
      },
    };
    expect(await creator(actorId, lostAcknowledgement)(command)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      retryable: true,
    });
    const [saved] = await db.select().from(temples);
    expect(await creator()(command)).toMatchObject({
      ok: true,
      replayed: true,
      templeId: saved.id,
    });
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("does not restore admin rights or recreate removed domain rows on receipt replay", async () => {
    const command = request();
    const created = await creator()(command);
    if (!created.ok) throw new Error("Expected synthetic creation");
    await db
      .update(templeMemberships)
      .set({ admin: false })
      .where(eq(templeMemberships.id, created.firstAdminMembershipId));
    expect(await creator()(command)).toEqual({ ...created, replayed: true });
    expect((await db.select().from(templeMemberships))[0].admin).toBe(false);
    await db.delete(templeMemberships);
    await db.delete(temples);
    expect(await creator()(command)).toEqual({ ...created, replayed: true });
    expect(await counts()).toEqual({
      temples: 0,
      memberships: 0,
      invites: 0,
      receipts: 1,
    });
  });

  it("serializes identical concurrent calls into one creation and one replay", async () => {
    const command = request();
    const create = creator();
    const results = await Promise.all([create(command), create(command)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && result.replayed),
    ).toHaveLength(1);
    expect(results.map((result) => result.ok && result.templeId)[0]).toBe(
      results.map((result) => result.ok && result.templeId)[1],
    );
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("uses the actual normalized SQL slug constraint and does not choose a suffix or join an existing temple", async () => {
    const existingId = createUuidV7();
    await db.insert(temples).values({
      id: existingId,
      name: "Existing private temple",
      slug: "  OrDeR-Of-HeRmEs  ",
      createdById: otherActorId,
    });
    const command = request();
    const result = await creator()(command);
    expect(result).toMatchObject({
      ok: false,
      code: "SLUG_UNAVAILABLE",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain(existingId);
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 0,
      invites: 0,
      receipts: 0,
    });
    expect(await creator()(request("A different temple"))).toMatchObject({
      ok: true,
      slug: "a-different-temple",
    });
  });

  it("allows only one of two different operations competing for the same temple address", async () => {
    const results = await Promise.all([
      creator()(request()),
      creator(otherActorId)({ ...request(), expectedActorId: otherActorId }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      code: "SLUG_UNAVAILABLE",
    });
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("rolls back a newly inserted temple when first-admin insertion violates an actual SQL constraint", async () => {
    const existing = await creator()(request());
    if (!existing.ok) throw new Error("Expected synthetic creation");
    const newTempleId = createUuidV7();
    const nextIds = [newTempleId, existing.firstAdminMembershipId];
    const failed = await createSqlTempleCreator(db, async () => actorId, {
      generateId: () => nextIds.shift()!,
      now: () => when,
    })(request("Rollback target"));
    expect(failed).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(
      await db.select().from(temples).where(eq(temples.id, newTempleId)),
    ).toEqual([]);
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it("rolls back both domain rows when the final receipt fails and safely retries the same operation", async () => {
    const command = request();
    await db.execute(
      sql`alter table temple_creation_receipts add constraint synthetic_reject_receipt check (false)`,
    );
    try {
      expect(await creator()(command)).toMatchObject({
        ok: false,
        code: "UNAVAILABLE",
        retryable: true,
      });
      expect(await counts()).toEqual({
        temples: 0,
        memberships: 0,
        invites: 0,
        receipts: 0,
      });
    } finally {
      await db.execute(
        sql`alter table temple_creation_receipts drop constraint synthetic_reject_receipt`,
      );
    }
    expect(await creator()(command)).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await counts()).toEqual({
      temples: 1,
      memberships: 1,
      invites: 0,
      receipts: 1,
    });
  });

  it.each(["55P03", "40001", "40P01", "57014"])(
    "classifies PostgreSQL %s as retryable without exposing raw detail",
    async (code) => {
      const database: TempleCreationDatabase = {
        transaction: async () => {
          throw { cause: { code, message: "synthetic-secret-driver-details" } };
        },
      };
      const result = await creator(actorId, database)(request());
      expect(result).toMatchObject({
        ok: false,
        code: "RETRYABLE",
        retryable: true,
      });
      expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    },
  );

  it("recognizes postgres-js constraint_name and refuses message-only or unrelated unique-constraint guesses", async () => {
    for (const [error, code] of [
      [
        {
          cause: {
            code: "23505",
            constraint_name: "temples_slug_normalized_unique",
          },
        },
        "SLUG_UNAVAILABLE",
      ],
      [
        {
          code: "23505",
          constraint_name: "other_constraint",
          message: "temples_slug_normalized_unique private",
        },
        "UNAVAILABLE",
      ],
      [
        {
          message:
            "duplicate key violates temples_slug_normalized_unique private",
        },
        "UNAVAILABLE",
      ],
    ] as const) {
      const database: TempleCreationDatabase = {
        transaction: async () => {
          throw error;
        },
      };
      const result = await creator(actorId, database)(request());
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });

  it("safely handles verification failure, invalid server-generated values and cyclic underlying errors", async () => {
    const inaccessible = createSqlTempleCreator(db, async () => {
      throw new Error("private verification material");
    });
    expect(await inaccessible(request())).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(
      await createSqlTempleCreator(db, async () => actorId, {
        now: () => new Date(NaN),
      })(request()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(
      await createSqlTempleCreator(db, async () => actorId, {
        generateId: () => "wrong-id",
      })(request()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    const database: TempleCreationDatabase = {
      transaction: async () => {
        throw cycle;
      },
    };
    expect(await creator(actorId, database)(request())).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(await counts()).toEqual({
      temples: 0,
      memberships: 0,
      invites: 0,
      receipts: 0,
    });
  });
});
