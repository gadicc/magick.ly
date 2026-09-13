import "server-only";

import { eq, getTableColumns, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { legacyFileSnapshots } from "../db/schema/legacyFiles";
import { loomFilesTable } from "../db/schema/loomFiles";
import type { LegacyRitualImageSource } from "../files/legacyRitualImageCatalog";

type ReadDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select">;
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/**
 * Loads only exact legacy public-import evidence requested by inventory digest.
 * The legacy catalog independently revalidates every joined row before object I/O.
 */
export async function loadSqlLegacyRitualImageSources(
  database: ReadDatabase,
  input: readonly string[],
): Promise<LegacyRitualImageSource[]> {
  if (
    !Array.isArray(input) ||
    input.length > 128 ||
    input.some((value) => !digest(value)) ||
    new Set(input).size !== input.length
  )
    throw new TypeError("Invalid legacy ritual image source request");
  if (!input.length) return [];
  const rows = await database
    .select({
      file: getTableColumns(loomFilesTable),
      snapshot: getTableColumns(legacyFileSnapshots),
    })
    .from(loomFilesTable)
    .innerJoin(
      legacyFileSnapshots,
      eq(legacyFileSnapshots.fileId, loomFilesTable.id),
    )
    .where(inArray(loomFilesTable.sha256, [...input]))
    .limit(129);
  if (rows.length > 128)
    throw new Error("Legacy ritual image sources unavailable");
  return rows;
}
