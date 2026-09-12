import type GongoServerless from "gongo-server/lib/serverless";
import type MongoDatabaseAdapter from "gongo-server-db-mongo";
import type { Db, MongoClient } from "mongodb";
import { legacyRitualId } from "./legacyAccess";
import {
  type RitualWriteResult,
  rejectLegacyRitualMutation,
  writeRitual,
} from "./writes";

/**
 * Use only the session attached by the route's Auth.js wrapper. Gongo auth.userId()
 * also accepts request-body/legacy-cookie tokens, including expired stored rows.
 */
export async function legacyRitualWrite(
  dba: MongoDatabaseAdapter,
  input: unknown,
  { request }: { request: Request },
): Promise<RitualWriteResult> {
  try {
    const verified = (
      request as Request & { auth?: { user?: { id?: unknown } } | null }
    ).auth;
    const actor =
      typeof verified?.user?.id === "string"
        ? legacyRitualId(verified.user.id)
        : null;
    if (!actor)
      return {
        ok: false,
        code: "NOT_AUTHENTICATED",
        message: "Sign in before saving this ritual.",
      };
    // db.ts injects the app's MongoClient into Gongo; its old declarations carry
    // another driver version, while these are the actual app client/db objects.
    return await writeRitual(
      {
        client: dba.client as unknown as MongoClient,
        db: (await dba.dbPromise) as unknown as Db,
      },
      actor,
      input,
    );
  } catch {
    // Catch initialization/adapter errors too: Gongo otherwise serializes their
    // raw message and stack before the domain command can return a safe result.
    return {
      ok: false,
      code: "UNAVAILABLE",
      message:
        "The save result could not be confirmed. Keep your source and retry the identical request with the same request ID.",
    };
  }
}

/** Install once, in place of all generic docs/docRevisions allow handlers. */
export function registerLegacyRitualWrites(
  gs: GongoServerless<MongoDatabaseAdapter>,
): void {
  gs.method("ritualWrite", (_db, input, { request }) =>
    legacyRitualWrite(gs.dba, input, { request }),
  );
  for (const name of ["docs", "docRevisions"]) {
    const collection = gs.dba.collection(name);
    collection.allow("insert", rejectLegacyRitualMutation);
    collection.allow("update", rejectLegacyRitualMutation);
    collection.allow("remove", rejectLegacyRitualMutation);
  }
}
