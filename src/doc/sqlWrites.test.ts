import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import { eq, sql } from "drizzle-orm";
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
import { ritualWriteReceipts } from "../db/schema/ritualCommands";
import {
  legacyRitualCompiledArchives,
  ritualCompiledArtifacts,
  ritualRevisions,
  ritualScopeKind,
  rituals,
} from "../db/schema/rituals";
import { userAccess } from "../db/schema/userProfile";
import { createUuidV7 } from "../lib/ids";
import * as compiler from "./compileContract";
import { createSqlRitualReader } from "./sqlReads";
import type { SqlRitualWriteRequest } from "./sqlWriteContract";
import {
  createSqlRitualWriter,
  type SqlRitualWriteDatabase,
} from "./sqlWrites";

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
  ritualWriteReceipts,
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
const reader = (userId: string | null) =>
  createSqlRitualReader(db, async () => userId);

beforeEach(async () => {
  await db.delete(ritualWriteReceipts);
  await db
    .update(rituals)
    .set({ currentCompiledArtifactId: null, currentRevisionId: null });
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
  vi.restoreAllMocks();
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

const writer = (
  name: string | null = "creator",
  database: SqlRitualWriteDatabase = db,
) =>
  createSqlRitualWriter(
    database,
    async () => (name === null ? null : actor[name]),
    { now: () => new Date(when) },
  );
function save(
  name = "group",
  by = "creator",
): Extract<SqlRitualWriteRequest, { kind: "save" }> {
  return {
    version: 2,
    operationId: createUuidV7(),
    expectedActorId: actor[by],
    kind: "save",
    ritualId: ritualIds[name],
    expectedRevisionId: revisions.get(ritualIds[name])!.current,
    expectedVersion: 7,
    source: "p Exact e\u0301 é 🌍\r\n",
  };
}
function create(
  by = "global",
  scope: Extract<SqlRitualWriteRequest, { kind: "create" }>["scope"] = {
    kind: "public",
  },
): Extract<SqlRitualWriteRequest, { kind: "create" }> {
  return {
    version: 2,
    operationId: createUuidV7(),
    expectedActorId: actor[by],
    kind: "create",
    scope,
    title: "  Exact title  ",
    source: "",
  };
}
function publish(
  name = "two",
  by = "global",
): Extract<SqlRitualWriteRequest, { kind: "publish" }> {
  const { source: _, ...base } = save(name, by);
  return { ...base, kind: "publish" };
}
async function counts() {
  return {
    parents: (await db.select().from(rituals)).length,
    revisions: (await db.select().from(ritualRevisions)).length,
    artifacts: (await db.select().from(ritualCompiledArtifacts)).length,
    archives: (await db.select().from(legacyRitualCompiledArchives)).length,
    receipts: (await db.select().from(ritualWriteReceipts)).length,
  };
}
async function current(id = ritualIds.group) {
  return (await db.select().from(rituals).where(eq(rituals.id, id)))[0];
}

describe("atomic canonical SQL-v2 ritual writes", () => {
  it("appends exact source and a selected versioned artifact with parent CAS/receipt in one commit", async () => {
    const command = save();
    command.source = "\uFEFFp Exact e\u0301 é 🌍\r\n\r\n";
    command.title = "Exact title";
    const before = await current(),
      baseline = await counts();
    const archives = await db.select().from(legacyRitualCompiledArchives);
    const result = await writer()(command);
    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      ritualId: command.ritualId,
      version: 8,
      updatedAt: when.toISOString(),
    });
    if (!result.ok) throw new Error("Expected synthetic save");
    const parent = await current();
    expect(parent).toMatchObject({
      ...before,
      currentRevisionId: result.revisionId,
      currentCompiledArtifactId: expect.any(String),
      version: 8,
      title: command.title,
    });
    const [revision] = await db
      .select()
      .from(ritualRevisions)
      .where(eq(ritualRevisions.id, result.revisionId));
    // Wrapped JSON avoids PGlite's bare-text leading-BOM result-decoding caveat.
    const bytes = await db.execute<{ source: string }>(
      sql`select source from (select to_json(source)::text as source from ritual_revisions where id=${result.revisionId}) q`,
    );
    expect(JSON.parse(bytes.rows[0].source)).toBe(command.source);
    expect(revision).toMatchObject({
      ritualId: command.ritualId,
      authorId: actor.creator,
      sourceSha256: hash(command.source),
      sourceFormat: compiler.RITUAL_SOURCE_FORMAT,
      sourceFormatVersion: compiler.RITUAL_SOURCE_FORMAT_VERSION,
      createdAt: when,
      updatedAt: when,
      legacySyncUpdatedAtMilliseconds: null,
    });
    const [artifact] = await db
      .select()
      .from(ritualCompiledArtifacts)
      .where(eq(ritualCompiledArtifacts.id, parent.currentCompiledArtifactId!));
    expect(artifact).toMatchObject({
      revisionId: result.revisionId,
      sourceSha256: hash(command.source),
      compilerVersion: compiler.RITUAL_COMPILER_VERSION,
      outputFormat: compiler.RITUAL_OUTPUT_FORMAT,
      outputFormatVersion: compiler.RITUAL_OUTPUT_FORMAT_VERSION,
      transformations: [],
      compiledAt: when,
    });
    expect(artifact.contentSha256).toBe(hash(artifact.contentJson));
    expect(
      await reader(actor.member).getRendered(command.ritualId),
    ).toMatchObject({
      contentJson: artifact.contentJson,
      contentSha256: artifact.contentSha256,
    });
    expect(await db.select().from(legacyRitualCompiledArchives)).toEqual(
      archives,
    );
    expect(await counts()).toEqual({
      ...baseline,
      revisions: baseline.revisions + 1,
      artifacts: 1,
      receipts: 1,
    });
    expect(
      (await reader(actor.creator).listSourceHistory(command.ritualId))
        ?.revisions,
    ).toHaveLength(3);
  });
  it.each([
    ["global", { kind: "public" }],
    ["global", { kind: "group", groupId: group }],
    ["global", { kind: "temple", templeId: temple, minGrade: 0 }],
    ["groupAdmin", { kind: "group", groupId: group }],
    ["templeAdmin", { kind: "temple", templeId: temple, minGrade: 2 }],
  ] as const)(
    "creates one canonical ritual/revision/artifact for %s",
    async (by, scope) => {
      const command = create(by, scope);
      const baseline = await counts();
      const result = await writer(by)(command);
      expect(result).toMatchObject({ ok: true, version: 1, replayed: false });
      if (!result.ok) throw new Error("Expected synthetic creation");
      expect(result.ritualId).not.toBe(result.revisionId);
      expect(await current(result.ritualId)).toMatchObject({
        creatorId: actor[by],
        scope: scope.kind,
        title: command.title,
        currentRevisionId: result.revisionId,
        currentCompiledArtifactId: expect.any(String),
        version: 1,
        createdAt: when,
        updatedAt: when,
        legacySyncUpdatedAtMilliseconds: null,
      });
      expect(
        (await reader(actor[by]).getCurrentSource(result.ritualId))?.revision
          .source,
      ).toBe("");
      expect(
        await reader(actor[by]).getRendered(result.ritualId),
      ).toMatchObject({ contentJson: '{"children":[]}' });
      expect(await counts()).toEqual({
        ...baseline,
        parents: baseline.parents + 1,
        revisions: baseline.revisions + 1,
        artifacts: 1,
        receipts: 1,
      });
    },
  );
  it.each([
    ["creator", "group", true],
    ["global", "two", true],
    ["groupAdmin", "group", true],
    ["templeAdmin", "two", true],
    ["member", "group", false],
    ["gradeTwo", "two", false],
    ["gradeZero", "zero", false],
    ["otherAdmin", "two", false],
    ["groupAdmin", "two", false],
    ["templeAdmin", "group", false],
    ["creator", "zero", false],
  ] as const)(
    "uses shared edit policy for %s on %s",
    async (by, target, allowed) => {
      const baseline = await counts();
      const result = await writer(by)(save(target, by));
      expect(result.ok).toBe(allowed);
      if (!allowed) {
        expect(result).toMatchObject({ code: "FORBIDDEN", retryable: false });
        expect(await counts()).toEqual(baseline);
      }
    },
  );
  it.each([
    ["creator", { kind: "public" }],
    ["member", { kind: "group", groupId: group }],
    ["groupAdmin", { kind: "group", groupId: otherGroup }],
    ["templeAdmin", { kind: "temple", templeId: otherTemple, minGrade: 0 }],
  ] as const)("refuses creation outside %s authority", async (by, scope) => {
    const baseline = await counts();
    expect(await writer(by)(create(by, scope))).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await counts()).toEqual(baseline);
  });
  it("rejects a nonexistent creation scope even for global admins", async () => {
    expect(
      await writer("global")(
        create("global", { kind: "group", groupId: createUuidV7() }),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("publishes only through explicit global authority without changing source or artifact", async () => {
    const baseline = await counts(),
      before = await current(ritualIds.two),
      command = publish();
    expect(
      await writer("templeAdmin")(publish("two", "templeAdmin")),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await writer("global")(command)).toMatchObject({
      ok: true,
      version: 8,
      revisionId: before.currentRevisionId,
    });
    expect(await current(ritualIds.two)).toMatchObject({
      ...before,
      scope: "public",
      templeId: null,
      minGrade: null,
      version: 8,
    });
    expect(await counts()).toEqual({ ...baseline, receipts: 1 });
    expect(await reader(null).getRendered(ritualIds.two)).not.toBeNull();
    await db
      .update(userAccess)
      .set({ admin: false })
      .where(eq(userAccess.userId, actor.global));
    expect(await writer("global")(command)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
  });
  it("replays original outcomes after later saves without compiling or changing state", async () => {
    const command = save(),
      first = await writer()(command);
    if (!first.ok) throw new Error("Expected save");
    const next = {
      ...command,
      operationId: createUuidV7(),
      expectedRevisionId: first.revisionId,
      expectedVersion: first.version,
      source: "p Later source",
    };
    expect(await writer()(next)).toMatchObject({ ok: true, version: 9 });
    const baseline = await counts();
    const compile = vi
      .spyOn(compiler, "compileRitualSource")
      .mockImplementation(() => {
        throw new Error("Replay must not compile");
      });
    const replay = createSqlRitualWriter(db, async () => actor.creator, {
      now: () => {
        throw new Error("Replay must not allocate time");
      },
      generateId: () => {
        throw new Error("Replay must not allocate IDs");
      },
    });
    expect(await replay(command)).toEqual({ ...first, replayed: true });
    expect(compile).not.toHaveBeenCalled();
    expect(await counts()).toEqual(baseline);
    expect((await current()).version).toBe(9);
  });
  it("replays uncertain creation with the original IDs, never a second copy", async () => {
    const command = create();
    const first = await writer("global")(command);
    expect(first.ok).toBe(true);
    const baseline = await counts();
    expect(await writer("global")(command)).toEqual({
      ...first,
      replayed: true,
    });
    expect(await counts()).toEqual(baseline);
  });
  it.each(["source", "title", "expectedVersion", "actor"] as const)(
    "rejects changed %s under an accepted operation ID",
    async (field) => {
      const command = save();
      expect((await writer()(command)).ok).toBe(true);
      const baseline = await counts();
      const changed = {
        ...command,
        ...(field === "source"
          ? { source: "p Other" }
          : field === "title"
            ? { title: "Other" }
            : field === "expectedVersion"
              ? { expectedVersion: 8 }
              : { expectedActorId: actor.global }),
      };
      expect(
        await writer(field === "actor" ? "global" : "creator")(changed),
      ).toMatchObject({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" });
      expect(await counts()).toEqual(baseline);
    },
  );
  it.each(["revision", "version"] as const)(
    "rejects a stale %s token without partial rows",
    async (token) => {
      const command = save(),
        baseline = await counts(),
        before = await current();
      if (token === "revision")
        command.expectedRevisionId = revisions.get(command.ritualId)!.previous;
      else command.expectedVersion = 6;
      expect(await writer()(command)).toMatchObject({
        ok: false,
        code: "CONFLICT",
      });
      expect(await counts()).toEqual(baseline);
      expect(await current()).toEqual(before);
    },
  );
  it("serializes duplicate delivery and lets only one conflicting operation win", async () => {
    const first = save();
    const duplicates = await Promise.all([writer()(first), writer()(first)]);
    expect(duplicates.every((result) => result.ok)).toBe(true);
    expect(
      duplicates.filter((result) => result.ok && result.replayed),
    ).toHaveLength(1);
    const base = await current();
    const second = {
      ...save(),
      expectedRevisionId: base.currentRevisionId!,
      expectedVersion: base.version,
    };
    const competing = await Promise.all([
      writer()(second),
      writer()({
        ...second,
        operationId: createUuidV7(),
        source: "p Concurrent source",
      }),
    ]);
    expect(competing.filter((result) => result.ok)).toHaveLength(1);
    expect(
      competing.filter((result) => !result.ok && result.code === "CONFLICT"),
    ).toHaveLength(1);
    expect((await counts()).receipts).toBe(2);
  });
  it("resolves a lost commit acknowledgement by replaying its durable receipt", async () => {
    const command = save();
    const uncertain: SqlRitualWriteDatabase = {
      transaction: async (work, config) => {
        await db.transaction(work, config);
        throw new Error("synthetic connection failure after commit");
      },
    };
    expect(await writer("creator", uncertain)(command)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      retryable: true,
    });
    const baseline = await counts();
    expect(await writer()(command)).toMatchObject({
      ok: true,
      replayed: true,
      version: 8,
    });
    expect(await counts()).toEqual(baseline);
  });
  it("rolls back source, artifact, parent CAS and receipt on a precommit failure", async () => {
    const baseline = await counts(),
      before = await current();
    const failing: SqlRitualWriteDatabase = {
      transaction: (work, config) =>
        db.transaction(async (tx) => {
          await work(tx);
          throw new Error("synthetic failure before commit");
        }, config),
    };
    expect(await writer("creator", failing)(save())).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(await counts()).toEqual(baseline);
    expect(await current()).toEqual(before);
    expect(await writer("global", failing)(create())).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(await counts()).toEqual(baseline);
  });
  it.each(["global", "groupAdmin", "templeAdmin"] as const)(
    "checks current %s permission before receipt replay",
    async (by) => {
      const target = by === "groupAdmin" ? "group" : "two",
        command = save(target, by);
      expect((await writer(by)(command)).ok).toBe(true);
      const baseline = await counts();
      if (by === "global")
        await db
          .update(userAccess)
          .set({ admin: false })
          .where(eq(userAccess.userId, actor.global));
      else if (by === "groupAdmin")
        await db
          .delete(userGroupGrants)
          .where(eq(userGroupGrants.userId, actor.groupAdmin));
      else
        await db
          .delete(templeMemberships)
          .where(eq(templeMemberships.userId, actor.templeAdmin));
      expect(await writer(by)(command)).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await counts()).toEqual(baseline);
    },
  );
  it("reloads changed parent scope and permits creator access independently of membership", async () => {
    const command = save("group", "groupAdmin");
    await db
      .update(rituals)
      .set({ groupId: otherGroup })
      .where(eq(rituals.id, command.ritualId));
    expect(await writer("groupAdmin")(command)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await writer()({ ...command, expectedActorId: actor.creator }),
    ).toMatchObject({ ok: true });
  });
  it("retains historical receipts without recreating a removed parent", async () => {
    const command = create(),
      accepted = await writer("global")(command);
    if (!accepted.ok) throw new Error("Expected creation");
    await db
      .update(rituals)
      .set({ currentRevisionId: null, currentCompiledArtifactId: null })
      .where(eq(rituals.id, accepted.ritualId));
    await db
      .delete(ritualCompiledArtifacts)
      .where(eq(ritualCompiledArtifacts.revisionId, accepted.revisionId));
    await db
      .delete(ritualRevisions)
      .where(eq(ritualRevisions.id, accepted.revisionId));
    await db.delete(rituals).where(eq(rituals.id, accepted.ritualId));
    const baseline = await counts();
    expect(await writer("global")(command)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await counts()).toEqual(baseline);
    expect(baseline.receipts).toBe(1);
  });
  it("does not treat a receipt as edit permission when publishing authority is revoked but creator access remains", async () => {
    const command = create(),
      created = await writer("global")(command);
    if (!created.ok) throw new Error("Expected creation");
    const publication = {
      version: 2 as const,
      operationId: createUuidV7(),
      expectedActorId: actor.global,
      kind: "publish" as const,
      ritualId: created.ritualId,
      expectedRevisionId: created.revisionId,
      expectedVersion: created.version,
    };
    expect((await writer("global")(publication)).ok).toBe(true);
    await db
      .update(userAccess)
      .set({ admin: false })
      .where(eq(userAccess.userId, actor.global));
    expect(await writer("global")(publication)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await writer("global")(command)).toMatchObject({
      ok: true,
      replayed: true,
    });
  });
  it("takes the operation lock before receipt reads and holds grants/parent through a read-write transaction", async () => {
    expect((await writer()(save())).ok).toBe(true);
    const lock = queries.findIndex((query) =>
        query.includes("pg_advisory_xact_lock"),
      ),
      receipt = queries.findIndex(
        (query) =>
          query.startsWith("select") &&
          query.includes('from "ritual_write_receipts_v2"'),
      );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(receipt).toBeGreaterThan(lock);
    expect(
      queries.some((query) =>
        /set transaction isolation level read committed read write/.test(query),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes('from "auth_user"') && query.endsWith("for key share"),
      ),
    ).toBe(true);
    for (const table of [
      "user_access",
      "user_group_grants",
      "temple_memberships",
    ])
      expect(
        queries.some(
          (query) =>
            query.includes(`from "${table}"`) && query.endsWith("for share"),
        ),
      ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes('from "rituals"') && query.endsWith("for update"),
      ),
    ).toBe(true);
  });
  it("rejects unsupported v1 and account-switch claims before any database access", async () => {
    const verified = vi.fn(async () => actor.creator),
      service = createSqlRitualWriter(db, verified);
    expect(
      await service({ ...save(), version: 1, expectedUpdatedAt: 17 }),
    ).toMatchObject({ ok: false, code: "UPGRADE_REQUIRED" });
    expect(verified).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
    expect(
      await service({ ...save(), expectedActorId: actor.global }),
    ).toMatchObject({ ok: false, code: "ACCOUNT_CHANGED" });
    expect(queries).toEqual([]);
    expect(await writer(null)(save())).toMatchObject({
      ok: false,
      code: "NOT_AUTHENTICATED",
    });
    expect(queries).toEqual([]);
  });
  it("accepts canonical verified-session casing without admitting a nonexistent identity", async () => {
    expect(
      await createSqlRitualWriter(db, async () => actor.creator.toUpperCase())(
        save(),
      ),
    ).toMatchObject({ ok: true });
    const id = createUuidV7();
    expect(
      await createSqlRitualWriter(
        db,
        async () => id,
      )({ ...save(), expectedActorId: id }),
    ).toMatchObject({ ok: false, code: "NOT_AUTHENTICATED" });
  });
  it.each([
    { source: "" },
    { source: "p \0" },
    { source: "p \uD800" },
    { source: "é".repeat(524289) },
    { title: "x".repeat(501) },
    { title: undefined },
    { title: "\0" },
    { operationId: "012345678901234567890123" },
    { operationId: createUuidV7().toUpperCase() },
    { expectedActorId: "012345678901234567890123" },
    { expectedRevisionId: null },
    { expectedVersion: -0 },
    { expectedVersion: 1.5 },
    { expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { scope: { kind: "public" } },
    { creatorId: actor.global },
    { expectedUpdatedAt: 17 },
    { docId: "old" },
    { kind: "delete" },
  ])("rejects malformed v2 request %# without writes", async (patch) => {
    const baseline = await counts();
    expect(await writer()({ ...save(), ...patch })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
    expect(await counts()).toEqual(baseline);
  });
  it.each([
    { title: " " },
    { scope: { kind: "group", groupId: "old-id" } },
    { scope: { kind: "temple", templeId: "old-id", minGrade: 0 } },
    { scope: { kind: "temple", templeId: temple, minGrade: -1 } },
    { scope: { kind: "public", groupId: group } },
    { source: null },
  ])("rejects malformed creation %#", async (patch) => {
    expect(await writer("global")({ ...create(), ...patch })).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });
  it("rejects malformed source without storing compiler details or partial shells", async () => {
    const baseline = await counts();
    const result = await writer("global")({
      ...create(),
      source: 'p(title="unclosed)',
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_SOURCE" });
    expect(JSON.stringify(result)).not.toContain("unclosed");
    expect(await counts()).toEqual(baseline);
  });
  it("fails closed on absent/shell parents and version exhaustion", async () => {
    expect(
      await writer()({ ...save(), ritualId: createUuidV7() }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await writer()({ ...save(), ritualId: ritualIds.shell }),
    ).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await db
      .update(rituals)
      .set({ version: Number.MAX_SAFE_INTEGER })
      .where(eq(rituals.id, ritualIds.group));
    expect(
      await writer()({ ...save(), expectedVersion: Number.MAX_SAFE_INTEGER }),
    ).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
  it.each(["55P03", "40001", "40P01", "57014"])(
    "returns safe retry classification for %s",
    async (code) => {
      const database: SqlRitualWriteDatabase = {
        transaction: async () => {
          throw { cause: { code, message: "PRIVATE DATABASE DETAILS" } };
        },
      };
      const result = await writer("creator", database)(save());
      expect(result).toMatchObject({
        ok: false,
        code: "RETRYABLE",
        retryable: true,
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    },
  );
  it("handles verification, cyclic backend errors and invalid server generators without fallback", async () => {
    const baseline = await counts();
    expect(
      await createSqlRitualWriter(db, async () => {
        throw new Error("PRIVATE SESSION");
      })(save()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(
      await writer("creator", {
        transaction: async () => {
          throw cycle;
        },
      })(save()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(
      await createSqlRitualWriter(db, async () => actor.global, {
        generateId: () => "bad-id",
      })(create()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(
      await createSqlRitualWriter(db, async () => actor.creator, {
        now: () => new Date(Number.NaN),
      })(save()),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(await counts()).toEqual(baseline);
  });
});

describe("SQL-v2 canonical request and receipt constraints", () => {
  it("requires own request properties and rejects negative-zero grade normalization", async () => {
    expect(await writer()(Object.create(save()))).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
    expect(
      await writer("global")(
        create("global", { kind: "temple", templeId: temple, minGrade: -0 }),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });
  it("enforces receipt UUIDv7, hash, kind and safe-version constraints", async () => {
    expect((await writer()(save())).ok).toBe(true);
    const [receipt] = await db.select().from(ritualWriteReceipts);
    const v4 = createUuidV7().slice(0, 14) + "4" + createUuidV7().slice(15);
    for (const patch of [
      { operationId: v4 },
      { ritualId: v4 },
      { revisionId: v4 },
      { requestHash: "bad-hash" },
      { kind: "unknown" as never },
      { version: 0 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await expect(db.update(ritualWriteReceipts).set(patch)).rejects.toThrow();
    }
    expect(await db.select().from(ritualWriteReceipts)).toEqual([receipt]);
  });
});

describe("explicit current compiled artifact selection", () => {
  it("reads a future compatible compiler identity and never falls back to a matching archive for unsupported format", async () => {
    const id = ritualIds.group,
      currentRevision = revisions.get(id)!.current;
    const content = compiler.compileRitualSource(text(currentRevision))!;
    const [future] = await db
      .insert(ritualCompiledArtifacts)
      .values({
        revisionId: currentRevision,
        sourceSha256: content.sourceSha256,
        compilerVersion: "compatible-future-compiler-v2",
        outputFormat: compiler.RITUAL_OUTPUT_FORMAT,
        outputFormatVersion: compiler.RITUAL_OUTPUT_FORMAT_VERSION,
        transformations: [],
        contentJson: content.contentJson,
        contentSha256: content.contentSha256,
        compiledAt: when,
      })
      .returning();
    await db
      .update(rituals)
      .set({ currentCompiledArtifactId: future.id, version: 8 })
      .where(eq(rituals.id, id));
    expect(await reader(actor.member).getRendered(id)).toMatchObject({
      contentJson: content.contentJson,
      contentSha256: content.contentSha256,
    });
    expect(content.contentJson).not.toBe(compiledJson);
    await db
      .update(ritualCompiledArtifacts)
      .set({ outputFormatVersion: "unsupported-format-v2" })
      .where(eq(ritualCompiledArtifacts.id, future.id));
    expect(await reader(actor.member).getRendered(id)).toBeNull();
    const [archive] = await db
      .select()
      .from(legacyRitualCompiledArchives)
      .where(eq(legacyRitualCompiledArchives.ritualId, id));
    expect(archive.claimedRevisionId).toBe(currentRevision);
    expect(archive.contentJson).toBe(compiledJson);
  });
  it("never selects an unrequested artifact and fails closed on incompatible selected format", async () => {
    const command = save(),
      saved = await writer()(command);
    if (!saved.ok) throw new Error("Expected save");
    const parent = await current();
    const before = await reader(actor.member).getRendered(command.ritualId);
    await db.insert(ritualCompiledArtifacts).values({
      revisionId: saved.revisionId,
      sourceSha256: hash(command.source),
      compilerVersion: "unselected-v2",
      outputFormat: compiler.RITUAL_OUTPUT_FORMAT,
      outputFormatVersion: compiler.RITUAL_OUTPUT_FORMAT_VERSION,
      transformations: [],
      contentJson: '{"newer":true}',
      contentSha256: hash('{"newer":true}'),
      compiledAt: new Date(when.getTime() + 1),
    });
    expect(await reader(actor.member).getRendered(command.ritualId)).toEqual(
      before,
    );
    await db
      .update(ritualCompiledArtifacts)
      .set({ outputFormat: "other-format" })
      .where(eq(ritualCompiledArtifacts.id, parent.currentCompiledArtifactId!));
    expect(await reader(actor.member).getRendered(command.ritualId)).toBeNull();
    expect((await db.select().from(legacyRitualCompiledArchives)).length).toBe(
      6,
    );
  });
  it("binds selection to its exact current revision and own parent at database level", async () => {
    const first = await writer()(save()),
      second = await writer()(save("two"));
    if (!first.ok || !second.ok) throw new Error("Expected saves");
    const a = await current(),
      b = await current(ritualIds.two);
    await expect(
      db
        .update(rituals)
        .set({ currentCompiledArtifactId: b.currentCompiledArtifactId })
        .where(eq(rituals.id, a.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(rituals)
        .set({ currentRevisionId: null })
        .where(eq(rituals.id, a.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(rituals)
        .set({ currentCompiledArtifactId: createUuidV7() })
        .where(eq(rituals.id, a.id)),
    ).rejects.toThrow();
    expect(await current()).toEqual(a);
  });
});
