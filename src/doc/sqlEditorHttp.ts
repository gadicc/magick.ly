import "server-only";

import type {
  SqlRitualCreationOptionsV1,
  SqlRitualSourceDeliveryV1,
} from "./sqlEditorContract";
import {
  SQL_RITUAL_WRITE_MESSAGES,
  type SqlRitualWriteResult,
} from "./sqlWriteContract";

const SOURCE_REQUEST_BYTES = 4096;
const WRITE_REQUEST_BYTES = 1024 * 1024 + 16 * 1024;
const privateHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
});

interface SqlRitualEditorHttpServices {
  source(input: unknown): Promise<SqlRitualSourceDeliveryV1 | null>;
  write(input: unknown): Promise<SqlRitualWriteResult>;
  creationOptions(): Promise<SqlRitualCreationOptionsV1 | null>;
}

async function boundedJson(request: Request, maxBytes: number) {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json" || !request.body) return null;
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) < 1 || Number(length) > maxBytes)
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
  if (size === 0) return null;
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

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: privateHeaders });

export function createSqlRitualEditorHttpHandlers(
  services: SqlRitualEditorHttpServices,
) {
  return {
    async source(request: Request) {
      if (request.method !== "POST")
        return json({ error: "invalid-request" }, 400);
      const input = await boundedJson(request, SOURCE_REQUEST_BYTES);
      if (input === null) return json({ error: "invalid-request" }, 400);
      try {
        const result = await services.source(input);
        return result ? json(result) : json({ error: "invalid-request" }, 400);
      } catch {
        return json({ error: "temporarily-unavailable" }, 503);
      }
    },
    async write(request: Request) {
      if (request.method !== "POST")
        return json({ error: "invalid-request" }, 400);
      const input = await boundedJson(request, WRITE_REQUEST_BYTES);
      if (input === null) return json({ error: "invalid-request" }, 400);
      try {
        return json(await services.write(input));
      } catch {
        return json({
          ok: false,
          code: "UNAVAILABLE",
          message: SQL_RITUAL_WRITE_MESSAGES.UNAVAILABLE,
          retryable: true,
        } satisfies SqlRitualWriteResult);
      }
    },
    async creationOptions(request: Request) {
      if (request.method !== "GET" || new URL(request.url).search !== "")
        return json({ error: "invalid-request" }, 400);
      try {
        return json(await services.creationOptions());
      } catch {
        return json({ error: "temporarily-unavailable" }, 503);
      }
    },
  };
}
