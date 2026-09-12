import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import MongoDatabaseAdapter from "gongo-server-db-mongo";
import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { loadRitualSnapshot } from "./drafts";
import { legacyRitualId } from "./legacyAccess";
import {
  publishRitualCreationGroups,
  publishRitualDoc,
  publishRitualDocs,
  publishRitualRevisions,
} from "./publications";

type Row = Record<string, unknown>;
type Props = Parameters<typeof publishRitualDocs>[2];
const resolveHere = createRequire(import.meta.url);
const require = createRequire(
  realpathSync(resolveHere.resolve("gongo-client/package.json")),
);
const sift = require("sift") as (query: Row) => (row: Row) => boolean;
const id = (n: number) => n.toString(16).padStart(24, "0");
const oid = (n: number) => new ObjectId(id(n));
const user = (extra: Row = {}) => ({ _id: oid(1), ...extra });
const ritual = (extra: Row = {}) => ({
  _id: oid(10),
  userId: oid(2),
  title: "Synthetic ritual",
  doc: {
    type: "root",
    children: [
      { type: "text", value: "Readable words" },
      { type: "img", src: "/synthetic.png", text: "Caption" },
    ],
  },
  __updatedAt: 10,
  ...extra,
});

/** Real Gongo cursor/helper with an in-memory Mongo boundary; no client connects. */
function setup(
  data: Record<string, Row[]>,
  userId: unknown = id(1),
  overrides: Partial<Props> = {},
) {
  const queries: { coll: string; filter: Row }[] = [];
  const db = Object.create(
    MongoDatabaseAdapter.prototype,
  ) as MongoDatabaseAdapter;
  db.collections = {};
  db.dbPromise = Promise.resolve({
    collection(coll: string) {
      return {
        find(filter: Row) {
          queries.push({ coll, filter });
          let rows = (data[coll] ?? []).filter(sift(filter));
          let projection: Row | null = null;
          const cursor = {
            sort(key: string, direction: "asc" | "desc") {
              const sign = direction === "desc" ? -1 : 1;
              rows = [...rows].sort((a, b) =>
                a[key] === b[key]
                  ? 0
                  : (a[key] as number | string) < (b[key] as number | string)
                    ? -sign
                    : sign,
              );
              return cursor;
            },
            limit(count: number) {
              rows = rows.slice(0, count);
              return cursor;
            },
            project(fields: Row) {
              projection = fields;
              return cursor;
            },
            async toArray() {
              return rows.map((row) =>
                projection
                  ? Object.fromEntries(
                      Object.keys(projection)
                        .filter(
                          (key) => projection?.[key] && Object.hasOwn(row, key),
                        )
                        .map((key) => [key, row[key]]),
                    )
                  : { ...row },
              );
            },
          };
          return cursor;
        },
      };
    },
  } as unknown as Awaited<MongoDatabaseAdapter["dbPromise"]>);
  const props: Props = {
    auth: { userId: vi.fn(async () => userId) } as unknown as Props["auth"],
    updatedAt: {},
    ...overrides,
  };
  return { db, props, queries, data };
}

async function resultIds(
  result: Awaited<ReturnType<typeof publishRitualDocs>>,
) {
  return result.flatMap((group) =>
    group.entries.map((row) => legacyRitualId(row._id)),
  );
}

describe("ritual publications", () => {
  it("allows anonymous public list/detail, excluding source fields and editor pointers", async () => {
    const row = ritual({
      text: "SOURCE",
      src: "PUG SOURCE",
      source: "SOURCE",
      revisions: [{ text: "HISTORY" }],
      docRevisionId: oid(20),
      arbitrarySecret: true,
      canEdit: true,
    });
    const { db, props, queries } = setup({ docs: [row] }, null);
    for (const result of [
      await publishRitualDocs(db, {}, props),
      await publishRitualDoc(db, { _id: id(10) }, props),
    ]) {
      expect(result).toEqual([
        {
          coll: "docs",
          entries: [
            {
              _id: oid(10),
              userId: oid(2),
              title: row.title,
              doc: row.doc,
              __updatedAt: 10,
              canEdit: false,
            },
          ],
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("SOURCE");
      expect(JSON.stringify(result)).not.toContain("HISTORY");
      expect(result[0].entries[0].doc).toEqual(row.doc);
    }
    expect(queries.some((query) => query.coll === "users")).toBe(false);
    expect(await publishRitualRevisions(db, { docId: id(10) }, props)).toEqual(
      [],
    );
  });

  it.each([
    [
      "ordinary group reader",
      { groupIds: [id(30)] },
      [],
      { groupId: oid(30) },
      true,
      false,
    ],
    [
      "unrelated group",
      { groupIds: [id(31)] },
      [],
      { groupId: oid(30) },
      false,
      false,
    ],
    [
      "matching group admin",
      { groupAdminIds: [oid(30)] },
      [],
      { groupId: id(30) },
      true,
      true,
    ],
    [
      "unrelated group admin",
      { groupAdminIds: [oid(31)] },
      [],
      { groupId: oid(30) },
      false,
      false,
    ],
    [
      "temple grade below",
      {},
      [{ userId: oid(1), templeId: id(40), grade: 1 }],
      { templeId: oid(40), minGrade: 2 },
      false,
      false,
    ],
    [
      "temple grade equal",
      {},
      [{ userId: id(1), templeId: oid(40), grade: 2 }],
      { templeId: id(40), minGrade: 2 },
      true,
      false,
    ],
    [
      "temple grade zero",
      {},
      [{ userId: oid(1), templeId: oid(40), grade: 0 }],
      { templeId: oid(40), minGrade: 0 },
      true,
      false,
    ],
    [
      "invalid ordinary grade",
      {},
      [{ userId: oid(1), templeId: oid(40), grade: "2" }],
      { templeId: oid(40), minGrade: 1 },
      false,
      false,
    ],
    [
      "matching temple admin",
      {},
      [{ userId: oid(1), templeId: oid(40), grade: 0, admin: true }],
      { templeId: oid(40), minGrade: 9 },
      true,
      true,
    ],
    [
      "unrelated temple admin",
      {},
      [{ userId: oid(1), templeId: oid(41), admin: true }],
      { templeId: oid(40) },
      false,
      false,
    ],
    [
      "creator",
      {},
      [],
      { templeId: oid(40), minGrade: 9, userId: id(1) },
      true,
      true,
    ],
    [
      "global admin",
      { admin: true },
      [],
      { templeId: oid(40), minGrade: 9 },
      true,
      true,
    ],
  ] as const)(
    "uses identical list/detail/history policy for %s",
    async (_name, extraUser, memberships, scope, read, editor) => {
      const row = ritual({
        ...scope,
        docRevisionId: oid(20),
        source: "HIDDEN",
      });
      const history = {
        _id: oid(20),
        docId: id(10),
        userId: oid(2),
        text: "History source",
        __updatedAt: 11,
      };
      const { db, props } = setup({
        users: [user(extraUser)],
        templeMemberships: [...memberships],
        docs: [row],
        docRevisions: [history],
      });
      const list = await publishRitualDocs(db, {}, props);
      const detail = await publishRitualDoc(db, { _id: id(10) }, props);
      expect(await resultIds(list)).toEqual(read ? [id(10)] : []);
      expect(await resultIds(detail)).toEqual(read ? [id(10)] : []);
      expect(
        await resultIds(
          await publishRitualRevisions(db, { docId: id(10) }, props),
        ),
      ).toEqual(editor ? [id(20)] : []);
      if (read) {
        expect(detail[0].entries[0].canEdit).toBe(editor);
        expect(list[0].entries[0].canEdit).toBe(editor);
        expect(detail[0].entries[0]).not.toHaveProperty("source");
        expect(Object.hasOwn(detail[0].entries[0], "docRevisionId")).toBe(
          editor,
        );
      }
    },
  );

  it.each([
    { groupId: oid(30), templeId: oid(40) },
    { groupId: null },
    { templeId: "bad" },
    { templeId: oid(40), minGrade: -1 },
    { templeId: oid(40), minGrade: "0" },
    { userId: { toString: () => id(1) } },
  ])(
    "fails closed for malformed/mixed policy %j even for admins",
    async (scope) => {
      const { db, props } = setup({
        users: [user({ admin: true })],
        docs: [ritual(scope)],
      });
      expect(await publishRitualDocs(db, {}, props)).toEqual([]);
      expect(await publishRitualDoc(db, { _id: id(10) }, props)).toEqual([]);
      expect(
        await publishRitualRevisions(db, { docId: id(10) }, props),
      ).toEqual([]);
    },
  );

  it.each(
    [
      undefined,
      null,
      [],
      {},
      { _id: "bad" },
      { _id: { $ne: null } },
      { _id: { toString: () => id(10) } },
    ].map((opts) => ({ opts })),
  )(
    "rejects malformed detail IDs without database queries",
    async ({ opts }) => {
      const { db, props, queries } = setup({ docs: [ritual()] });
      expect(await publishRitualDoc(db, opts, props)).toEqual([]);
      expect(queries).toEqual([]);
    },
  );

  it("does not accept grants from unrelated users, deleted grants, or client opts", async () => {
    const { db, props } = setup({
      users: [user()],
      docs: [ritual({ templeId: oid(40) })],
      templeMemberships: [
        { userId: oid(2), templeId: oid(40), admin: true },
        { userId: oid(1), templeId: oid(40), admin: true, __deleted: true },
      ],
    });
    expect(
      await publishRitualDocs(db, { admin: true, groupIds: [id(30)] }, props),
    ).toEqual([]);
    expect(
      await publishRitualDoc(
        db,
        { _id: id(10), admin: true, userId: id(2) },
        props,
      ),
    ).toEqual([]);
  });

  it("normalizes real ObjectIds and mixed-case strings only in known references", async () => {
    const high = "abcdefabcdefabcdefabcdef";
    const row = ritual({
      _id: high.toUpperCase(),
      userId: high,
      groupId: new ObjectId(high),
      doc: {
        type: "custom",
        arbitraryId: high.toUpperCase(),
        src: "/asset.png",
        text: "literal",
      },
    });
    const { db, props } = setup(
      {
        users: [{ _id: new ObjectId(high), groupIds: [high.toUpperCase()] }],
        docs: [row],
      },
      high,
    );
    const detail = await publishRitualDoc(
      db,
      { _id: new ObjectId(high) },
      props,
    );
    expect(detail[0].entries[0]._id).toEqual(new ObjectId(high));
    expect(detail[0].entries[0].doc).toEqual(row.doc);
  });

  it("binds history to its own live parent, never to an attached foreign pointer", async () => {
    const { db, props } = setup({
      users: [user()],
      docs: [
        ritual({ userId: oid(1), docRevisionId: oid(21) }),
        ritual({ _id: oid(11), templeId: oid(40) }),
      ],
      docRevisions: [
        {
          _id: oid(20),
          docId: id(10),
          userId: oid(1),
          text: "Own history",
          __updatedAt: 12,
          sourceMap: "PRIVATE EXTRA",
        },
        {
          _id: oid(21),
          docId: oid(11),
          userId: oid(1),
          text: "Other ritual history",
          __updatedAt: 13,
        },
        { _id: oid(22), docId: "invalid", text: "Invalid parent" },
      ],
    });
    const history = await publishRitualRevisions(
      db,
      { docId: id(10), _id: id(21) },
      props,
    );
    expect(await resultIds(history)).toEqual([id(20)]);
    expect(history[0].entries[0]).not.toHaveProperty("sourceMap");
    expect(await publishRitualRevisions(db, { docId: id(11) }, props)).toEqual(
      [],
    );
  });

  it("rejects ambiguous user aliases and missing/deleted user identities", async () => {
    for (const users of [
      [],
      [user({ __deleted: true, admin: true })],
      [user({ admin: true }), user({ _id: id(1) })],
    ]) {
      const { db, props } = setup({
        users,
        docs: [ritual({ templeId: oid(40) })],
      });
      expect(await publishRitualDocs(db, {}, props)).toEqual([]);
    }
  });

  it("does not choose between ambiguous ritual identities or publish deleted parent history", async () => {
    const { db, props, data, queries } = setup({
      users: [user({ admin: true })],
      docs: [ritual(), ritual({ _id: id(10), templeId: oid(40) })],
      docRevisions: [{ _id: oid(20), docId: oid(10), text: "History" }],
    });
    expect(await publishRitualDocs(db, {}, props)).toEqual([]);
    expect(await publishRitualDoc(db, { _id: id(10) }, props)).toEqual([]);
    expect(await publishRitualRevisions(db, { docId: id(10) }, props)).toEqual(
      [],
    );
    data.docs = [ritual({ __deleted: true, templeId: oid(40) })];
    expect(await publishRitualRevisions(db, { docId: id(10) }, props)).toEqual(
      [],
    );
    expect(queries.some((query) => query.coll === "docRevisions")).toBe(false);
  });

  it("rechecks live grants and never emits synthetic timestamp revocation entries", async () => {
    const data = {
      users: [user({ groupIds: [oid(30)] })],
      docs: [ritual({ groupId: oid(30), __updatedAt: 10 })],
    };
    const { db, props } = setup(data);
    expect(await resultIds(await publishRitualDocs(db, {}, props))).toEqual([
      id(10),
    ]);
    data.users[0] = user();
    expect(await publishRitualDocs(db, {}, props)).toEqual([]);
    data.users[0] = user({ groupIds: [oid(30)] });
    // Regrant returns the unchanged authorized record even with its old watermark.
    // Revocation above still emits nothing; that is not a client cache deletion.
    const restored = await publishRitualDocs(
      db,
      {},
      { ...props, updatedAt: { docs: 10 } },
    );
    expect(await resultIds(restored)).toEqual([id(10)]);
    expect(restored[0].entries[0].__updatedAt).toBe(10);
    expect(await resultIds(await publishRitualDocs(db, {}, props))).toEqual([
      id(10),
    ]);
  });

  it("returns every authorized ritual with real metadata despite legacy watermark/sort/limit arguments", async () => {
    const docs = Array.from({ length: 205 }, (_, n) =>
      ritual({ _id: oid(100 + n), __updatedAt: 100 + n }),
    );
    docs.unshift(
      ritual({ _id: oid(999), templeId: oid(40), __updatedAt: 101 }),
    );
    docs.reverse();
    const { db, props } = setup({ docs }, null, {
      updatedAt: { docs: 99999 },
      limit: 1,
      sort: ["__updatedAt", "desc"],
      lastSortedValue: 99999,
    });
    const result = await publishRitualDocs(db, {}, props);
    expect(result[0].entries).toHaveLength(205);
    expect(await resultIds(result)).not.toContain(id(999));
    expect(
      result[0].entries
        .map((row) => row.__updatedAt)
        .sort((a, b) => Number(a) - Number(b)),
    ).toEqual(Array.from({ length: 205 }, (_, n) => 100 + n));
    // Installed Gongo treats an array publication as final; it does not reapply its cursor cap.
    expect(
      await db.publishHelper(
        result,
        props as Parameters<typeof db.publishHelper>[1],
      ),
    ).toBe(result);
  });

  it("ignores first-page pagination options, including a cursor without a sort", async () => {
    const { db, props } = setup(
      {
        docs: [
          ritual({ _id: oid(10), title: "A" }),
          ritual({ _id: oid(11), title: "C" }),
          ritual({ _id: oid(12), title: "B" }),
        ],
      },
      null,
      { sort: ["title", "asc"], limit: 1, lastSortedValue: "A" },
    );
    expect(await resultIds(await publishRitualDocs(db, {}, props))).toEqual([
      id(10),
      id(11),
      id(12),
    ]);
    expect(
      await resultIds(
        await publishRitualDocs(db, {}, { ...props, sort: undefined }),
      ),
    ).toEqual([id(10), id(11), id(12)]);
  });

  it("returns complete authorized history and loads the current revision beyond the old 200-row cap", async () => {
    const currentId = id(224);
    const { db, props } = setup(
      {
        users: [user({ admin: true })],
        docs: [ritual({ docRevisionId: oid(224) })],
        docRevisions: [
          ...Array.from({ length: 205 }, (_, n) => ({
            _id: oid(20 + n),
            docId: oid(10),
            text: `Revision ${n}`,
            __updatedAt: 10 + n,
          })),
          {
            _id: oid(999),
            docId: oid(11),
            text: "Foreign source",
            __updatedAt: 99999,
          },
        ],
      },
      id(1),
      {
        updatedAt: { docs: 99999, docRevisions: 99999 },
        limit: 1,
        sort: ["__updatedAt", "desc"],
        lastSortedValue: 99999,
      },
    );
    expect(
      await resultIds(await publishRitualDoc(db, { _id: id(10) }, props)),
    ).toEqual([id(10)]);
    const history = await publishRitualRevisions(db, { docId: id(10) }, props);
    expect(history[0].entries).toHaveLength(205);
    expect(await resultIds(history)).toContain(currentId);
    expect(JSON.stringify(history)).not.toContain("Foreign source");
    const snapshot = await loadRitualSnapshot(
      async (_name, input) => ({
        results:
          "name" in input && input.name === "doc"
            ? await publishRitualDoc(db, { _id: id(10) }, props)
            : await publishRitualRevisions(db, { docId: id(10) }, props),
      }),
      id(10),
    );
    expect(snapshot).toEqual({
      docId: id(10),
      revisionId: currentId,
      updatedAt: 10,
      source: "Revision 204",
    });
  });

  it("only delivers tombstones with a retained authorized scope or exact authorized parent", async () => {
    const { db, props } = setup({
      users: [user({ groupIds: [oid(30)] })],
      docs: [
        ritual({ userId: oid(1) }),
        {
          _id: oid(11),
          groupId: oid(30),
          __deleted: true,
          __updatedAt: 12,
          text: "DO NOT SEND",
        },
        { _id: oid(12), __deleted: true, __updatedAt: 13 },
        { _id: oid(13), groupId: oid(31), __deleted: true, __updatedAt: 14 },
      ],
      docRevisions: [
        {
          _id: oid(20),
          docId: oid(10),
          __deleted: true,
          __updatedAt: 15,
          text: "DO NOT SEND",
        },
        { _id: oid(21), __deleted: true, __updatedAt: 16 },
      ],
    });
    const list = await publishRitualDocs(db, {}, props);
    expect(await resultIds(list)).toEqual([id(10), id(11)]);
    expect(list[0].entries[1]).toEqual({
      _id: oid(11),
      __deleted: true,
      __updatedAt: 12,
    });
    expect(await publishRitualDoc(db, { _id: id(12) }, props)).toEqual([]);
    const history = await publishRitualRevisions(db, { docId: id(10) }, props);
    expect(history).toEqual([
      {
        coll: "docRevisions",
        entries: [{ _id: oid(20), __deleted: true, __updatedAt: 15 }],
      },
    ]);
  });
});

describe("ritual creation group choices", () => {
  async function groups(data: Record<string, Row[]>, actor: unknown = id(1)) {
    const env = setup(data, actor);
    const result = await publishRitualCreationGroups(env.db, {}, env.props);
    return {
      ...env,
      rows: Array.isArray(result) ? result : await result.toArray(),
    };
  }

  it("returns all groups to a current global admin using the installed Gongo cursor", async () => {
    const all = [
      { _id: oid(30), name: "First" },
      { _id: oid(31), name: "Second" },
    ];
    expect(
      (await groups({ users: [user({ admin: true })], userGroups: all })).rows,
    ).toEqual(all);
  });

  it("constructs real driver ObjectIds only for validated group-admin references", async () => {
    const all = [30, 31, 32].map((n) => ({ _id: oid(n), name: `Group ${n}` }));
    const { rows, queries } = await groups({
      users: [
        user({
          groupAdminIds: [
            id(30).toUpperCase(),
            oid(31),
            "bad",
            30,
            { toHexString: () => id(32) },
          ],
          groupIds: [oid(32)],
        }),
      ],
      userGroups: all,
    });
    expect(rows).toEqual(all.slice(0, 2));
    const query = queries.find((query) => query.coll === "userGroups")?.filter;
    expect(query).toEqual({ _id: { $in: [oid(30), oid(31)] } });
    expect(
      (query?._id as { $in: unknown[] }).$in.every(
        (value) => value instanceof ObjectId,
      ),
    ).toBe(true);
  });

  it.each([undefined, null, "not-an-array", ["bad", null, {}]])(
    "does not query groups for malformed grants %j",
    async (groupAdminIds) => {
      const { rows, queries } = await groups({
        users: [user({ admin: "true", groupAdminIds, groupIds: [oid(30)] })],
        userGroups: [{ _id: oid(30) }],
      });
      expect(rows).toEqual([]);
      expect(queries.some((query) => query.coll === "userGroups")).toBe(false);
    },
  );

  it("rejects an absent identity and ambiguous typed user aliases", async () => {
    const data = {
      users: [user({ admin: true }), { _id: id(1), admin: true }],
      userGroups: [{ _id: oid(30) }],
    };
    expect((await groups(data, null)).rows).toEqual([]);
    expect((await groups(data)).rows).toEqual([]);
  });
});
