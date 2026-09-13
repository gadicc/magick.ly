import { describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import type { RitualPermissionRequestV1 } from "../offline/permissionContract";
import {
  parseSqlRitualCreateRequest,
  parseSqlRitualSourceDelivery,
  parseSqlRitualWriteResult,
} from "./sqlEditorContract";
import type { SqlRitualWriteRequest } from "./sqlWriteContract";

const actorId = createUuidV7();
const ritualId = createUuidV7();
const revisionId = createUuidV7();
const requestId = createUuidV7();
const operationId = createUuidV7();
const permissionRequest: RitualPermissionRequestV1 = {
  version: 1,
  requestId,
  expectedActorId: actorId,
  ritualId,
};
const permission = () => ({
  version: 1 as const,
  requestId,
  ownerId: actorId,
  ritualId,
  kind: "granted" as const,
  grant: {
    version: 1 as const,
    leaseId: createUuidV7(),
    ownerId: actorId,
    ritualId,
    checkedAtMs: 100,
    respondedAtMs: 101,
    expiresAtMs: 200,
    sourceEdit: true,
  },
  rendered: { kind: "temporarily-unavailable" as const },
  editor: { currentRevisionId: revisionId, parentVersion: 4 },
});
const transport = { status: 200, sameOrigin: true, uncached: true };

describe("SQL editor transport contracts", () => {
  it("accepts source only when the final grant names its exact CAS parent", () => {
    const body = {
      version: 1,
      requestId,
      ownerId: actorId,
      ritualId,
      permission: permission(),
      source: {
        title: "Exact title",
        revisionId,
        parentVersion: 4,
        source: "p Exact source\r\n",
      },
    };
    expect(
      parseSqlRitualSourceDelivery(permissionRequest, body, transport),
    ).toEqual({ permission: body.permission, source: body.source });

    const stale = structuredClone(body);
    stale.source.parentVersion = 3;
    expect(
      parseSqlRitualSourceDelivery(permissionRequest, stale, transport),
    ).toMatchObject({
      permission: { kind: "temporarily-unavailable" },
      source: null,
    });
  });

  it("treats malformed, redirected, or cached source transport as temporary", () => {
    for (const rejected of [
      { status: 503, sameOrigin: true, uncached: true },
      { status: 200, sameOrigin: false, uncached: true },
      { status: 200, sameOrigin: true, uncached: false },
    ])
      expect(
        parseSqlRitualSourceDelivery(permissionRequest, {}, rejected),
      ).toMatchObject({
        permission: { kind: "temporarily-unavailable" },
        source: null,
      });
  });

  it("round-trips only an exact canonical SQL-v2 create request", () => {
    const request = {
      version: 2,
      operationId,
      expectedActorId: actorId,
      kind: "create",
      scope: { kind: "temple", templeId: createUuidV7(), minGrade: 2 },
      title: "New ritual",
      source: "p Exact",
    } as const;
    expect(parseSqlRitualCreateRequest(request, actorId)).toEqual(request);
    expect(
      parseSqlRitualCreateRequest({ ...request, extra: true }, actorId),
    ).toBeNull();
    expect(parseSqlRitualCreateRequest(request, createUuidV7())).toBeNull();
  });

  it("binds write acknowledgements to the exact next CAS version", () => {
    const request: SqlRitualWriteRequest = {
      version: 2,
      operationId,
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
    expect(parseSqlRitualWriteResult(request, result)).toEqual(result);
    expect(
      parseSqlRitualWriteResult(request, { ...result, version: 6 }),
    ).toBeNull();
    expect(
      parseSqlRitualWriteResult(request, {
        ok: false,
        code: "FORBIDDEN",
        message:
          "You do not currently have permission for this ritual command.",
        retryable: true,
      }),
    ).toBeNull();
  });
});
