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
  ritualRevisions,
  ritualScopeKind,
  rituals,
} from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import { createSqlRitualReader, type SqlRitualReadDatabase } from "./sqlReads";

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
const reader = (userId: string | null) =>
  createSqlRitualReader(db, async () => userId);
const names = (values: { id: string }[]) =>
  Object.entries(ritualIds)
    .filter(([, id]) => values.some((row) => row.id === id))
    .map(([name]) => name)
    .sort();

beforeEach(async () => {
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
      await tx
        .update(rituals)
        .set({ currentRevisionId: ids.current })
        .where(eq(rituals.id, id));
    }
  });
  queries.length = 0;
});

describe("SQL ritual authorization/read repository", () => {
  it.each([
    [null, ["public"], []],
    ["outsider", ["public"], []],
    [
      "creator",
      ["group", "otherGroup", "otherTemple", "public", "two"],
      ["group", "otherGroup", "otherTemple", "public", "two"],
    ],
    [
      "global",
      ["group", "otherGroup", "otherTemple", "public", "two", "zero"],
      ["group", "otherGroup", "otherTemple", "public", "two", "zero"],
    ],
    ["member", ["group", "public"], []],
    ["groupAdmin", ["group", "public"], ["group"]],
    ["gradeZero", ["public", "zero"], []],
    ["gradeTwo", ["public", "two", "zero"], []],
    ["templeAdmin", ["public", "two", "zero"], ["two", "zero"]],
    [
      "otherAdmin",
      ["otherGroup", "otherTemple", "public"],
      ["otherGroup", "otherTemple"],
    ],
  ] as [string | null, string[], string[]][])(
    "applies the same list/detail/source policy for %s",
    async (name, readable, editable) => {
      const repository = reader(name === null ? null : actor[name]);
      const listed = await repository.listMetadata();
      expect(names(listed)).toEqual(readable);
      expect(names(listed.filter((row) => row.canEdit))).toEqual(editable);
      for (const [ritualName, id] of Object.entries(ritualIds)) {
        const metadata = await repository.getMetadata(id);
        expect(metadata !== null).toBe(readable.includes(ritualName));
        const history = await repository.listSourceHistory(id);
        expect(history !== null).toBe(editable.includes(ritualName));
        const source = await repository.getCurrentSource(id);
        expect(source !== null).toBe(editable.includes(ritualName));
        if (metadata)
          expect(metadata.canEdit).toBe(editable.includes(ritualName));
      }
    },
  );

  it("preserves exact current/historical source and uses the current pointer when revision dates tie", async () => {
    const repository = reader(actor.creator);
    const id = ritualIds.two;
    const ids = revisions.get(id)!;
    const current = await repository.getCurrentSource(id);
    expect(current).toMatchObject({
      currentRevisionId: ids.current,
      version: 7,
      revision: {
        id: ids.current,
        ritualId: id,
        source: text(ids.current),
        sourceSha256: hash(text(ids.current)),
        sourceFormatVersion: "legacy-unversioned",
        createdAt: when,
        updatedAt: when,
      },
    });
    const previous = await repository.getRevisionSource(id, ids.previous);
    expect(previous?.revision.source).toBe(text(ids.previous));
    expect(previous?.currentRevisionId).toBe(ids.current);
    const history = await repository.listSourceHistory(id);
    expect(history?.revisions.map((row) => row.id)).toEqual(
      [ids.previous, ids.current].sort(),
    );
    expect(
      history?.revisions.every((row) => !Object.hasOwn(row, "source")),
    ).toBe(true);
  });

  it("never binds another parent's revision to a permitted parent, even for global admins", async () => {
    const repository = reader(actor.global);
    const foreignRevision = revisions.get(ritualIds.two)!.current;
    expect(
      await repository.getRevisionSource(ritualIds.group, foreignRevision),
    ).toBeNull();
    expect(
      await repository.getRevisionSource(ritualIds.two, foreignRevision),
    ).not.toBeNull();
    expect(
      await reader(actor.groupAdmin).getRevisionSource(
        ritualIds.two,
        foreignRevision,
      ),
    ).toBeNull();
    expect(
      await repository.getRevisionSource(ritualIds.group, createUuidV7()),
    ).toBeNull();
  });

  it("exposes a fixed metadata projection without source, grants, scope identifiers or private evidence", async () => {
    const listed = await reader(actor.global).listMetadata();
    for (const row of listed)
      expect(Object.keys(row).sort()).toEqual([
        "canEdit",
        "createdAt",
        "id",
        "title",
        "updatedAt",
      ]);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toMatch(
      /source|legacy|email|motto|joinPass|forMe|currentRevisionId|version|creatorId|templeId|groupId/,
    );
    expect(listed[0].createdAt).toBeNull();
    expect(listed[0].updatedAt).toEqual(when);
  });

  it("reloads current global, group and temple grants on every call", async () => {
    const global = reader(actor.global);
    expect(await global.getCurrentSource(ritualIds.two)).not.toBeNull();
    await db
      .update(userAccess)
      .set({ admin: false })
      .where(eq(userAccess.userId, actor.global));
    expect(await global.getCurrentSource(ritualIds.two)).toBeNull();
    const admin = reader(actor.groupAdmin);
    expect(await admin.getCurrentSource(ritualIds.group)).not.toBeNull();
    await db
      .update(userGroupGrants)
      .set({ admin: false, member: true })
      .where(eq(userGroupGrants.userId, actor.groupAdmin));
    expect(await admin.getMetadata(ritualIds.group)).toMatchObject({
      canEdit: false,
    });
    expect(await admin.listSourceHistory(ritualIds.group)).toBeNull();
    await db
      .delete(userGroupGrants)
      .where(eq(userGroupGrants.userId, actor.groupAdmin));
    expect(await admin.getMetadata(ritualIds.group)).toBeNull();
    const member = reader(actor.gradeTwo);
    expect(await member.getMetadata(ritualIds.two)).not.toBeNull();
    await db
      .update(templeMemberships)
      .set({ grade: 0 })
      .where(eq(templeMemberships.userId, actor.gradeTwo));
    expect(await member.getMetadata(ritualIds.two)).toBeNull();
    expect(await member.getMetadata(ritualIds.zero)).not.toBeNull();
    await db
      .update(templeMemberships)
      .set({ admin: true })
      .where(eq(templeMemberships.userId, actor.gradeTwo));
    expect(await member.getCurrentSource(ritualIds.two)).not.toBeNull();
    await db
      .delete(templeMemberships)
      .where(eq(templeMemberships.userId, actor.gradeTwo));
    expect(await member.getMetadata(ritualIds.zero)).toBeNull();
  });

  it("reloads changed parent policy and changed session identity through the same reader", async () => {
    let currentActor: string | null = actor.gradeTwo;
    const verified = vi.fn(async () => currentActor);
    const repository = createSqlRitualReader(db, verified);
    expect(await repository.getMetadata(ritualIds.two)).not.toBeNull();
    await db
      .update(rituals)
      .set({ minGrade: 3 })
      .where(eq(rituals.id, ritualIds.two));
    expect(await repository.getMetadata(ritualIds.two)).toBeNull();
    currentActor = actor.creator;
    expect(await repository.getCurrentSource(ritualIds.two)).not.toBeNull();
    currentActor = null;
    expect(await repository.getCurrentSource(ritualIds.two)).toBeNull();
    expect(await repository.getMetadata(ritualIds.public)).not.toBeNull();
    expect(verified).toHaveBeenCalledTimes(5);
  });

  it("does not invent access for missing users, malformed canonical identities or legacy ObjectIds", async () => {
    for (const id of [
      createUuidV7(),
      "012345678901234567890123",
      "bad-id",
      { userId: actor.global } as never,
    ]) {
      expect(names(await reader(id).listMetadata())).toEqual(["public"]);
      expect(await reader(id).getCurrentSource(ritualIds.public)).toBeNull();
    }
    expect(
      await reader(actor.global.toUpperCase()).getCurrentSource(
        ritualIds.two.toUpperCase(),
      ),
    ).not.toBeNull();
    const ids = revisions.get(ritualIds.two)!;
    expect(
      await reader(actor.global).getRevisionSource(
        ritualIds.two.toUpperCase(),
        ids.previous.toUpperCase(),
      ),
    ).not.toBeNull();
    const absent = reader(actor.outsider);
    await db.delete(user).where(eq(user.id, actor.outsider));
    expect(names(await absent.listMetadata())).toEqual(["public"]);
  });

  it("does not query source for invalid or unauthorized inputs, or expose incomplete shells", async () => {
    const verified = vi.fn(async () => actor.global);
    const repository = createSqlRitualReader(db, verified);
    expect(await repository.getMetadata("not-canonical")).toBeNull();
    expect(await repository.listSourceHistory("not-canonical")).toBeNull();
    expect(await repository.getCurrentSource("not-canonical")).toBeNull();
    expect(
      await repository.getRevisionSource(ritualIds.public, "not-canonical"),
    ).toBeNull();
    expect(verified).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
    expect(await reader(null).getCurrentSource(ritualIds.public)).toBeNull();
    expect(
      queries.some((query) => query.includes('from "ritual_revisions"')),
    ).toBe(false);
    expect(await repository.getMetadata(ritualIds.shell)).toBeNull();
    expect(await repository.getCurrentSource(ritualIds.shell)).toBeNull();
    expect(await repository.getMetadata(createUuidV7())).toBeNull();
  });

  it("returns complete parent history beyond the legacy 200-row boundary", async () => {
    const id = ritualIds.group;
    const ids = Array.from({ length: 205 }, () => createUuidV7());
    await db.insert(ritualRevisions).values(
      ids.map((revisionId) => ({
        id: revisionId,
        ritualId: id,
        authorId: actor.creator,
        source: text(revisionId),
        sourceSha256: hash(text(revisionId)),
        sourceFormat: "magickli-pug-shortcuts",
        sourceFormatVersion: "test-v1",
        createdAt: when,
        updatedAt: when,
      })),
    );
    await db
      .update(rituals)
      .set({ currentRevisionId: ids.at(-1)! })
      .where(eq(rituals.id, id));
    const history = await reader(actor.groupAdmin).listSourceHistory(id);
    expect(history?.revisions).toHaveLength(207);
    expect(history?.revisions.every((row) => row.ritualId === id)).toBe(true);
    expect(
      history?.revisions.some((row) => row.id === history.currentRevisionId),
    ).toBe(true);
  });

  it("keeps list query count constant as the ritual list grows and uses a read-only snapshot", async () => {
    const repository = reader(actor.global);
    await repository.listMetadata();
    const firstQueries = queries.filter((query) => /^select /i.test(query));
    expect(firstQueries).toHaveLength(4);
    expect(
      queries.some((query) =>
        /set transaction isolation level repeatable read read only/i.test(
          query,
        ),
      ),
    ).toBe(true);
    expect(
      firstQueries.some((query) =>
        /ritual_revisions|legacy_|auth_session|auth_account|temple_invites/.test(
          query,
        ),
      ),
    ).toBe(false);
    const extra = createUuidV7(),
      revisionId = createUuidV7();
    await db
      .insert(rituals)
      .values({ id: extra, title: "Extra", scope: "public" });
    await db.insert(ritualRevisions).values({
      id: revisionId,
      ritualId: extra,
      authorId: actor.creator,
      source: "p extra",
      sourceSha256: hash("p extra"),
      sourceFormat: "magickli-pug-shortcuts",
      sourceFormatVersion: "test-v1",
      createdAt: when,
      updatedAt: when,
    });
    await db
      .update(rituals)
      .set({ currentRevisionId: revisionId })
      .where(eq(rituals.id, extra));
    queries.length = 0;
    expect(await repository.listMetadata()).toHaveLength(7);
    expect(queries.filter((query) => /^select /i.test(query))).toHaveLength(
      firstQueries.length,
    );
  });

  it("does not fall back to anonymous on session verification or database failure", async () => {
    const verifyFailure = new Error("synthetic session verification failure");
    const unavailable = createSqlRitualReader(db, async () => {
      throw verifyFailure;
    });
    await expect(unavailable.listMetadata()).rejects.toBe(verifyFailure);
    expect(queries).toEqual([]);
    const databaseFailure = new Error("synthetic database failure");
    const broken = createSqlRitualReader(
      {
        transaction: async () => {
          throw databaseFailure;
        },
      } as SqlRitualReadDatabase,
      async () => null,
    );
    await expect(broken.getMetadata(ritualIds.public)).rejects.toBe(
      databaseFailure,
    );
  });
});
