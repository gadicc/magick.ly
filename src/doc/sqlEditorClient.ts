"use client";

import type { RitualPermissionRequestV1 } from "../offline/permissionContract";
import {
  parseRitualPublicationResult,
  type RitualPublicationRequestV1,
  type RitualPublicationResult,
} from "../offline/ritualPublicationContract";
import {
  type AcceptedSqlRitualSourceDelivery,
  parseSqlRitualCreationOptions,
  parseSqlRitualSourceDelivery,
  parseSqlRitualWriteResult,
  type SqlRitualCreationOptionsV1,
} from "./sqlEditorContract";
import type {
  SqlRitualWriteRequest,
  SqlRitualWriteResult,
} from "./sqlWriteContract";

const SOURCE_PATH = "/api/rituals/source";
const WRITE_PATH = "/api/rituals/write";
const OPTIONS_PATH = "/api/rituals/creation-options";
const PUBLICATION_PATH = "/api/rituals/publication";

function exact(
  response: Response,
  path: string,
  acceptedStatus: (status: number) => boolean = (status) => status === 200,
) {
  try {
    const url = new URL(response.url);
    return (
      acceptedStatus(response.status) &&
      !response.redirected &&
      url.origin === location.origin &&
      url.pathname === path &&
      url.search === "" &&
      response.headers
        .get("cache-control")
        ?.toLowerCase()
        .split(",")
        .some((item) => item.trim() === "no-store") === true &&
      response.headers.get("content-type")?.split(";", 1)[0].trim() ===
        "application/json"
    );
  } catch {
    return false;
  }
}

async function boundedJson(response: Response, maxBytes: number) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
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
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function post(
  path: string,
  body: unknown,
  signal: AbortSignal,
  fetcher: typeof fetch,
  maxBytes: number,
  acceptedStatus?: (status: number) => boolean,
) {
  try {
    const response = await fetcher(path, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return exact(response, path, acceptedStatus)
      ? {
          status: response.status,
          body: await boundedJson(response, maxBytes),
        }
      : null;
  } catch {
    return null;
  }
}

export async function fetchSqlRitualSource(
  request: RitualPermissionRequestV1,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AcceptedSqlRitualSourceDelivery | null> {
  const delivery = await post(
    SOURCE_PATH,
    request,
    signal,
    fetcher,
    1024 * 1024 + 16 * 1024,
  );
  return parseSqlRitualSourceDelivery(request, delivery?.body, {
    status: delivery?.status ?? 0,
    sameOrigin: delivery !== null,
    uncached: delivery !== null,
  });
}

export async function sendSqlRitualWrite(
  request: SqlRitualWriteRequest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SqlRitualWriteResult | null> {
  const delivery = await post(WRITE_PATH, request, signal, fetcher, 16 * 1024);
  return !delivery || delivery.body === null
    ? null
    : parseSqlRitualWriteResult(request, delivery.body);
}

export async function fetchSqlRitualCreationOptions(
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SqlRitualCreationOptionsV1 | null> {
  try {
    const response = await fetcher(OPTIONS_PATH, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!exact(response, OPTIONS_PATH)) return null;
    return parseSqlRitualCreationOptions(
      await boundedJson(response, 256 * 1024),
    );
  } catch {
    return null;
  }
}

export async function sendRitualPublication(
  request: RitualPublicationRequestV1,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<RitualPublicationResult | null> {
  const delivery = await post(
    PUBLICATION_PATH,
    request,
    signal,
    fetcher,
    32 * 1024,
    (status) => [200, 400, 401, 403, 409, 410, 503].includes(status),
  );
  if (!delivery || delivery.body === null) return null;
  const result = parseRitualPublicationResult(request, delivery.body);
  if (!result) return null;
  const expectedStatus = result.ok
    ? 200
    : result.code === "AUTH_REQUIRED"
      ? 401
      : result.code === "FORBIDDEN"
        ? 403
        : result.code === "EXPIRED"
          ? 410
          : ["ACTOR_CHANGED", "STALE", "OPERATION_CONFLICT", "BUSY"].includes(
                result.code,
              )
            ? 409
            : ["ABORTED", "UNAVAILABLE"].includes(result.code)
              ? 503
              : 400;
  return delivery.status === expectedStatus ? result : null;
}
