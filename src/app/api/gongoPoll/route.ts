import type { Filter, Document } from "mongodb";
import {
  CollectionEventProps,
  userIsAdmin,
  userIdMatches,
} from "gongo-server-db-mongo/lib/collection";
import gs, { ObjectId /* User */ } from "@/api-lib/db";
import { ChangeSetUpdate } from "gongo-server/lib/DatabaseAdapter";
import { auth } from "@/auth";

// TODO, later... with separate db.ts and db-full.ts and mongodb-rest-relay.
// export const runtime = "edge";

// gs.db.Users.ensureAdmin("dragon@wastelands.net", "initialPassword");

gs.publish("studySet", async (db, _opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const cursor = db
    .collection("studySet")
    .find({ userId: new ObjectId(userId) });

  const results = await cursor.toArray();
  console.log({ results });

  return cursor;
});

gs.publish("docs", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  const user =
    userId && (await db.collection("users").findOne({ _id: userId }));

  const templeMemberships =
    userId &&
    (await db.collection("templeMemberships").find({ userId }).toArray());
  const templeIds = templeMemberships?.map((tm) => tm.templeId);

  const query = {
    $or: [{ groupId: { $exists: false }, templeId: { $exists: false } }],
  } as Filter<Document>;

  if (user?.groupIds) query.$or?.push({ groupId: { $in: user.groupIds } });

  // TODO, minGrade check.
  if (templeIds) query.$or?.push({ templeId: { $in: templeIds } });

  console.log(JSON.stringify(query, null, 2));
  return db.collection("docs").find(query);
});

// TODO, don't publish secrets :)
// gs.publish("accounts", (db) => db.collection("accounts").find());
gs.publish("accounts", (db) => []);

gs.publish("files", (db) => db.collection("files").find());

/*
gs.publish("file", async (db, opts) => {
  // TODO, filter opts for sourceUrl, sha256, filename, etc
  //return db.collection("files").find(opts).limit(1);   TODO gongo-server
  const file = await db.collection("files").findOne(opts);
  return [{ coll: "files", entries: [file] }];
});
*/

gs.publish("user", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const fullUser = await db.collection("users").findOne({ _id: userId });
  const user = { ...fullUser };
  delete user.services;
  delete user.password;

  return [
    {
      coll: "users",
      entries: [user],
    },
  ];
});

gs.publish("users", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const user = await db.collection("users").findOne({ _id: userId });
  if (!user?.admin) return [];

  const query = {};
  const realUsers = await db.collection("users").getReal();
  const users = await realUsers
    .find(query, {
      projection: {
        _id: true,
        emails: true,
        displayName: true,
        admin: true,
        groupIds: true,
        groupAdminIds: true,
        __updatedAt: true,
      },
    })
    .toArray();

  return users.length
    ? [
        {
          coll: "users",
          entries: users,
        },
      ]
    : [];
});

gs.publish("userGroups", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const user = await db.collection("users").findOne({ _id: userId });

  if (user?.admin) return db.collection("userGroups").find();

  if (user?.groupAdminIds)
    return db
      .collection("userGroups")
      .find({ _id: { $in: user.groupAdminIds.map(ObjectId) } });
  else return [];

  if (!user?.admin) return [];
});

gs.publish("doc", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const _idStr = opts && opts._id;
  const user = await db.collection("users").findOne({ _id: userId });
  const doc = await db
    .collection("docs")
    .findOne({ _id: new ObjectId(_idStr) });
  if (!doc) return [];

  const membership = await db.collection("templeMemberships").findOne({
    userId,
    templeId: doc.templeId,
  });

  if (
    user?.admin ||
    membership?.admin ||
    (!doc.groupId && !doc.templeId) ||
    user?.groupIds.includes(doc.groupId)
  ) {
    return [
      {
        coll: "docs",
        entries: [doc],
      },
    ];
  }

  return [];
});
gs.publish("docRevisions", async (db, { docId: docIdStr }, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const docId = new ObjectId(docIdStr);

  const doc = await db.collection("docs").findOne({ _id: docId });
  if (!doc) return [];

  const membership = await db.collection("templeMemberships").findOne({
    userId,
    templeId: doc.templeId,
  });

  if (!membership?.admin) return [];
  return db.collection("docRevisions").find({ docId });
});

async function templeAdminHelper(auth, db, templeIdStr) {
  const userId = await auth.userId();
  if (!userId) return { userId, isTempleAdmin: false };

  const templeId = new ObjectId(templeIdStr);

  const membership = await db.collection("templeMemberships").findOne({
    userId,
    templeId,
  });
  let isTempleAdmin = membership?.admin || false;

  if (!isTempleAdmin) {
    const user = await db.collection("users").findOne({ _id: userId });
    if (user.admin) isTempleAdmin = true;
  }

  return { userId, isTempleAdmin, templeId };
}

gs.publish("templesForAdmins", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const user = await db.collection("users").findOne({ _id: userId });
  if (user?.admin) return db.collection("temples").find();

  const templeIds = (
    await db
      .collection("templeMemberships")
      .find({ userId, admin: true })
      .project({ templeId: true })
      .toArray()
  ).map((tm) => tm.templeId);

  return db.collection("temples").find({ _id: { $in: templeIds } });
});

gs.publish("templeForTempleAdmin", async (db, { _id }, { auth }) => {
  const { isTempleAdmin, templeId } = await templeAdminHelper(auth, db, _id);
  if (!isTempleAdmin) return [];
  return db.collection("temples").find({ _id: templeId }).limit(1);
});

gs.publish("usersForTempleAdmin", async (db, { _id }, { auth }) => {
  const { userId, isTempleAdmin } = await templeAdminHelper(auth, db, _id);
  if (!isTempleAdmin) return [];

  const memberships = await db
    .collection("templeMemberships")
    .find({ templeId: new ObjectId(_id), userId: { $ne: userId } })
    .toArray();

  return [
    {
      coll: "templeMemberships",
      entries: memberships,
    },
    {
      coll: "users",
      entries: await db
        .collection("users")
        .find({ _id: { $in: memberships.map((m) => m.userId) } })
        .project({ _id: true, displayName: true, emails: true })
        .toArray(),
    },
  ];
});

gs.publish("userTemplesAndMemberships", async (db, opts, { auth }) => {
  const userId = await auth.userId();
  if (!userId) return [];

  const memberships = await db
    .collection("templeMemberships")
    .find({ userId: new ObjectId(userId) })
    .toArray();

  if (!memberships) return [];

  return [
    {
      coll: "templeMemberships",
      entries: memberships,
    },
    {
      coll: "temples",
      entries: (
        await db
          .collection("temples")
          .find({ _id: { $in: memberships.map((m) => m.templeId) } })
          .toArray()
      ).map((temple) => {
        const membership = memberships.find((m) =>
          m.templeId.equals(temple._id)
        );
        if (membership?.admin) return temple;
        else {
          const { joinPass, ...rest } = temple;
          return rest;
        }
      }),
    },
  ];
});

async function userIsGroupAdmin(
  doc: Document | ChangeSetUpdate | string,
  { dba, auth, collection }: CollectionEventProps
) {
  const userId = await auth.userId();
  if (!userId) return "NOT_LOGGED_IN";

  const user = await dba.collection("users").findOne({ _id: userId });
  if (!user) return "USER_NOT_FOUND";

  if (typeof doc === "object" && "patch" in doc) {
    // Update
    const existingDoc = await collection.findOne(doc._id);
    if (!existingDoc) return "NO_EXISTING_DOC";
    // return userId.equals(existingDoc.userId) || "doc.userId !== userId";
    // @ts-expect-error: ok
    return doc.groupId &&
      // @ts-expect-error: ok
      !(user.groupAdminIds && user.groupAdminIds.includes(doc.groupId))
      ? "not in group"
      : true;
  }

  // DELETES (doc is an ObjectId)
  if (doc instanceof ObjectId || typeof doc === "string") {
    const docId = typeof doc === "string" ? new ObjectId(doc) : doc;
    const existingDoc = await collection.findOne(docId);
    if (!existingDoc) return "NO_EXISTING_DOC";
    return (
      userId.equals(existingDoc.userId) || "doc.userId !== userId (for delete)"
    );
  }

  console.log({ doc, userId });
  // return userId.equals(doc.userId) || "doc.userId !== userId";
  return doc.groupId &&
    !(user.groupAdminIds && user.groupAdminIds.includes(doc.groupId))
    ? "not in group"
    : true;
}

async function userIsTempleAdmin(
  doc: Document | ChangeSetUpdate | string,
  { dba, auth, collection }: CollectionEventProps
) {
  const userId = await auth.userId();
  if (!userId) return "NOT_LOGGED_IN";

  const user = await dba.collection("users").findOne({ _id: userId });
  if (!user) return "USER_NOT_FOUND";

  async function getMembership(doc) {
    const templeId = collection.name === "temples" ? doc._id : doc.templeId;
    if (!templeId) return null;

    return await dba.collection("templeMemberships").findOne({
      userId,
      templeId,
    });
  }

  if (typeof doc === "object" && "patch" in doc) {
    // Update
    const existingDoc = await collection.findOne(doc._id);
    if (!existingDoc) return "NO_EXISTING_DOC";

    const membership = await getMembership(existingDoc);
    return membership?.admin || user.admin || "not temple admin";
  }

  // DELETES (doc is an ObjectId)
  if (doc instanceof ObjectId || typeof doc === "string") {
    const docId = typeof doc === "string" ? new ObjectId(doc) : doc;
    const existingDoc = await collection.findOne(docId);
    if (!existingDoc) return "NO_EXISTING_DOC";

    const membership = await getMembership(existingDoc);
    return membership?.admin || user.admin || "not temple admin";
  }

  if (collection.name === "temples") {
    // Anyone can create a Temple.  And can't be a temple admin for
    // an uncreated temple.
    return true;
  }

  const membership = await getMembership(doc);
  return membership?.admin || user.admin || "not temple admin";
}

if (gs.dba) {
  const db = gs.dba;

  const studySet = db.collection("studySet");
  studySet.allow("insert", userIdMatches);
  studySet.allow("update", userIdMatches);
  studySet.allow("remove", userIdMatches);

  for (const collName of ["users", "userGroups"]) {
    const coll = db.collection(collName);
    coll.allow("insert", userIsAdmin);
    coll.allow("update", userIsAdmin);
    coll.allow("remove", userIsAdmin);
  }

  const docs = db.collection("docs");
  docs.allow("insert", userIsTempleAdmin);
  docs.allow("update", userIsTempleAdmin);
  docs.allow("remove", userIsTempleAdmin);
  const docRevisions = db.collection("docRevisions");
  docRevisions.allow("insert", userIdMatches);
  docRevisions.allow("update", userIdMatches);
  docRevisions.allow("remove", userIdMatches);

  const temples = db.collection("temples");
  temples.allow("insert", userIsTempleAdmin);
  temples.allow("update", userIsTempleAdmin);
  temples.allow("remove", userIsTempleAdmin);

  const templeMemberships = db.collection("templeMemberships");
  templeMemberships.allow("insert", userIsTempleAdmin);
  templeMemberships.allow("update", userIsTempleAdmin);
  templeMemberships.allow("remove", userIsTempleAdmin);
}

// https://github.com/nextauthjs/next-auth/issues/12224
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const POST = (await auth(gs.vercelEdgePost())) as any;
