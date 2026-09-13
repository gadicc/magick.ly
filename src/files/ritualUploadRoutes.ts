import "server-only";

import type { RitualUploadInitiateResult } from "./ritualUploadInitiateResult";
import type {
  RitualUploadCode,
  RitualUploadResult,
} from "./ritualUploadProtocol";

const MAX_COMMAND_BYTES = 16 * 1024;

type UploadRoutes = {
  initiate(
    input: unknown,
    signal: AbortSignal,
  ): Promise<RitualUploadInitiateResult>;
  finalize(input: unknown, signal: AbortSignal): Promise<RitualUploadResult>;
};

function status(code: RitualUploadCode) {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "EXPIRED") return 410;
  if (
    ["ACTOR_CHANGED", "BUSY", "DUPLICATE", "OPERATION_CONFLICT"].includes(code)
  )
    return 409;
  if (code === "TOO_LARGE") return 413;
  if (["ABORTED", "TIMEOUT", "UNAVAILABLE"].includes(code)) return 503;
  return 400;
}

function json(
  value: RitualUploadInitiateResult | RitualUploadResult,
  code?: number,
) {
  return Response.json(value, {
    status: code ?? (value.ok ? 200 : status(value.code)),
    headers: { "cache-control": "no-store" },
  });
}

const invalid = (): Extract<RitualUploadResult, { ok: false }> => ({
  ok: false,
  code: "INVALID_REQUEST",
  retryable: false,
});

export function unavailableRitualUploadResponse() {
  return json({ ok: false, code: "UNAVAILABLE", retryable: true });
}

async function readJson(request: Request) {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim();
  if (mediaType !== "application/json") return null;
  const length = request.headers.get("content-length");
  if (length !== null) {
    const parsed = Number(length);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_COMMAND_BYTES
    )
      return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_COMMAND_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  if (size < 1) return null;
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

export function createRitualUploadRouteHandlers(runtime: UploadRoutes) {
  const route =
    (operation: "initiate" | "finalize") => async (request: Request) => {
      const body = await readJson(request);
      if (body === null) return json(invalid());
      try {
        return json(await runtime[operation](body, request.signal));
      } catch {
        return unavailableRitualUploadResponse();
      }
    };
  return { initiate: route("initiate"), finalize: route("finalize") };
}
