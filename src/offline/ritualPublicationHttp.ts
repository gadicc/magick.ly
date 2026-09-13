import "server-only";

import {
  failedRitualPublicationBackfill,
  type RitualPublicationBackfillResult,
} from "./ritualPublicationBackfill";
import {
  failedRitualPublication,
  type RitualPublicationResult,
} from "./ritualPublicationContract";

const MAX_REQUEST_BYTES = 4096;
const headers = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  vary: "Cookie",
  "x-content-type-options": "nosniff",
};

function status(
  result: RitualPublicationResult | RitualPublicationBackfillResult,
) {
  if (result.ok) return 200;
  if (result.code === "AUTH_REQUIRED") return 401;
  if (result.code === "FORBIDDEN") return 403;
  if (result.code === "EXPIRED") return 410;
  if (
    ["ACTOR_CHANGED", "STALE", "OPERATION_CONFLICT", "BUSY"].includes(
      result.code,
    )
  )
    return 409;
  if (["ABORTED", "UNAVAILABLE"].includes(result.code)) return 503;
  return 400;
}

async function readJson(request: Request) {
  if (
    request.method !== "POST" ||
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/json" ||
    !request.body
  )
    return null;
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) ||
      Number(declared) < 1 ||
      Number(declared) > MAX_REQUEST_BYTES)
  )
    return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (!size) return null;
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  } finally {
    body.fill(0);
  }
}

const json = (
  result: RitualPublicationResult | RitualPublicationBackfillResult,
) => Response.json(result, { status: status(result), headers });

export function createRitualPublicationHttpHandler(service: {
  publish(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<RitualPublicationResult>;
}) {
  return async function POST(request: Request) {
    const input = await readJson(request);
    if (input === null) return json(failedRitualPublication("INVALID_REQUEST"));
    try {
      return json(await service.publish(input, request.signal));
    } catch {
      return json(failedRitualPublication("UNAVAILABLE"));
    }
  };
}

export function createRitualPublicationBackfillHttpHandler(service: {
  backfill(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<RitualPublicationBackfillResult>;
}) {
  return async function POST(request: Request) {
    const input = await readJson(request);
    if (input === null)
      return json(failedRitualPublicationBackfill("INVALID_REQUEST", null));
    try {
      return json(await service.backfill(input, request.signal));
    } catch {
      return json(failedRitualPublicationBackfill("UNAVAILABLE", null));
    }
  };
}
