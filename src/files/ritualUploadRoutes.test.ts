import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type {
  RitualUploadInitiateResult,
  RitualUploadResult,
} from "./ritualUploadProtocol";
import { createRitualUploadRouteHandlers } from "./ritualUploadRoutes";
import type { RitualUploadRuntime } from "./ritualUploadRuntime";

vi.mock("server-only", () => ({}));

function runtime(
  overrides: Partial<RitualUploadRuntime> = {},
): RitualUploadRuntime {
  return {
    initiate: vi.fn(
      async (): Promise<RitualUploadInitiateResult> => ({
        ok: false,
        code: "INVALID_REQUEST",
        retryable: false,
      }),
    ),
    finalize: vi.fn(
      async (): Promise<RitualUploadResult> => ({
        ok: false,
        code: "INVALID_REQUEST",
        retryable: false,
      }),
    ),
    ...overrides,
  };
}

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://magick.ly/api/files/ritual/initiate", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("ritual upload HTTP commands", () => {
  it("returns only the short-lived capability with no-store caching", async () => {
    const upload = {
      kind: "presigned-put" as const,
      url: "https://example.r2.cloudflarestorage.com/capability",
      headers: { "content-type": "image/png", "if-none-match": "*" },
      expiresAtMs: Date.now() + 60_000,
    };
    const service = runtime({
      initiate: vi.fn(
        async (): Promise<RitualUploadInitiateResult> => ({
          ok: true,
          state: "upload",
          replayed: false,
          upload,
        }),
      ),
    });
    const input = { expectedActorId: createUuidV7() };

    const response = await createRitualUploadRouteHandlers(service).initiate(
      request(input),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      state: "upload",
      replayed: false,
      upload,
    });
    expect(service.initiate).toHaveBeenCalledWith(
      input,
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(body)).not.toContain("objectKey");
  });

  it("maps safe service failures to an HTTP status without exposing exceptions", async () => {
    const forbidden = runtime({
      finalize: vi.fn(
        async (): Promise<RitualUploadResult> => ({
          ok: false,
          code: "FORBIDDEN",
          retryable: false,
        }),
      ),
    });
    const unavailable = runtime({
      initiate: vi.fn(async () => {
        throw new Error("provider token and diagnostic");
      }),
    });

    const denied = await createRitualUploadRouteHandlers(forbidden).finalize(
      request({ operationId: createUuidV7() }),
    );
    const failed = await createRitualUploadRouteHandlers(unavailable).initiate(
      request({ operationId: createUuidV7() }),
    );

    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(await denied.json()).toEqual({
      ok: false,
      code: "FORBIDDEN",
      retryable: false,
    });
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("diagnostic");
  });

  it("rejects non-JSON and oversized commands before invoking the service", async () => {
    const service = runtime();
    const routes = createRitualUploadRouteHandlers(service);
    const wrongType = new Request(
      "https://magick.ly/api/files/ritual/initiate",
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      },
    );
    const oversized = request({}, { "content-length": "20000" });

    for (const response of [
      await routes.initiate(wrongType),
      await routes.initiate(oversized),
    ]) {
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        ok: false,
        code: "INVALID_REQUEST",
        retryable: false,
      });
    }
    expect(service.initiate).not.toHaveBeenCalled();
  });
});
