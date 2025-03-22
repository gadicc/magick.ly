"use client";
console.log("db.ts");
import db, { Collection } from "gongo-client";
import { getSession } from "next-auth/react";
import HTTPTransport from "gongo-client/lib/transports/http";
// import GongoAuth from "gongo-client/lib/auth";
import { StudySetStats } from "@/app/study/[_id]/exports";
import type {
  Doc,
  DocRevision,
  Temple,
  TempleMembershipClient,
  UserClient,
  UserGroup,
} from "./schemas";

// db.extend("auth", GongoAuth);

function defineTransport() {
  // remove old gongoStore auth (now we use next-auth)
  db.gongoStore.remove({ _id: "auth" });

  db.extend("transport", HTTPTransport, {
    pollInterval: process.env.NODE_ENV === "development" ? 60 * 1000 : 3 * 1000,
    // pollInterval: 60 * 1000,
    // pollInterval: false,
    pollWhenIdle: false,
    idleTimeout: 60 * 1000,
  });

  /*
   * A bit hacky (TODO, appropriate hook in Gongo)
   * If we previously created studySets before ever enabling network,
   * the documents won't have a userId.  So, before any poll, update
   * any docs without a userId with our userId.
   */
  // @ts-expect-error: ok
  const _origPoll = db.transport._poll.bind(db.transport);
  // @ts-expect-error: ok
  db.transport._poll = async function () {
    const session = await getSession();
    const userId = session?.user.id;
    if (userId) {
      const result = db
        .collection("studySet")
        .update(
          { userId: { $exists: false } },
          { $set: { userId }, $push: { __ObjectIDs: "userId" } }
        );
      // console.log(result);
    }
    return await _origPoll();
  };
  // @ts-expect-error: ok
  db.transport.poll();
}

function enableNetwork() {
  // @ts-expect-error: ok
  if (db.transport) {
    console.warn("enableNetwork() called but transport already exists");
    return;
  }

  const network = db.gongoStore.findOne("network");
  if (network) db.gongoStore.update("network", { $set: { enabled: true } });
  else db.gongoStore.insert({ _id: "network", enabled: true });

  defineTransport();
}

if (typeof window !== "undefined")
  setTimeout(() => {
    db.idb.on("collectionsPopulated", () => {
      const network = db.gongoStore.findOne("network");
      if (network?.enabled) {
        console.log("gongoStore.network.enabled is set");
        defineTransport();
      }
    });
  }, 10);

/*
 */

db.subscribe("user", {
  minInterval: 2000,
  maxInterval: 5000,
});
db.collection("users").persist();
db.collection("userGroups").persist();
db.collection("docs").persist();
db.collection("docRevisions").persist();
db.collection("temples").persist();
db.collection("templeMemberships").persist();

// db.subscribe("files");
// db.collection("files").persist();

// db.collection("cache", { isLocalCollection: true }).persist();

db.collection("studySet" /*{ isLocalCollection: true }*/).persist();

declare module "gongo-client" {
  interface Database {
    collection(name: "docs"): Collection<Doc>;
    collection(name: "docRevisions"): Collection<DocRevision>;
    collection(name: "studySet"): Collection<StudySetStats>;
    collection(name: "users"): Collection<UserClient>;
    collection(name: "userGroups"): Collection<UserGroup>;
    collection(name: "temples"): Collection<Temple>;
    collection(name: "templeMemberships"): Collection<TempleMembershipClient>;
  }
}

// @ts-expect-error: i know
if (typeof window !== "undefined") window.db = db;

export { enableNetwork };
export default db;
