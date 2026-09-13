import "server-only";

import type { LoomFileRouteAccess } from "@gadicc/loom/next/files";
import { sqlRitualReader } from "../doc/sqlRuntime";
import { createRitualFileAuthorizer } from "./ritualFileAccess";
import { parseRitualFileLocator } from "./ritualFileLocator";
import type { RitualFileRecord } from "./repository";

const authorize = createRitualFileAuthorizer(sqlRitualReader);
const unavailable = () =>
  new Response("File not found\n", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

export async function authorizeRitualFileRecord(
  record: RitualFileRecord,
  locator: Parameters<typeof authorize>[1],
) {
  try {
    return await authorize(record, locator);
  } catch {
    return false;
  }
}

/** Exact canonical locator plus fresh current rendered-policy authorization. */
export async function authorizeFilesRead(
  request: Request,
  record: RitualFileRecord,
): Promise<LoomFileRouteAccess | Response> {
  let locator;
  try {
    const url = new URL(request.url);
    locator = parseRitualFileLocator(`${url.pathname}${url.search}`);
  } catch {
    return unavailable();
  }
  if (!locator || !(await authorizeRitualFileRecord(record, locator)))
    return unavailable();
  return {};
}

/** Required Loom feature export; the managed generic POST is deliberately disabled. */
export async function authorizeFilesUpload(): Promise<Response> {
  return new Response("Method not allowed\n", {
    status: 405,
    headers: {
      allow: "GET",
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
