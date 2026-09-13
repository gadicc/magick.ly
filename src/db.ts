"use client";
console.log("db.ts");

import db, { Collection } from "gongo-client";
import { StudySetStats } from "@/app/study/[_id]/exports";
import { preservePendingRitualChanges } from "./doc/drafts";
import {
  fenceLegacyBrowserRecoveryForSql,
  type LegacyRecoveryArchiveReport,
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

interface LegacyIdbOpen {
  open(): Promise<void>;
  idbDbVersion?: number;
  __magickliOriginalOpen?: () => Promise<void>;
}

function browserLegacyIdb(): LegacyIdbOpen | undefined {
  if (typeof window === "undefined" || typeof indexedDB === "undefined")
    return undefined;
  return (db as unknown as { idb?: LegacyIdbOpen }).idb;
}

let recoveryDatabase: RitualOfflineDatabase | undefined;
let fenceAttempt: Promise<LegacyRecoveryArchiveReport> | undefined;
let completedFence: LegacyRecoveryArchiveReport | undefined;
let pollRunningWhenFenced: Promise<void> | undefined;
let populationAttempt: Promise<void> | undefined;
let originalOpenDepth = 0;
const legacyIdb = browserLegacyIdb();
const openLegacyIdb = legacyIdb
  ? (legacyIdb.__magickliOriginalOpen ?? legacyIdb.open.bind(legacyIdb))
  : undefined;
if (legacyIdb && openLegacyIdb)
  Object.defineProperty(legacyIdb, "__magickliOriginalOpen", {
    configurable: true,
    value: openLegacyIdb,
  });

function inspectLegacyStoreInventory(): Promise<number> {
  if (!legacyIdb || typeof indexedDB === "undefined")
    return Promise.reject(
      new Error("Legacy browser recovery requires browser storage."),
    );
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      // Opening without a version never upgrades an existing database. A new,
      // empty database is safe for Gongo to initialize after this inspection.
      request = indexedDB.open("gongo");
    } catch (cause) {
      reject(cause);
      return;
    }
    request.onerror = () =>
      reject(
        request.error ?? new Error("Legacy browser storage could not open."),
      );
    request.onsuccess = () => {
      const inspected = request.result;
      try {
        const unknown = [...inspected.objectStoreNames].filter(
          (name) => !db.collections.has(name),
        );
        if (unknown.length)
          throw new Error(
            `Legacy browser storage has unrecognized object stores: ${unknown.join(
              ", ",
            )}`,
          );
        resolve(inspected.version);
      } catch (cause) {
        reject(cause);
      } finally {
        inspected.close();
      }
    };
  });
}

function startPopulationAttempt(): Promise<void> {
  if (db.populated) return Promise.resolve();
  if (populationAttempt) return populationAttempt;
  const attempt = openAfterInventory(false);
  populationAttempt = attempt;
  void attempt.then(
    () => {
      if (populationAttempt === attempt) populationAttempt = undefined;
    },
    () => {
      if (populationAttempt === attempt) populationAttempt = undefined;
    },
  );
  return attempt;
}

async function openAfterInventory(preserveRequestedVersion: boolean) {
  if (!legacyIdb || !openLegacyIdb)
    throw new Error("Legacy browser recovery requires browser storage.");
  const requestedVersion = legacyIdb.idbDbVersion;
  const inspectedVersion = await inspectLegacyStoreInventory();
  if (preserveRequestedVersion && requestedVersion !== undefined) {
    if (inspectedVersion > requestedVersion)
      throw new Error("Legacy browser storage changed during population.");
    // Gongo requested the next version to add known stores. Keep that request;
    // opening at the inspected older version would only repeat the recursion.
    legacyIdb.idbDbVersion = requestedVersion;
  } else {
    legacyIdb.idbDbVersion = inspectedVersion;
  }
  // The installed opener may recurse once it discovers missing known stores.
  // Its call returns through our wrapper and receives another inventory check.
  originalOpenDepth += 1;
  try {
    await openLegacyIdb();
  } finally {
    originalOpenDepth -= 1;
  }
}

function waitForPopulationAttempt(): Promise<void> {
  const attempt = startPopulationAttempt();
  if (typeof window === "undefined") return attempt;
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Legacy browser storage population timed out.")),
      15_000,
    );
    void attempt.then(
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      (cause) => {
        window.clearTimeout(timeout);
        reject(cause);
      },
    );
  });
}

if (legacyIdb)
  legacyIdb.open = () => {
    // Gongo recursively reopens at the next version when known stores are
    // missing. Inventory again before that open can enter its upgrade callback.
    if (originalOpenDepth > 0) return openAfterInventory(true);
    const attempt = startPopulationAttempt();
    // Gongo schedules open() without awaiting it. Observe its failure here while
    // retaining the rejecting promise for explicit recovery callers.
    void attempt.catch(() => {});
    return attempt;
  };

function transport(): LegacyTransport | undefined {
  return (db as unknown as { transport?: LegacyTransport }).transport;
}

function offlineRecoveryDatabase(): RitualOfflineDatabase {
  return (recoveryDatabase ??= new RitualOfflineDatabase());
}

function blockLegacyNetwork(): void {
  const current = transport();
  if (!current) return;
  pollRunningWhenFenced ??= current._promise ?? undefined;
  current.poll = () => undefined;
  current._poll = async () => {};
}

// The legacy client is recovery-only after SQL cutover. Persist registrations
// remain so Gongo cannot drop old IndexedDB stores before verified archival.
blockLegacyNetwork();

/*
 */

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

  fenceAttempt = waitForPopulationAttempt()
    .then(() =>
      fenceLegacyBrowserRecoveryForSql({
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
          ]) {
            subscription.stop();
            subscription.delete();
          }
          const network = db.gongoStore.findOne("network");
          if (network)
            db.gongoStore.update("network", { $set: { enabled: false } });
          await db.idb.putAll();
        },
      }),
    )
    .then(
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
