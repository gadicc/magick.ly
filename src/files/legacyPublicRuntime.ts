import "server-only";

import { db } from "../db/neonFull";
import { createLegacyPublicFileGet } from "./legacyPublicFileRoute";
import { createSqlLegacyPublicFileReader } from "./legacyPublicFiles";
import {
  createLegacyPublicR2Storage,
  readLegacyPublicR2StorageConfigs,
} from "./legacyPublicR2";

let get: ((request: Request) => Promise<Response>) | undefined;

export function getLegacyPublicFileGet() {
  if (!get) {
    const provider = createLegacyPublicR2Storage(
      readLegacyPublicR2StorageConfigs(process.env),
    );
    get = createLegacyPublicFileGet({
      read: createSqlLegacyPublicFileReader(db),
      storage: provider.storage,
    });
  }
  return get;
}
