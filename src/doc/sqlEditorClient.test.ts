// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import { failedRitualPublication } from "../offline/ritualPublicationContract";
import { createRitualPublicationHttpHandler } from "../offline/ritualPublicationHttp";
import {
  fetchSqlRitualCreationOptions,
  fetchSqlRitualSource,
  sendRitualPublication,
  sendSqlRitualWrite,
} from "./sqlEditorClient";
import type { SqlRitualWriteRequest } from "./sqlWriteContract";

vi.mock("server-only", () => ({}));

const actorId = createUuidV7();
const ritualId = createUuidV7();
const revisionId = createUuidV7();
const requestId = createUuidV7();

function response(path: string, body: unknown, headers: HeadersInit = {}) {
  const serialized = JSON.stringify(body);
  const result = new Response(serialized, {
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "content-length": String(new TextEncoder().encode(serialized).byteLength),
      ...headers,
    },
  });
  Object.defineProperty(result, "url", { value: `${location.origin}${path}` });
  return result;
}

it("fetches a bound source through exact same-origin no-store POST transport", async () => {
  const request = {
    version: 1 as const,
    requestId,
    expectedActorId: actorId,
    ritualId,
  };
  const permission = {
    version: 1,
    requestId,
    ownerId: actorId,
    ritualId,
    kind: "granted",
    grant: {
      version: 1,
      leaseId: createUuidV7(),
      ownerId: actorId,
      ritualId,
      checkedAtMs: 100,
      respondedAtMs: 101,
      expiresAtMs: 200,
      sourceEdit: true,
    },
    rendered: { kind: "temporarily-unavailable" },
    editor: { currentRevisionId: revisionId, parentVersion: 4 },
  };
  const fetcher = vi.fn().mockResolvedValue(
    response("/api/rituals/source", {
      version: 1,
      requestId,
      ownerId: actorId,
      ritualId,
      permission,
      source: {
        title: "Protected title",
        revisionId,
        parentVersion: 4,
        source: "p Protected",
      },
    }),
  );
  await expect(
    fetchSqlRitualSource(request, new AbortController().signal, fetcher),
  ).resolves.toMatchObject({
    permission: { kind: "granted" },
    source: { revisionId, parentVersion: 4, source: "p Protected" },
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/rituals/source",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify(request),
    }),
  );
});

it("accepts only the exact next-version write acknowledgement", async () => {
  const request: SqlRitualWriteRequest = {
    version: 2,
    operationId: createUuidV7(),
    expectedActorId: actorId,
    kind: "save",
    ritualId,
    expectedRevisionId: revisionId,
    expectedVersion: 4,
    source: "p Changed",
  };
  const result = {
    ok: true,
    replayed: false,
    ritualId,
    revisionId: createUuidV7(),
    version: 5,
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
  await expect(
    sendSqlRitualWrite(
      request,
      new AbortController().signal,
      vi.fn().mockResolvedValue(response("/api/rituals/write", result)),
    ),
  ).resolves.toEqual(result);
  await expect(
    sendSqlRitualWrite(
      request,
      new AbortController().signal,
      vi
        .fn()
        .mockResolvedValue(
          response("/api/rituals/write", { ...result, version: 7 }),
        ),
    ),
  ).resolves.toBeNull();
});

it("rejects cached creation options even when their JSON shape is valid", async () => {
  const body = {
    version: 1,
    ownerId: actorId,
    public: false,
    groups: [],
    temples: [],
  };
  await expect(
    fetchSqlRitualCreationOptions(
      new AbortController().signal,
      vi.fn().mockResolvedValue(
        response("/api/rituals/creation-options", body, {
          "cache-control": "private, max-age=60",
        }),
      ),
    ),
  ).resolves.toBeNull();
});

it("accepts only a publication result bound to the exact durable write identity", async () => {
  const operationId = createUuidV7();
  const publication = {
    version: 1 as const,
    operationId,
    expectedActorId: actorId,
    ritualId,
    expectedRevisionId: revisionId,
    expectedVersion: 4,
  };
  const result = {
    ok: true,
    state: "completed",
    replayed: false,
    receipt: {
      operationId,
      bundleId: createUuidV7(),
      ritualId,
      publishedAtMs: 42,
    },
  };
  await expect(
    sendRitualPublication(
      publication,
      new AbortController().signal,
      vi.fn().mockResolvedValue(response("/api/rituals/publication", result)),
    ),
  ).resolves.toEqual(result);
  await expect(
    sendRitualPublication(
      publication,
      new AbortController().signal,
      vi.fn().mockResolvedValue(
        response("/api/rituals/publication", {
          ...result,
          receipt: { ...result.receipt, operationId: createUuidV7() },
        }),
      ),
    ),
  ).resolves.toBeNull();
});

it("decodes a canonical non-200 publication result from the real HTTP handler", async () => {
  const publication = {
    version: 1 as const,
    operationId: createUuidV7(),
    expectedActorId: actorId,
    ritualId,
    expectedRevisionId: revisionId,
    expectedVersion: 4,
  };
  const handler = createRitualPublicationHttpHandler({
    publish: async () => failedRitualPublication("STALE"),
  });
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const result = await handler(
        new Request(new URL(String(input), location.origin), init),
      );
      Object.defineProperty(result, "url", {
        value: `${location.origin}/api/rituals/publication`,
      });
      return result;
    },
  );
  await expect(
    sendRitualPublication(publication, new AbortController().signal, fetcher),
  ).resolves.toEqual(failedRitualPublication("STALE"));
  expect((await fetcher.mock.results[0]?.value)?.status).toBe(409);
});

it("rejects a canonical publication failure sent with the wrong HTTP status", async () => {
  const publication = {
    version: 1 as const,
    operationId: createUuidV7(),
    expectedActorId: actorId,
    ritualId,
    expectedRevisionId: revisionId,
    expectedVersion: 4,
  };
  await expect(
    sendRitualPublication(
      publication,
      new AbortController().signal,
      vi
        .fn()
        .mockResolvedValue(
          response(
            "/api/rituals/publication",
            failedRitualPublication("STALE"),
          ),
        ),
    ),
  ).resolves.toBeNull();
});
