import { sql } from "drizzle-orm";
import { uuid } from "drizzle-orm/pg-core";

/** Uses pg_uuidv7 in Postgres and Loom's matching UUIDv7 function in PGlite. */
export const uuidV7Default = sql`uuid_generate_v7()`;

/** UUID column with a database-side v7 default for inserts that omit the ID. */
export const uuidV7 = <TName extends string>(name: TName) =>
  uuid(name).default(uuidV7Default);
