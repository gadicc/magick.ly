import "server-only";

import { db } from "../db/neonFull";
import { createLegacyPublicFileGet } from "./legacyPublicFileRoute";
import { createSqlLegacyPublicFileReader } from "./legacyPublicFiles";
import {
  createLegacyPublicR2Storage,
  type LegacyPublicObjectStorage,
  readLegacyPublicR2StorageConfigs,
} from "./legacyPublicR2";

let get: ((request: Request) => Promise<Response>) | undefined;

export function getLegacyPublicFileGet() {
  if (!get) {
    let storage: LegacyPublicObjectStorage | undefined;
    get = createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage: {
        read(file, signal) {
          // Preview may have no legacy rows or credentials. Resolve storage only
          // after SQL finds a public file; failed setup remains retryable.
          storage ??= createLegacyPublicR2Storage(
            readLegacyPublicR2StorageConfigs(process.env),
          ).storage;
          return storage.read(file, signal);
        },
      },
    });
  }
  return get;
}
