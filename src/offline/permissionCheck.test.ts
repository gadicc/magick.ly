import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "../db/schema/auth";
import {
  templeInvites,
  templeMemberships,
  temples,
  userGroupGrants,
  userGroups,
} from "../db/schema/memberships";
import {
  legacyRitualCompiledArchives,
  ritualCompiledArtifacts,
  ritualRevisions,
  ritualScopeKind,
  rituals,
} from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import { compileRitualSource } from "../doc/compileContract";
import type { SqlRitualReadDatabase } from "../doc/sqlReads";
import { createUuidV7 } from "../lib/ids";
import { OFFLINE_AUTHORIZATION_WINDOW_MS } from "./lease";
import { parseRitualPermissionResponse } from "./permissionContract";
import { createSqlRitualPermissionChecker } from "./sqlPermissionCheck";

vi.mock("server-only", () => ({}));

const schema = {
  user,
  userAccess,
  temples,
  templeInvites,
  templeMemberships,
  userGroups,
  userGroupGrants,
  rituals,
  ritualRevisions,
  ritualScopeKind,
  legacyRitualCompiledArchives,
  ritualCompiledArtifacts,
};
const harness = await createMemoryPgliteHarness({ schema });
const queries: string[] = [];
const db = drizzle(harness.client, {
  schema,
  logger: { logQuery: (query) => queries.push(query) },
});
afterAll(() => harness.client.close());
const actor = Object.fromEntries(
  [
    "creator",
    "global",
    "member",
    "groupAdmin",
    "gradeZero",
    "gradeTwo",
    "templeAdmin",
    "otherAdmin",
    "outsider",
  ].map((name) => [name, createUuidV7()]),
);
const group = createUuidV7(),
  otherGroup = createUuidV7(),
  temple = createUuidV7(),
  otherTemple = createUuidV7();
const ritualIds = Object.fromEntries(
  ["public", "group", "zero", "two", "otherGroup", "otherTemple", "shell"].map(
    (name) => [name, createUuidV7()],
  ),
);
const revisions = new Map<string, { previous: string; current: string }>();
const when = new Date("2026-09-12T12:00:00.123Z");
const text = (id: string) =>
  `p exact ${id}\r\n\t|  e\u0301 é \u{1F30D}\r\n\r\n`;
const hash = (source: string) =>
  createHash("sha256").update(source, "utf8").digest("hex");
const compiledJson = JSON.stringify(
  {
    children: [
      {
        type: "task",
        forMe: true,
        children: [
          {
            type: "text",
            value: "Synthetic \uFEFFe\u0301 é 🌍\r\n",
            children: [],
          },
        ],
      },
    ],
  },
  null,
  2,
);

beforeEach(async () => {
  await db.update(rituals).set({ currentCompiledArtifactId: null });
  await db.delete(ritualCompiledArtifacts);
  await db.delete(legacyRitualCompiledArchives);
  await db.update(rituals).set({ currentRevisionId: null });
  await db.delete(ritualRevisions);
  await db.delete(rituals);
  await db.delete(templeMemberships);
  await db.delete(templeInvites);
  await db.delete(userGroupGrants);
  await db.delete(temples);
  await db.delete(userGroups);
  await db.delete(userAccess);
  await db.delete(user);
  revisions.clear();
  await db.transaction(async (tx) => {
    await tx.insert(user).values(
      Object.entries(actor).map(([name, id]) => ({
        id,
        name,
        email: `private-${name}@example.test`,
      })),
    );
    await tx.insert(userAccess).values({ userId: actor.global, admin: true });
    await tx.insert(userGroups).values([
      { id: group, name: "Synthetic group" },
      { id: otherGroup, name: "Other group" },
    ]);
    await tx.insert(temples).values([
      { id: temple, name: "Synthetic temple", slug: "synthetic" },
      { id: otherTemple, name: "Other temple", slug: "other" },
    ]);
    await tx
      .insert(templeInvites)
      .values({ templeId: temple, joinPass: "synthetic-invite-secret" });
    await tx.insert(userGroupGrants).values([
      { userId: actor.member, groupId: group, member: true },
      { userId: actor.groupAdmin, groupId: group, member: false, admin: true },
      { userId: actor.otherAdmin, groupId: otherGroup, admin: true },
    ]);
    await tx.insert(templeMemberships).values(
      [
        { userId: actor.gradeZero, grade: 0 },
        { userId: actor.gradeTwo, grade: 2 },
        { userId: actor.templeAdmin, grade: 0, admin: true },
      ].map((row) => ({
        ...row,
        templeId: temple,
        addedAt: when,
        motto: "synthetic-private-motto",
      })),
    );
    await tx.insert(templeMemberships).values({
      userId: actor.otherAdmin,
      templeId: otherTemple,
      grade: 0,
      admin: true,
      addedAt: when,
    });
    const policy = {
      public: { scope: "public" as const },
      group: { scope: "group" as const, groupId: group },
      zero: {
        scope: "temple" as const,
        templeId: temple,
        minGrade: 0,
        creatorId: null,
      },
      two: { scope: "temple" as const, templeId: temple, minGrade: 2 },
      otherGroup: { scope: "group" as const, groupId: otherGroup },
      otherTemple: {
        scope: "temple" as const,
        templeId: otherTemple,
        minGrade: 100,
      },
      shell: { scope: "public" as const },
    };
    for (const name of Object.keys(policy) as (keyof typeof policy)[]) {
      const id = ritualIds[name];
      await tx.insert(rituals).values({
        id,
        title: `Synthetic ${name}`,
        creatorId: actor.creator,
        ...policy[name],
        createdAt: null,
        updatedAt: when,
        version: 7,
        legacySyncUpdatedAtMilliseconds: 17,
      });
      if (name === "shell") continue;
      const ids = { previous: createUuidV7(), current: createUuidV7() };
      revisions.set(id, ids);
      await tx.insert(ritualRevisions).values(
        Object.values(ids).map((revisionId) => ({
          id: revisionId,
          ritualId: id,
          authorId: actor.creator,
          source: text(revisionId),
          sourceSha256: hash(text(revisionId)),
          sourceFormat: "magickli-pug-shortcuts",
          sourceFormatVersion: "legacy-unversioned",
          createdAt: when,
          updatedAt: when,
        })),
      );
      await tx.insert(legacyRitualCompiledArchives).values({
        ritualId: id,
        claimedRevisionId: ids.current,
        contentJson: compiledJson,
        contentSha256: hash(compiledJson),
        serializationVersion: "json-stringify-utf8-v1",
        importedAt: when,
      });
      await tx
        .update(rituals)
        .set({ currentRevisionId: ids.current })
        .where(eq(rituals.id, id));
    }
  });
  queries.length = 0;
});

const request = (who = "creator", name = "group") => ({
  version: 1 as const,
  requestId: createUuidV7(),
  expectedActorId: actor[who],
  ritualId: ritualIds[name],
});
const checker = (
  who: string | null = "creator",
  database: SqlRitualReadDatabase = db,
  now = () => when.getTime(),
) =>
  createSqlRitualPermissionChecker(
    database,
    async () => (who === null ? null : (actor[who] ?? who)),
    { now },
  );
const transport = { status: 200, sameOrigin: true, uncached: true };
const selectedQueries = () =>
  queries.filter(
    (query) =>
      query.includes('from "ritual_compiled_artifacts"') ||
      query.includes('from "legacy_ritual_compiled_archives"'),
  );

describe("server permission check", () => {
  it.each([
    ["outsider", "public", true, false],
    ["outsider", "group", false, false],
    ["member", "group", true, false],
    ["member", "otherGroup", false, false],
    ["groupAdmin", "group", true, true],
    ["groupAdmin", "public", true, false],
    ["gradeZero", "zero", true, false],
    ["gradeZero", "two", false, false],
    ["gradeTwo", "two", true, false],
    ["templeAdmin", "two", true, true],
    ["otherAdmin", "two", false, false],
    ["otherAdmin", "otherTemple", true, true],
    ["creator", "group", true, true],
    ["creator", "two", true, true],
    ["global", "group", true, true],
    ["global", "zero", true, true],
  ])(
    "evaluates %s/%s from SQL",
    async (who: string, name: string, allowed: boolean, edit: boolean) => {
      const input = request(who, name),
        reply = await checker(who)(input);
      expect(reply?.kind).toBe(allowed ? "granted" : "denied");
      expect(parseRitualPermissionResponse(input, reply, transport)).toEqual(
        reply,
      );
      if (reply?.kind === "granted") {
        expect(reply.grant.sourceEdit).toBe(edit);
        expect(reply.grant.expiresAtMs - reply.grant.checkedAtMs).toBe(
          OFFLINE_AUTHORIZATION_WINDOW_MS,
        );
        expect(reply.rendered.kind).toBe("available");
        expect(reply.editor).toEqual(
          edit
            ? {
                currentRevisionId: revisions.get(input.ritualId)!.current,
                parentVersion: 7,
              }
            : null,
        );
        if (!edit)
          expect(JSON.stringify(reply)).not.toContain(
            revisions.get(input.ritualId)!.current,
          );
      }
      expect(selectedQueries()).toHaveLength(allowed ? 1 : 0);
      expect(queries.some((q) => q.includes('from "ritual_revisions"'))).toBe(
        false,
      );
      expect(JSON.stringify(reply)).not.toMatch(
        /synthetic-invite-secret|private-|sourceSha256|contentJson|legacySync|bundleId|assets/,
      );
    },
  );
  it.each([null, "malformed", createUuidV7(), "member"])(
    "requires verified matching existing identity %s",
    async (who) => {
      const reply = await checker(who)(request());
      expect(reply?.kind).toBe("authentication-required");
      expect(queries).toHaveLength(0);
    },
  );
  it("treats a now-deleted canonical user as reauthentication, even for public content", async () => {
    const input = request("outsider", "public");
    await db.delete(user).where(eq(user.id, input.expectedActorId));
    queries.length = 0;
    expect((await checker("outsider")(input))?.kind).toBe(
      "authentication-required",
    );
    expect(queries.filter((q) => q.startsWith("select"))).toHaveLength(1);
    expect(queries.some((q) => q.includes('from "rituals"'))).toBe(false);
  });
  it("denies an absent ritual only after a verified existing user is loaded", async () => {
    const input = { ...request(), ritualId: createUuidV7() };
    expect((await checker()(input))?.kind).toBe("denied");
    expect(selectedQueries()).toHaveLength(0);
  });
  it.each(["creator", "member"])(
    "renews %s permission independently of missing output",
    async (who) => {
      await db
        .delete(legacyRitualCompiledArchives)
        .where(eq(legacyRitualCompiledArchives.ritualId, ritualIds.group));
      const input = request(who),
        reply = await checker(who)(input);
      expect(reply?.kind).toBe("granted");
      if (reply?.kind !== "granted") throw Error();
      expect(reply.rendered).toEqual({ kind: "temporarily-unavailable" });
      expect(reply.grant.sourceEdit).toBe(who === "creator");
      expect(parseRitualPermissionResponse(input, reply, transport)).toEqual(
        reply,
      );
    },
  );
  it("renews an editor's source capability for a parent without any current revision", async () => {
    const reply = await checker()(request("creator", "shell"));
    expect(reply).toMatchObject({
      kind: "granted",
      grant: { sourceEdit: true },
      editor: null,
      rendered: { kind: "temporarily-unavailable" },
    });
    expect(selectedQueries()).toHaveLength(0);
  });
  it("does not select a stale archive or a matching archive when selected format is unsupported", async () => {
    const ids = revisions.get(ritualIds.group)!;
    await db
      .update(legacyRitualCompiledArchives)
      .set({ claimedRevisionId: ids.previous })
      .where(eq(legacyRitualCompiledArchives.ritualId, ritualIds.group));
    expect(await checker()(request())).toMatchObject({
      kind: "granted",
      rendered: { kind: "temporarily-unavailable" },
    });
    await db
      .update(legacyRitualCompiledArchives)
      .set({ claimedRevisionId: ids.current })
      .where(eq(legacyRitualCompiledArchives.ritualId, ritualIds.group));
    const artifact = createUuidV7();
    await db.insert(ritualCompiledArtifacts).values({
      id: artifact,
      revisionId: ids.current,
      ...compileRitualSource(text(ids.current))!,
      outputFormatVersion: "unsupported",
      compiledAt: when,
    });
    await db
      .update(rituals)
      .set({ currentCompiledArtifactId: artifact })
      .where(eq(rituals.id, ritualIds.group));
    queries.length = 0;
    expect(await checker()(request())).toMatchObject({
      kind: "granted",
      rendered: { kind: "temporarily-unavailable" },
    });
    expect(selectedQueries()).toHaveLength(1);
    expect(selectedQueries()[0]).toContain('from "ritual_compiled_artifacts"');
  });
  it("uses shared selected output and hashes identity without exposing source tokens to readers", async () => {
    const artifact = createUuidV7();
    const compiled = compileRitualSource(
      text(revisions.get(ritualIds.group)!.current),
    )!;
    await db.insert(ritualCompiledArtifacts).values({
      id: artifact,
      revisionId: revisions.get(ritualIds.group)!.current,
      ...compiled,
      compilerVersion: "future-compatible-compiler",
      compiledAt: when,
    });
    await db
      .update(rituals)
      .set({ currentCompiledArtifactId: artifact })
      .where(eq(rituals.id, ritualIds.group));
    const first = await checker("member")(request("member"));
    expect(first).toMatchObject({
      kind: "granted",
      editor: null,
      rendered: {
        kind: "available",
        descriptor: { contentSha256: compiled.contentSha256 },
      },
    });
    const same = await checker("member")(request("member"));
    expect(
      first?.kind === "granted" && same?.kind === "granted" && first.rendered,
    ).toEqual(same?.kind === "granted" && same.rendered);
    await db
      .update(rituals)
      .set({ version: 8 })
      .where(eq(rituals.id, ritualIds.group));
    const changed = await checker("member")(request("member"));
    expect(first?.kind === "granted" && first.rendered).not.toEqual(
      changed?.kind === "granted" && changed.rendered,
    );
  });
  it.each(["global", "groupAdmin", "templeAdmin"])(
    "observes persisted %s revocation on the next check",
    async (who) => {
      const name = who === "templeAdmin" ? "two" : "group";
      const input = request(who, name);
      expect(await checker(who)(input)).toMatchObject({
        kind: "granted",
        grant: { sourceEdit: true },
      });
      if (who === "global")
        await db
          .update(userAccess)
          .set({ admin: false })
          .where(eq(userAccess.userId, actor[who]));
      else if (who === "groupAdmin")
        await db
          .update(userGroupGrants)
          .set({ member: true, admin: false })
          .where(eq(userGroupGrants.userId, actor[who]));
      else
        await db
          .update(templeMemberships)
          .set({ admin: false })
          .where(eq(templeMemberships.userId, actor[who]));
      expect(await checker(who)(input)).toMatchObject(
        who === "groupAdmin"
          ? { kind: "granted", grant: { sourceEdit: false }, editor: null }
          : { kind: "denied" },
      );
    },
  );
  it("uses exactly one read-only repeatable-read transaction", async () => {
    const transaction = vi.spyOn(db, "transaction");
    expect((await checker("creator", db)(request()))?.kind).toBe("granted");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    transaction.mockRestore();
  });
  it("keeps an inconsistent persisted policy temporary, even for creator/admin", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(
        "ALTER TABLE rituals DROP CONSTRAINT rituals_exclusive_scope",
      );
      await tx
        .update(rituals)
        .set({ groupId: group })
        .where(eq(rituals.id, ritualIds.public));
      const database: SqlRitualReadDatabase = {
        transaction: (work) => work(tx),
      };
      expect(
        await checker("creator", database)(request("creator", "public")),
      ).toMatchObject({ kind: "temporarily-unavailable" });
      expect(
        await checker("global", database)(request("global", "public")),
      ).toMatchObject({ kind: "temporarily-unavailable" });
      await tx
        .update(rituals)
        .set({ minGrade: -1 })
        .where(eq(rituals.id, ritualIds.two));
      expect(
        await checker("creator", database)(request("creator", "two")),
      ).toMatchObject({ kind: "temporarily-unavailable" });
      await tx
        .update(rituals)
        .set({ minGrade: 2 })
        .where(eq(rituals.id, ritualIds.two));
      await tx
        .update(rituals)
        .set({ groupId: null })
        .where(eq(rituals.id, ritualIds.public));
      await tx.execute(
        "ALTER TABLE rituals ADD CONSTRAINT rituals_exclusive_scope CHECK ((scope = 'public' and group_id is null and temple_id is null and min_grade is null) or (scope = 'group' and group_id is not null and temple_id is null and min_grade is null) or (scope = 'temple' and group_id is null and temple_id is not null and min_grade is not null and min_grade between 0 and 9007199254740991))",
      );
    });
  });
  it("rejects invalid requests before session or database access", async () => {
    const session = vi.fn();
    const transaction = vi.fn();
    expect(
      await createSqlRitualPermissionChecker(
        { transaction },
        session,
      )({ ...request(), version: 2 }),
    ).toBeNull();
    expect(session).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("snapshots caller request fields before async session verification", async () => {
    const input = request();
    const original = { ...input };
    const session = async () => {
      input.ritualId = createUuidV7();
      input.expectedActorId = actor.outsider;
      return original.expectedActorId;
    };
    expect(
      await createSqlRitualPermissionChecker(db, session, {
        now: () => when.getTime(),
      })(input),
    ).toMatchObject({
      kind: "granted",
      ritualId: original.ritualId,
      ownerId: original.expectedActorId,
    });
  });
  it.each(["session", "database"])(
    "maps %s faults to temporary without echoing errors",
    async (mode) => {
      const fault = () => {
        throw new Error("synthetic-private-error");
      };
      const check = createSqlRitualPermissionChecker(
        mode === "database" ? { transaction: fault } : db,
        mode === "session" ? fault : async () => actor.creator,
      );
      expect(await check(request())).toMatchObject({
        kind: "temporarily-unavailable",
      });
    },
  );
  it.each([-1, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER])(
    "rejects invalid or overflowing check clock %s",
    async (value) => {
      expect(
        await checker("creator", db, () => value)(request()),
      ).toMatchObject({ kind: "temporarily-unavailable" });
      expect(queries).toHaveLength(0);
    },
  );
  it.each([-1, NaN, 0, OFFLINE_AUTHORIZATION_WINDOW_MS])(
    "does not issue a lease after invalid/backward/expired response clock %s",
    async (offset) => {
      const start = when.getTime();
      let calls = 0;
      const now = () =>
        ++calls === 1
          ? start
          : offset === 0
            ? start - 1
            : offset === -1
              ? -1
              : offset === OFFLINE_AUTHORIZATION_WINDOW_MS
                ? start + offset
                : NaN;
      expect(await checker("creator", db, now)(request())).toMatchObject({
        kind: "temporarily-unavailable",
      });
    },
  );
  it("preparation consumes a configurable shorter lease and default clock works", async () => {
    let calls = 0;
    const check = createSqlRitualPermissionChecker(
      db,
      async () => actor.creator,
      {
        now: () => when.getTime() + (calls++ ? 500 : 0),
        leaseDurationMs: 1000,
      },
    );
    expect(await check(request())).toMatchObject({
      kind: "granted",
      grant: {
        checkedAtMs: when.getTime(),
        respondedAtMs: when.getTime() + 500,
        expiresAtMs: when.getTime() + 1000,
      },
    });
    expect(
      (
        await createSqlRitualPermissionChecker(
          db,
          async () => actor.creator,
        )(request())
      )?.kind,
    ).toBe("granted");
  });
  it.each([0, -1, NaN, -0, OFFLINE_AUTHORIZATION_WINDOW_MS + 1])(
    "rejects invalid configuration %s",
    (value) =>
      expect(() =>
        createSqlRitualPermissionChecker(db, async () => actor.creator, {
          leaseDurationMs: value,
        }),
      ).toThrow(RangeError),
  );
});
