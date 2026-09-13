"use client";
console.log("db.ts");

import db, { Collection } from "gongo-client";
import HTTPTransport from "gongo-client/lib/transports/http";
import { getSession } from "next-auth/react";
// import GongoAuth from "gongo-client/lib/auth";
import { StudySetStats } from "@/app/study/[_id]/exports";
import { clientRitualId, preservePendingRitualChanges } from "./doc/drafts";
import {
  fenceLegacyBrowserRecoveryForSql,
  type LegacyRecoveryArchiveReport,
  preserveLegacyBrowserRecovery,
} from "./offline/legacyBrowserRecovery";
import { RitualOfflineDatabase } from "./offline/storage";
import type {
  Doc,
  DocRevision,
  Temple,
  TempleMembershipClient,
  UserClient,
  UserGroup,
} from "./schemas";

// db.extend("auth", GongoAuth);

interface LegacyTransport {
  _poll(): Promise<void>;
  poll(): Promise<void> | undefined;
  _promise?: Promise<void> | null;
}

interface LegacySubscription {
  name: string;
  stop(): void;
  delete(): void;
}

const ritualSubscriptions = new Set(["doc", "docs", "docRevisions"]);
let legacyNetworkFenced = false;
let recoveryDatabase: RitualOfflineDatabase | undefined;
let fenceAttempt: Promise<LegacyRecoveryArchiveReport> | undefined;
let completedFence: LegacyRecoveryArchiveReport | undefined;
let pollRunningWhenFenced: Promise<void> | undefined;

function transport(): LegacyTransport | undefined {
  return (db as unknown as { transport?: LegacyTransport }).transport;
}

function offlineRecoveryDatabase(): RitualOfflineDatabase {
  return (recoveryDatabase ??= new RitualOfflineDatabase());
}

async function archiveLegacyBrowser(): Promise<LegacyRecoveryArchiveReport> {
  return preserveLegacyBrowserRecovery(
    db,
    window.localStorage,
    offlineRecoveryDatabase(),
  );
}

function blockLegacyNetwork(): void {
  legacyNetworkFenced = true;
  const current = transport();
  if (!current) return;
  pollRunningWhenFenced ??= current._promise ?? undefined;
  current.poll = () => undefined;
  current._poll = async () => {};
}

function defineTransport() {
  if (legacyNetworkFenced) return;
  // Manual enable before IndexedDB population and the startup event share one transport.
  // @ts-expect-error: Gongo extensions are not declared on Database.
  if (db.transport) return;
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
    // Installed HTTPTransport.poll() waits for db.populated before calling this wrapper.
    await archiveLegacyBrowser();
    if (legacyNetworkFenced) return;
    await preservePendingRitualChanges(db, window.localStorage);
    if (legacyNetworkFenced) return;
    const session = await getSession();
    if (legacyNetworkFenced) return;
    // Legacy ObjectIDs retain the existing study sync. A SQL UUID can never
    // adopt unattributed browser progress during the coordinated handoff.
    const userId = clientRitualId(session?.user?.id);
    if (userId) {
      db.collection("studySet").update(
        { userId: { $exists: false } },
        { $set: { userId }, $push: { __ObjectIDs: "userId" } },
      );
      // console.log(result);
    }
    if (legacyNetworkFenced) return;
    return await _origPoll();
  };
  // @ts-expect-error: ok
  db.transport.poll();
}

function enableNetwork() {
  if (legacyNetworkFenced) return;
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

/**
 * Fence the legacy transport for the coordinated SQL switch. The first line of
 * work blocks future polls; archival failures remain blocked and are retryable.
 */
export function fenceLegacyNetworkForSql(): Promise<LegacyRecoveryArchiveReport> {
  // Do this before constructing/opening Dexie: even a synchronous storage
  // failure must leave the old transport unable to send.
  blockLegacyNetwork();
  if (completedFence) return Promise.resolve(completedFence);
  if (fenceAttempt) return fenceAttempt;

  fenceAttempt = fenceLegacyBrowserRecoveryForSql({
    cache: db,
    storage: window.localStorage,
    database: offlineRecoveryDatabase(),
    blockNetwork: blockLegacyNetwork,
    settleNetwork: async () => {
      try {
        await pollRunningWhenFenced;
      } catch {
        // The old request outcome does not decide whether durable recovery can retry.
      } finally {
        pollRunningWhenFenced = undefined;
      }
    },
    afterInitialArchive: async () => {
      await preservePendingRitualChanges(db, window.localStorage);
    },
    finalizeFence: async () => {
      for (const subscription of [
        ...(db.subscriptions.values() as IterableIterator<LegacySubscription>),
      ])
        if (ritualSubscriptions.has(subscription.name)) {
          subscription.stop();
          subscription.delete();
        }
      const network = db.gongoStore.findOne("network");
      if (network)
        db.gongoStore.update("network", { $set: { enabled: false } });
      await db.idb.putAll();
    },
  }).then(
    (report) => {
      completedFence = report;
      fenceAttempt = undefined;
      return report;
    },
    (error) => {
      fenceAttempt = undefined;
      throw error;
    },
  );
  return fenceAttempt;
}

export default db;
