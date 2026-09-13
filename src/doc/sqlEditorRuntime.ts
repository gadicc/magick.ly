import "server-only";

import { getCurrentSqlUserId } from "../auth/session";
import { db } from "../db/neonFull";
import { createSqlRitualEditorHttpHandlers } from "./sqlEditorHttp";
import {
  createSqlRitualCreationOptionsReader,
  createSqlRitualSourceDelivery,
} from "./sqlEditorServices";
import { createSqlRitualWriter } from "./sqlWrites";

let runtime: ReturnType<typeof createSqlRitualEditorHttpHandlers> | undefined;

export function getSqlRitualEditorRuntime() {
  return (runtime ??= createSqlRitualEditorHttpHandlers({
    source: createSqlRitualSourceDelivery(db, getCurrentSqlUserId),
    write: createSqlRitualWriter(db, getCurrentSqlUserId),
    creationOptions: createSqlRitualCreationOptionsReader(
      db,
      getCurrentSqlUserId,
    ),
  }));
}
