import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import type {
  PublicationFunction,
  PublicationProps,
} from "gongo-server/lib/publications";
import MongoDatabaseAdapter from "gongo-server-db-mongo";
import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

const publications = vi.hoisted(
  () => new Map<string, PublicationFunction<MongoDatabaseAdapter>>(),
);
vi.mock("@/api-lib/db", async () => ({
  ObjectId: (await vi.importActual<typeof import("mongodb")>("mongodb"))
    .ObjectId,
  default: {
    publish: (
      name: string,
      callback: PublicationFunction<MongoDatabaseAdapter>,
    ) => publications.set(name, callback),
    dba: null,
  },
}));
vi.mock("@/doc/publications", () => ({
  publishRitualCreationGroups: vi.fn(),
  publishRitualDoc: vi.fn(),
  publishRitualDocs: vi.fn(),
  publishRitualRevisions: vi.fn(),
}));

// Register the retired callbacks without importing them into the live route.
await import("@/api-lib/legacyGongoServer");

type Row = Record<string, unknown>;
const requireHere = createRequire(import.meta.url);
const requireClient = createRequire(
  realpathSync(requireHere.resolve("gongo-client/package.json")),
);
const sift = requireClient("sift") as (query: Row) => (row: Row) => boolean;
const oid = (value: number) =>
  new ObjectId(value.toString(16).padStart(24, "0"));
const temple = (value: number) => ({
  _id: oid(value),
  name: "Synthetic temple",
  slug: `synthetic-temple-${value}`,
  joinPass: "synthetic-current-invite",
  _joinPass: "synthetic-legacy-invite",
  createdBy: oid(3),
  __updatedAt: 100,
});

/** Real Gongo collection/cursor/helper backed by in-memory Mongo reads only. */
function setup(data: Record<string, Row[]>, userId: ObjectId | null = oid(1)) {
  const queries: { collection: string; filter: Row }[] = [];
  const db = Object.create(
    MongoDatabaseAdapter.prototype,
  ) as MongoDatabaseAdapter;
  db.collections = {};
  db.dbPromise = Promise.resolve({
    collection(collection: string) {
      return {
        async createIndex() {
          return "synthetic-index";
        },
        async findOne(filter: Row) {
          queries.push({ collection, filter });
          return (data[collection] ?? []).find(sift(filter)) ?? null;
        },
        find(filter: Row) {
          queries.push({ collection, filter });
          let rows = (data[collection] ?? []).filter(sift(filter));
          let projection: Row | null = null;
          const cursor = {
            sort() {
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
  async function publish(name: string, opts: Row = {}) {
    const callback = publications.get(name);
    if (!callback) throw new Error("Expected actual registered publication");
    const props = {
      auth: { userId: async () => userId },
      updatedAt: {},
    } as PublicationProps<MongoDatabaseAdapter>;
    return db.publishHelper(await callback(db, opts, props), props);
  }
  return { publish, queries };
}

function fixture(admin: unknown = false) {
  const data = {
    users: [{ _id: oid(1), admin: false }],
    temples: [temple(10), temple(11)],
    templeMemberships: [
      {
        _id: oid(20),
        userId: oid(1),
        templeId: oid(10),
        grade: 0,
        admin,
        __updatedAt: 90,
      },
      {
        _id: oid(21),
        userId: oid(2),
        templeId: oid(11),
        grade: 1,
        admin: true,
        __updatedAt: 95,
      },
    ],
  };
  return { data, ...setup(data) };
}

describe("actual legacy temple publications", () => {
  it.each([undefined, false, "false", 1])(
    "omits both invite fields for a membership without strict admin=true (%s)",
    async (admin) => {
      const { publish, data } = fixture(admin);
      const results = await publish("userTemplesAndMemberships", {
        admin: true,
        userId: oid(2),
      });
      expect(
        results.find((entry) => entry.coll === "templeMemberships")?.entries,
      ).toEqual([data.templeMemberships[0]]);
      const ordinary = results.find(
        (entry) => entry.coll === "temples",
      )?.entries;
      expect(ordinary).toEqual([
        {
          _id: oid(10),
          name: "Synthetic temple",
          slug: "synthetic-temple-10",
          createdBy: oid(3),
          __updatedAt: 100,
        },
      ]);
      expect(JSON.stringify(results)).not.toContain("synthetic-current-invite");
      expect(JSON.stringify(results)).not.toContain("synthetic-legacy-invite");
      expect(data.temples[0].joinPass).toBe("synthetic-current-invite");
      expect(data.temples[0]._joinPass).toBe("synthetic-legacy-invite");
    },
  );

  it("retains the existing member-admin invite projection and scoped admin sharing paths", async () => {
    const { publish } = fixture(true);
    for (const name of [
      "userTemplesAndMemberships",
      "templesForAdmins",
      "templeForTempleAdmin",
    ]) {
      const results = await publish(name, { _id: oid(10).toHexString() });
      const temples = results.find(
        (entry) => entry.coll === "temples",
      )?.entries;
      expect(temples).toHaveLength(1);
      expect(temples?.[0]).toMatchObject({
        _id: oid(10),
        slug: "synthetic-temple-10",
        joinPass: "synthetic-current-invite",
      });
      // The unchanged admin UI can still derive its copy/share/QR destination.
      expect(
        `/temples/join/${temples?.[0].slug}/${temples?.[0].joinPass}`,
      ).toBe("/temples/join/synthetic-temple-10/synthetic-current-invite");
    }
  });

  it("retains explicit global-admin invite access without adding it to ordinary member projections", async () => {
    const { publish, data } = fixture();
    data.users[0].admin = true;
    const all = await publish("templesForAdmins");
    expect(all[0].entries).toHaveLength(2);
    expect(
      all[0].entries.every(
        (row) => row.joinPass === "synthetic-current-invite",
      ),
    ).toBe(true);
    const specific = await publish("templeForTempleAdmin", {
      _id: oid(11).toHexString(),
    });
    expect(specific[0].entries[0].joinPass).toBe("synthetic-current-invite");
    const ordinary = await publish("userTemplesAndMemberships");
    expect(
      ordinary.find((entry) => entry.coll === "temples")?.entries[0],
    ).not.toHaveProperty("joinPass");
  });

  it("does not permit ordinary members to request admin invite publications", async () => {
    const { publish } = fixture();
    expect(await publish("templesForAdmins", { admin: true })).toEqual([]);
    expect(
      await publish("templeForTempleAdmin", {
        _id: oid(10).toHexString(),
        admin: true,
      }),
    ).toEqual([]);
    expect(
      await publish("templeForTempleAdmin", { _id: oid(11).toHexString() }),
    ).toEqual([]);
  });

  it("returns no temple data anonymously or without a membership", async () => {
    const { data } = fixture();
    const anonymous = setup(data, null);
    for (const name of [
      "userTemplesAndMemberships",
      "templesForAdmins",
      "templeForTempleAdmin",
    ]) {
      expect(
        await anonymous.publish(name, { _id: oid(10).toHexString() }),
      ).toEqual([]);
    }
    expect(anonymous.queries).toEqual([]);
    data.templeMemberships = data.templeMemberships.filter(
      (entry) => !entry.userId.equals(oid(1)),
    );
    const result = await setup(data).publish("userTemplesAndMemberships");
    expect(result.every((entry) => entry.entries.length === 0)).toBe(true);
  });

  it("stops publishing codes on the next ordinary projection after an admin demotion", async () => {
    const { publish, data } = fixture(true);
    expect(
      (await publish("userTemplesAndMemberships"))[1].entries[0].joinPass,
    ).toBe("synthetic-current-invite");
    data.templeMemberships[0].admin = false;
    const after = await publish("userTemplesAndMemberships");
    expect(after[1].entries[0]).not.toHaveProperty("joinPass");
    expect(after[1].entries[0]).not.toHaveProperty("_joinPass");
    expect(
      await publish("templeForTempleAdmin", { _id: oid(10).toHexString() }),
    ).toEqual([]);
  });
});
