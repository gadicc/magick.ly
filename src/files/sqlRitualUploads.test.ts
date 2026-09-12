import { createHash } from "node:crypto";
import { createMemoryPgliteHarness } from "@gadicc/loom/db/testing";
import type { LoomFileCreateInput } from "@gadicc/loom/files";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as baseSchema from "../db/schema/index";
import { ritualFileLinks, ritualUploadIntents } from "../db/schema/ritualFiles";
import { createUuidV7 } from "../lib/ids";
import { createRitualUploadFinalizer } from "./finalizeRitualUpload";
import type {
  RitualUploadClaim,
  ValidatedRitualImage,
} from "./ritualUploadContracts";
import {
  type InitiateRitualUpload,
  RitualUploadError,
} from "./ritualUploadProtocol";
import {
  createSqlRitualUploads,
  RITUAL_UPLOAD_SQL_LIMITS,
  type SqlRitualUploadDatabase,
} from "./sqlRitualUploads";
import { createSharpRitualImageValidator } from "./validateRitualImage";

vi.mock("server-only", () => ({}));
const schema = { ...baseSchema, ritualFileLinks, ritualUploadIntents };
const h = await createMemoryPgliteHarness({ schema });
const queries: string[] = [];
const db = drizzle(h.client, {
  schema,
  logger: { logQuery: (q) => queries.push(q) },
});
afterAll(() => h.client.close());
const {
  user,
  userAccess,
  userGroups,
  userGroupGrants,
  temples,
  templeMemberships,
  rituals,
  loomFilesTable,
} = schema;
const actor = Object.fromEntries(
  ["creator", "global", "groupAdmin", "member", "templeAdmin", "outsider"].map(
    (x) => [x, createUuidV7()],
  ),
);
const group = createUuidV7(),
  temple = createUuidV7(),
  ids = {
    public: createUuidV7(),
    group: createUuidV7(),
    temple: createUuidV7(),
  };
const START = Date.parse("2026-09-12T16:00:00.123Z");
let time = START,
  verified: string | null = actor.creator;
const bytes = await sharp({
  create: { width: 3, height: 2, channels: 4, background: "red" },
})
  .png()
  .toBuffer();
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const request = (
  who = "creator",
  kind: keyof typeof ids = "group",
): InitiateRitualUpload => ({
  version: 1,
  operationId: createUuidV7(),
  expectedActorId: actor[who],
  ritualId: ids[kind],
  filename: "\uFEFF e\u0301 é 🌍\r\n.png ",
  byteSize: bytes.length,
  contentType: "image/png",
  sha256: sha(bytes),
});
const locations = vi.fn(
  ({
    request: r,
    fileId,
  }: {
    request: InitiateRitualUpload;
    fileId: string;
  }) => ({
    staging: {
      provider: "memory",
      bucket: "private",
      objectKey: `staging/${r.operationId}`,
    },
    canonical: {
      provider: "memory",
      bucket: "private",
      objectKey: `canonical/${fileId}/${r.sha256}`,
    },
  }),
);
const service = (
  database: SqlRitualUploadDatabase = db,
  extra: Partial<Parameters<typeof createSqlRitualUploads>[2]> = {},
) =>
  createSqlRitualUploads(database, async () => verified, {
    locations,
    now: () => time,
    ...extra,
  });
const signal = () => new AbortController().signal;
const image: ValidatedRitualImage = {
  contentType: "image/png",
  width: 3,
  frameHeight: 2,
  frames: 1,
  decodedPixels: 6,
};
const file = (c: RitualUploadClaim): LoomFileCreateInput => ({
  audioMeta: null,
  bucket: c.canonical.bucket,
  byteSize: c.request.byteSize,
  contentType: c.request.contentType,
  detectedContentType: c.request.contentType,
  imageMeta: { format: "png", width: 3, height: 2 },
  kind: "image",
  meta: {},
  objectKey: c.canonical.objectKey,
  originalFilename: c.request.filename,
  ownerId: c.request.expectedActorId,
  ownerType: "user",
  sha256: c.request.sha256,
  storageProvider: c.canonical.provider,
  visibility: "private",
});
async function claimed(s = service(), r = request()) {
  await s.initiate(r);
  const state = await s.publication.claimAuthorized(
    { operationId: r.operationId, actorId: r.expectedActorId, nowMs: time },
    signal(),
  );
  expect(state.kind).toBe("claimed");
  if (state.kind !== "claimed") throw Error();
  return state.claim;
}
const commit = (
  s: ReturnType<typeof service>,
  c: RitualUploadClaim,
  controller?: AbortController,
) =>
  s.publication.commitAuthorized(
    { actorId: c.request.expectedActorId, claim: c, file: file(c), image },
    controller?.signal ?? signal(),
  );
async function state() {
  return {
    intents: await db.select().from(ritualUploadIntents),
    files: await db
      .select({
        ...getTableColumns(loomFilesTable),
        originalFilename: sql<
          string | null
        >`to_json(${loomFilesTable.originalFilename})`,
      })
      .from(loomFilesTable),
    links: await db.select().from(ritualFileLinks),
  };
}
beforeEach(async () => {
  await h.client.exec(
    "TRUNCATE TABLE auth_user,loom_files,rituals,user_groups,temples,ritual_upload_intents CASCADE",
  );
  time = START;
  verified = actor.creator;
  locations.mockClear();
  await db.insert(user).values(
    Object.entries(actor).map(([name, id]) => ({
      id,
      name,
      email: name + "@example.test",
    })),
  );
  await db.insert(userAccess).values({ userId: actor.global, admin: true });
  await db.insert(userGroups).values({ id: group, name: "Synthetic group" });
  await db.insert(userGroupGrants).values([
    { userId: actor.groupAdmin, groupId: group, admin: true, member: false },
    { userId: actor.member, groupId: group, member: true },
  ]);
  await db
    .insert(temples)
    .values({ id: temple, name: "Synthetic temple", slug: "synthetic" });
  await db.insert(templeMemberships).values({
    userId: actor.templeAdmin,
    templeId: temple,
    admin: true,
    grade: 0,
    addedAt: new Date(time),
  });
  await db.insert(rituals).values([
    {
      id: ids.public,
      title: "Synthetic public",
      creatorId: actor.creator,
      scope: "public",
    },
    {
      id: ids.group,
      title: "Synthetic group",
      creatorId: actor.creator,
      scope: "group",
      groupId: group,
    },
    {
      id: ids.temple,
      title: "Synthetic temple",
      creatorId: actor.creator,
      scope: "temple",
      templeId: temple,
      minGrade: 2,
    },
  ]);
  queries.length = 0;
});

describe("SQL ritual upload lifecycle", () => {
  it("persists exact immutable identity once, refreshing only transient capability expiry", async () => {
    const s = service(),
      r = request(),
      first = await s.initiate(r);
    expect(first.kind).toBe("initiated");
    if (first.kind !== "initiated") throw Error();
    expect(first.intent.request).toEqual(r);
    expect(first.intent.intentExpiresAtMs).toBe(
      time + RITUAL_UPLOAD_SQL_LIMITS.intentMs,
    );
    expect(first.intent.capabilityExpiresAtMs).toBe(
      time + RITUAL_UPLOAD_SQL_LIMITS.capabilityMs,
    );
    const before = await state();
    time += 1000;
    const second = await s.initiate({ ...r });
    expect(second).toEqual({
      ...first,
      replayed: true,
      intent: {
        ...first.intent,
        capabilityExpiresAtMs: time + RITUAL_UPLOAD_SQL_LIMITS.capabilityMs,
      },
    });
    expect(await state()).toEqual(before);
    expect(locations).toHaveBeenCalledTimes(1);
    expect(queries.some((q) => q.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((q) => q.includes("for share"))).toBe(true);
  });
  it.each([
    ["global", "public", true],
    ["groupAdmin", "group", true],
    ["templeAdmin", "temple", true],
    ["member", "group", false],
    ["outsider", "public", false],
    ["groupAdmin", "temple", false],
  ] as const)(
    "authorizes %s/%s with current shared policy",
    async (who, kind, allowed) => {
      verified = actor[who];
      const s = service(),
        r = request(who, kind);
      if (allowed) expect((await s.initiate(r)).kind).toBe("initiated");
      else
        await expect(s.initiate(r)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
    },
  );
  it.each([null, "invalid", actor.outsider])(
    "rejects unverified or changed actor %s",
    async (who) => {
      verified = who;
      await expect(service().initiate(request())).rejects.toMatchObject({
        code: who === actor.outsider ? "ACTOR_CHANGED" : "AUTH_REQUIRED",
      });
      expect(queries).toHaveLength(0);
    },
  );
  it("rejects missing canonical identities/parents and every changed immutable request", async () => {
    const s = service(),
      r = request();
    await s.initiate(r);
    await expect(
      s.initiate({ ...r, filename: "changed" }),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    verified = actor.outsider;
    await expect(
      s.initiate({ ...r, expectedActorId: verified }),
    ).rejects.toMatchObject({ code: "ACTOR_CHANGED" });
    verified = actor.creator;
    await expect(
      s.initiate({ ...request(), ritualId: createUuidV7() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    verified = createUuidV7();
    await expect(
      s.initiate({ ...request(), expectedActorId: verified }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it("bounds worker claims, rejects busy initiation/finalization and fences stale release and commit", async () => {
    const s = service(),
      c = await claimed(s);
    await expect(s.initiate(c.request)).rejects.toMatchObject({ code: "BUSY" });
    await expect(
      s.publication.claimAuthorized(
        { operationId: c.request.operationId, actorId: verified!, nowMs: 0 },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "BUSY" });
    time = c.claimExpiresAtMs;
    const next = await s.publication.claimAuthorized(
      { operationId: c.request.operationId, actorId: verified!, nowMs: 0 },
      signal(),
    );
    expect(next.kind).toBe("claimed");
    if (next.kind !== "claimed") throw Error();
    expect(next.claim.claimId).not.toBe(c.claimId);
    await s.publication.releaseClaim(c, "TIMEOUT", signal());
    expect((await state()).intents[0].claimId).toBe(next.claim.claimId);
    await expect(commit(s, c)).rejects.toMatchObject({
      code: "OPERATION_CONFLICT",
    });
    await s.publication.releaseClaim(next.claim, "UNAVAILABLE", signal());
    expect((await state()).intents[0].claimId).toBeNull();
  });
  it("never extends fixed intent expiry and clips capability and claim deadlines", async () => {
    const s = service(db, {
        intentDurationMs: 50,
        claimDurationMs: 20,
        capabilityDurationMs: 30,
      }),
      r = request();
    await s.initiate(r);
    time += 40;
    const init = await s.initiate(r);
    expect(init).toMatchObject({
      intent: {
        capabilityExpiresAtMs: START + 50,
        intentExpiresAtMs: START + 50,
      },
    });
    const c = await s.publication.claimAuthorized(
      { operationId: r.operationId, actorId: verified!, nowMs: time + 10_000 },
      signal(),
    );
    expect(c).toMatchObject({ claim: { claimExpiresAtMs: START + 50 } });
    time = START + 50;
    await expect(s.initiate(r)).rejects.toMatchObject({ code: "EXPIRED" });
    await expect(
      s.publication.claimAuthorized(
        { operationId: r.operationId, actorId: verified!, nowMs: 0 },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "EXPIRED" });
    if (c.kind === "claimed")
      await expect(commit(s, c.claim)).rejects.toMatchObject({
        code: "EXPIRED",
      });
    expect((await state()).intents).toHaveLength(1);
  });
  it("publishes file/link/receipt atomically and replays after intent/claim expiry without resurrection", async () => {
    const s = service(),
      c = await claimed(s),
      result = await commit(s, c);
    expect(result.receipt).toMatchObject({
      operationId: c.request.operationId,
      fileId: c.fileId,
      attachmentId: c.attachmentId,
      completedAtMs: time,
    });
    const after = await state();
    expect(after.files).toHaveLength(1);
    expect(after.links).toHaveLength(1);
    expect(after.files[0].originalFilename).toBe(c.request.filename);
    time += 2 * RITUAL_UPLOAD_SQL_LIMITS.intentMs;
    expect(await s.initiate(c.request)).toEqual({
      kind: "completed",
      receipt: result.receipt,
    });
    expect(
      await s.publication.claimAuthorized(
        { operationId: c.request.operationId, actorId: verified!, nowMs: time },
        signal(),
      ),
    ).toEqual({ kind: "completed", receipt: result.receipt });
    expect(await commit(s, c)).toEqual(result);
    expect(await state()).toEqual(after);
  });
  it.each([
    "file-tombstone",
    "link-tombstone",
    "link-missing",
    "file-missing",
    "ritual-missing",
  ])("refuses replay after %s", async (mode) => {
    const s = service(),
      c = await claimed(s);
    await commit(s, c);
    if (mode === "file-tombstone")
      await db
        .update(loomFilesTable)
        .set({ deletedAt: new Date(time) })
        .where(eq(loomFilesTable.id, c.fileId));
    else if (mode === "link-tombstone")
      await db
        .update(ritualFileLinks)
        .set({ deletedAt: new Date(time) })
        .where(eq(ritualFileLinks.id, c.attachmentId));
    else {
      await db
        .delete(ritualFileLinks)
        .where(eq(ritualFileLinks.id, c.attachmentId));
      if (mode === "file-missing")
        await db.delete(loomFilesTable).where(eq(loomFilesTable.id, c.fileId));
      if (mode === "ritual-missing")
        await db.delete(rituals).where(eq(rituals.id, c.request.ritualId));
    }
    const before = await state();
    await expect(s.initiate(c.request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(commit(s, c)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await state()).toEqual(before);
  });
  it.each(["global", "groupAdmin", "templeAdmin"])(
    "checks current %s access at claim, commit and replay",
    async (who) => {
      verified = actor[who];
      const s = service(),
        r = request(
          who,
          who === "templeAdmin"
            ? "temple"
            : who === "global"
              ? "public"
              : "group",
        ),
        c = await claimed(s, r);
      const revoke = () =>
        who === "global"
          ? db
              .update(userAccess)
              .set({ admin: false })
              .where(eq(userAccess.userId, verified!))
          : who === "groupAdmin"
            ? db
                .update(userGroupGrants)
                .set({ admin: false, member: true })
                .where(eq(userGroupGrants.userId, verified!))
            : db
                .update(templeMemberships)
                .set({ admin: false })
                .where(eq(templeMemberships.userId, verified!));
      await revoke();
      await expect(commit(s, c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        s.publication.claimAuthorized(
          {
            operationId: r.operationId,
            actorId: r.expectedActorId,
            nowMs: time,
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await state()).files).toHaveLength(0);
    },
  );
  it("never exposes duplicate owner metadata, including tombstones and a race after claim", async () => {
    const s = service(),
      c = await claimed(s);
    const otherId = createUuidV7();
    await db.insert(loomFilesTable).values({
      ...file(c),
      id: otherId,
      ownerId: actor.outsider,
      deletedAt: new Date(time),
    });
    for (const operation of [
      () => s.initiate({ ...request() }),
      () => s.publication.findBySha256(c.request.sha256, signal()),
      () => commit(s, c),
    ]) {
      let error: unknown;
      try {
        await operation();
      } catch (value) {
        error = value;
      }
      expect(error).toBeInstanceOf(RitualUploadError);
      expect(error).toMatchObject({ code: "DUPLICATE", message: "DUPLICATE" });
      expect(JSON.stringify(error)).not.toContain(otherId);
      expect(JSON.stringify(error)).not.toContain(actor.outsider);
    }
    expect((await state()).links).toHaveLength(0);
  });
  it.each(["precommit", "unknown-ack"])(
    "recovers from %s transaction failures",
    async (mode) => {
      const normal = service(),
        c = await claimed(normal);
      let failOnce = true;
      const faulty: SqlRitualUploadDatabase = {
        transaction: async (work, config) => {
          const value = await db.transaction(async (tx) => {
            const outcome = await work(tx);
            if (mode === "precommit" && failOnce) {
              failOnce = false;
              throw Error("synthetic private SQL fault");
            }
            return outcome;
          }, config);
          if (mode === "unknown-ack" && failOnce) {
            failOnce = false;
            throw Error("synthetic lost ack");
          }
          return value;
        },
      };
      await expect(commit(service(faulty), c)).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
      expect((await state()).files).toHaveLength(mode === "precommit" ? 0 : 1);
      const recovered = await commit(normal, c);
      expect(recovered.receipt.operationId).toBe(c.request.operationId);
      expect((await state()).files).toHaveLength(1);
      expect((await state()).links).toHaveLength(1);
    },
  );
  it.each(["png", "jpeg", "gif", "webp"] as const)(
    "integrates actual Loom/Sharp %s and provider-before-SQL publication",
    async (format) => {
      const media = await sharp({
        create: { width: 3, height: 2, channels: 4, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      const s = service(),
        r = {
          ...request(),
          contentType: `image/${format}` as InitiateRitualUpload["contentType"],
          byteSize: media.length,
          sha256: sha(media),
        };
      await s.initiate(r);
      const put = vi.fn(async () => {
        expect((await state()).files).toHaveLength(0);
      });
      const finalize = createRitualUploadFinalizer({
        readVerifiedActorId: async () => verified,
        publication: s.publication,
        imageValidator: createSharpRitualImageValidator(),
        now: () => time,
        storage: {
          readStaging: async () => ({
            body: media,
            byteSize: media.length,
            close() {},
          }),
          canonicalStorage: (c) => ({
            provider: c.canonical.provider,
            bucket: c.canonical.bucket,
            putObject: async (input) => {
              expect(input.body).toEqual(new Uint8Array(media));
              await put();
              return {
                storageProvider: c.canonical.provider,
                bucket: c.canonical.bucket,
                objectKey: c.canonical.objectKey,
              };
            },
          }),
        },
      });
      const input = {
        version: 1,
        operationId: r.operationId,
        expectedActorId: r.expectedActorId,
      };
      const result = await finalize(input);
      expect(result).toMatchObject({ ok: true, replayed: false });
      expect(put).toHaveBeenCalledTimes(1);
      expect((await state()).files[0]).toMatchObject({
        originalFilename: r.filename,
        ownerType: "user",
        visibility: "private",
        imageMeta: { width: 3, height: 2, format },
      });
      expect(await finalize(input)).toMatchObject({ ok: true, replayed: true });
      expect(put).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "ownerType",
    "ownerId",
    "visibility",
    "originalFilename",
    "objectKey",
    "bucket",
    "storageProvider",
    "sha256",
    "byteSize",
    "contentType",
    "detectedContentType",
    "kind",
    "meta",
    "audioMeta",
    "imageMeta",
  ])("rejects mismatching persisted Loom field %s", async (key) => {
    const s = service(),
      c = await claimed(s),
      f = file(c);
    const changed = {
      ...f,
      [key]:
        key === "byteSize"
          ? f.byteSize + 1
          : key === "meta"
            ? { secret: "not-allowed" }
            : key === "audioMeta"
              ? {}
              : key === "imageMeta"
                ? { format: "png", width: 1, height: 2 }
                : "invalid",
    };
    await expect(
      s.publication.commitAuthorized(
        {
          claim: c,
          actorId: c.request.expectedActorId,
          file: changed as LoomFileCreateInput,
          image,
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await state()).files).toHaveLength(0);
  });
  it.each([
    "claimId",
    "fileId",
    "attachmentId",
    "intentExpiresAtMs",
    "claimExpiresAtMs",
    "request",
    "staging",
    "canonical",
  ])("fences altered claim %s", async (key) => {
    const s = service(),
      c = await claimed(s);
    const changed = {
      ...c,
      [key]:
        key === "request"
          ? { ...c.request, filename: "changed" }
          : key === "staging" || key === "canonical"
            ? { ...c[key], objectKey: "other" }
            : key.endsWith("Ms")
              ? time
              : createUuidV7(),
    };
    await expect(commit(s, changed as RitualUploadClaim)).rejects.toMatchObject(
      { code: "OPERATION_CONFLICT" },
    );
    expect((await state()).files).toHaveLength(0);
  });
  it.each(["width", "frameHeight", "frames", "decodedPixels", "contentType"])(
    "rejects invalid decoder evidence %s",
    async (key) => {
      const s = service(),
        c = await claimed(s);
      await expect(
        s.publication.commitAuthorized(
          {
            claim: c,
            actorId: c.request.expectedActorId,
            file: file(c),
            image: {
              ...image,
              [key]: key === "contentType" ? "image/jpeg" : 0,
            },
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    },
  );
  it("rejects location overlap/collision before capabilities or file publication", async () => {
    const s = service(),
      r = request(),
      result = await s.initiate(r);
    if (result.kind !== "initiated") throw Error();
    await expect(
      service(db, {
        locations: () => ({
          staging: result.intent.canonical,
          canonical: { ...result.intent.canonical, objectKey: "new" },
        }),
      }).initiate(request()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      service(db, {
        locations: () => ({
          staging: result.intent.staging,
          canonical: result.intent.staging,
        }),
      }).initiate(request()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await state()).intents).toHaveLength(1);
  });
  it("checks abort before/inside publication and leaves committed unknown outcomes recoverable", async () => {
    const s = service(),
      c = await claimed(s),
      controller = new AbortController();
    controller.abort();
    await expect(commit(s, c, controller)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect((await state()).files).toHaveLength(0);
    const during = new AbortController();
    const wrap: SqlRitualUploadDatabase = {
      transaction: (work, config) =>
        db.transaction(async (tx) => {
          const result = await work(tx);
          during.abort();
          return result;
        }, config),
    };
    await expect(commit(service(wrap), c, during)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect((await state()).files).toHaveLength(1);
    expect((await commit(s, c)).receipt.operationId).toBe(
      c.request.operationId,
    );
  });
  it.each([
    ["55P03", "BUSY"],
    ["40P01", "BUSY"],
    ["40001", "BUSY"],
    ["57014", "TIMEOUT"],
    ["23505", "DUPLICATE"],
    ["unknown", "UNAVAILABLE"],
  ])("maps safe SQL %s errors", async (code, expected) => {
    const transaction = async () => {
      throw {
        cause: { code, constraint: "loom_files_sha256_unique" },
        message: "synthetic private SQL error",
      };
    };
    await expect(
      service({ transaction }).initiate(request()),
    ).rejects.toMatchObject({ code: expected, message: expected });
  });
  it.each([
    [
      "postgres-js direct",
      { code: "23505", constraint_name: "loom_files_sha256_unique" },
      "DUPLICATE",
    ],
    [
      "postgres-js wrapped by Drizzle",
      { cause: { code: "23505", constraint_name: "loom_files_sha256_unique" } },
      "DUPLICATE",
    ],
    [
      "node-pg direct",
      { code: "23505", constraint: "loom_files_sha256_unique" },
      "DUPLICATE",
    ],
    [
      "unknown postgres-js constraint",
      {
        cause: { code: "23505", constraint_name: "another_unique_constraint" },
      },
      "UNAVAILABLE",
    ],
    [
      "unknown node-pg constraint",
      { code: "23505", constraint: "another_unique_constraint" },
      "UNAVAILABLE",
    ],
    ["missing constraint", { cause: { code: "23505" } }, "UNAVAILABLE"],
    [
      "outer constraint cannot label an unrelated cause",
      {
        constraint: "loom_files_sha256_unique",
        cause: { code: "23505", constraint_name: "another_unique_constraint" },
      },
      "UNAVAILABLE",
    ],
    [
      "outer code cannot label a cause without a code",
      { code: "23505", cause: { constraint_name: "loom_files_sha256_unique" } },
      "UNAVAILABLE",
    ],
  ])(
    "maps %s using the constraint from the same driver error",
    async (_label, error, expected) => {
      const transaction = async () => {
        throw error;
      };
      await expect(
        service({ transaction }).initiate(request()),
      ).rejects.toMatchObject({ code: expected, message: expected });
    },
  );
  it.each([0, -1, NaN, Infinity, RITUAL_UPLOAD_SQL_LIMITS.intentMs + 1])(
    "rejects invalid configured duration %s",
    (intentDurationMs) =>
      expect(() => service(db, { intentDurationMs })).toThrow(RangeError),
  );
  it("rejects malformed input before touching SQL and checks invalid worker timestamps", async () => {
    const s = service();
    await expect(s.initiate({})).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      s.publication.claimAuthorized(
        { operationId: "bad", actorId: actor.creator, nowMs: time },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      s.publication.claimAuthorized(
        { operationId: createUuidV7(), actorId: actor.creator, nowMs: NaN },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      s.publication.findBySha256("bad", signal()),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(queries).toHaveLength(0);
  });
  it("schema rejects malformed claim/completion and mismatched link binding atomically", async () => {
    const s = service(),
      c = await claimed(s),
      before = await state();
    await expect(
      db
        .update(ritualUploadIntents)
        .set({ claimExpiresAt: null })
        .where(eq(ritualUploadIntents.operationId, c.request.operationId)),
    ).rejects.toThrow();
    expect(await state()).toEqual(before);
    await expect(
      db
        .update(ritualUploadIntents)
        .set({ completedAt: new Date(c.claimExpiresAtMs) })
        .where(eq(ritualUploadIntents.operationId, c.request.operationId)),
    ).rejects.toThrow();
    expect(await state()).toEqual(before);
    await commit(s, c);
    await expect(
      db
        .update(ritualFileLinks)
        .set({ ritualId: ids.public })
        .where(eq(ritualFileLinks.id, c.attachmentId)),
    ).rejects.toThrow();
  });
});

describe("SQL upload boundary failure and timing", () => {
  it.each(["extra", "invalid-location"])(
    "rejects malformed claim %s before writing",
    async (mode) => {
      const s = service(),
        c = await claimed(s),
        changed =
          mode === "extra"
            ? { ...c, extra: true }
            : { ...c, staging: { ...c.staging, objectKey: "" } };
      await expect(commit(s, changed)).rejects.toMatchObject({
        code: "OPERATION_CONFLICT",
      });
      expect((await state()).files).toHaveLength(0);
    },
  );
  it("refuses a completed receipt when file metadata no longer matches the immutable intent", async () => {
    const s = service(),
      c = await claimed(s);
    await commit(s, c);
    await db
      .update(loomFilesTable)
      .set({ visibility: "public" })
      .where(eq(loomFilesTable.id, c.fileId));
    const before = await state();
    await expect(s.initiate(c.request)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(await state()).toEqual(before);
  });
  it.each(["backwards", "intent", "capability"])(
    "never issues already expired capability after %s preparation",
    async (mode) => {
      let tick = 0;
      const s = service(db, {
        now: () =>
          tick++ === 0
            ? START
            : mode === "backwards"
              ? START - 1
              : START +
                (mode === "intent"
                  ? RITUAL_UPLOAD_SQL_LIMITS.intentMs
                  : RITUAL_UPLOAD_SQL_LIMITS.capabilityMs),
      });
      await expect(s.initiate(request())).rejects.toMatchObject({
        code: mode === "capability" ? "TIMEOUT" : "EXPIRED",
      });
      expect((await state()).intents).toHaveLength(0);
    },
  );
  it.each(["backwards", "claim", "intent"])(
    "rolls back inserted file/link if %s timing fails before completion",
    async (mode) => {
      const normal = service(),
        c = await claimed(normal);
      let tick = 0;
      const s = service(db, {
        now: () =>
          tick++ === 0
            ? START
            : mode === "backwards"
              ? START - 1
              : mode === "claim"
                ? c.claimExpiresAtMs
                : c.intentExpiresAtMs,
      });
      const before = await state();
      await expect(commit(s, c)).rejects.toMatchObject({ code: "EXPIRED" });
      expect(await state()).toEqual(before);
    },
  );
  it("rejects invalid/backwards server time instead of borrowing input nowMs", async () => {
    await expect(
      service(db, { now: () => NaN }).initiate(request()),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const s = service(),
      c = await claimed(s);
    time = START - 1;
    await expect(s.initiate(c.request)).rejects.toMatchObject({
      code: "EXPIRED",
    });
    await expect(
      s.publication.claimAuthorized(
        {
          operationId: c.request.operationId,
          actorId: c.request.expectedActorId,
          nowMs: START + 1,
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });
  it("requires an existing operation for claim and does not turn a forged callback into initiation", async () => {
    const s = service(),
      r = request();
    await expect(
      s.publication.claimAuthorized(
        { operationId: r.operationId, actorId: r.expectedActorId, nowMs: time },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      s.publication.commitAuthorized(
        {
          actorId: r.expectedActorId,
          claim: {} as RitualUploadClaim,
          file: {} as LoomFileCreateInput,
          image,
        },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await state()).intents).toHaveLength(0);
  });
  it("detects stored request tampering and keeps all publication data absent", async () => {
    const s = service(),
      r = request();
    await s.initiate(r);
    await db
      .update(ritualUploadIntents)
      .set({ filename: "tampered" })
      .where(eq(ritualUploadIntents.operationId, r.operationId));
    await expect(
      s.publication.claimAuthorized(
        { operationId: r.operationId, actorId: r.expectedActorId, nowMs: time },
        signal(),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await state()).files).toHaveLength(0);
  });
});

describe("completed upload and worker fencing", () => {
  it.each(["global", "groupAdmin", "templeAdmin"])(
    "does not replay completed %s upload after revocation",
    async (who) => {
      verified = actor[who];
      const s = service(),
        r = request(
          who,
          who === "templeAdmin"
            ? "temple"
            : who === "global"
              ? "public"
              : "group",
        ),
        c = await claimed(s, r);
      await commit(s, c);
      if (who === "global")
        await db
          .update(userAccess)
          .set({ admin: false })
          .where(eq(userAccess.userId, verified));
      else if (who === "groupAdmin")
        await db
          .update(userGroupGrants)
          .set({ admin: false, member: true })
          .where(eq(userGroupGrants.userId, verified));
      else
        await db
          .update(templeMemberships)
          .set({ admin: false })
          .where(eq(templeMemberships.userId, verified));
      const before = await state();
      await expect(s.initiate(r)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        s.publication.claimAuthorized(
          {
            operationId: r.operationId,
            actorId: r.expectedActorId,
            nowMs: time,
          },
          signal(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(commit(s, c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await state()).toEqual(before);
    },
  );
  it("reverifies actor at publication and refuses clock rollback before the actual claim start", async () => {
    const s = service(),
      r = request();
    await s.initiate(r);
    time += 1000;
    const result = await s.publication.claimAuthorized(
      { operationId: r.operationId, actorId: r.expectedActorId, nowMs: time },
      signal(),
    );
    if (result.kind !== "claimed") throw Error();
    verified = actor.outsider;
    await expect(commit(s, result.claim)).rejects.toMatchObject({
      code: "ACTOR_CHANGED",
    });
    verified = actor.creator;
    time -= 1;
    await expect(commit(s, result.claim)).rejects.toMatchObject({
      code: "EXPIRED",
    });
    expect((await state()).files).toHaveLength(0);
  });
  it("the schema caps a worker lease at120s and requires all claim timing fields together", async () => {
    const s = service(),
      c = await claimed(s),
      before = await state();
    await expect(
      db
        .update(ritualUploadIntents)
        .set({ claimExpiresAt: new Date(c.claimExpiresAtMs + 1) })
        .where(eq(ritualUploadIntents.operationId, c.request.operationId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(ritualUploadIntents)
        .set({ claimStartedAt: null })
        .where(eq(ritualUploadIntents.operationId, c.request.operationId)),
    ).rejects.toThrow();
    expect(await state()).toEqual(before);
  });
});
