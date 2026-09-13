import { describe, expect, it } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  failedRitualPublication,
  parseRitualPublicationRequest,
  parseRitualPublicationResult,
} from "./ritualPublicationContract";

const request = {
  version: 1 as const,
  operationId: createUuidV7(),
  expectedActorId: createUuidV7(),
  ritualId: createUuidV7(),
  expectedRevisionId: createUuidV7(),
  expectedVersion: 2,
};
const success = {
  ok: true as const,
  state: "completed" as const,
  replayed: false,
  receipt: {
    operationId: request.operationId,
    bundleId: createUuidV7(),
    ritualId: request.ritualId,
    publishedAtMs: 1_789_000_000_000,
  },
};

describe("ritual publication transport contract", () => {
  it("accepts only the exact v1 request shape", () => {
    expect(parseRitualPublicationRequest(request)).toEqual(request);
    expect(
      parseRitualPublicationRequest({ ...request, extra: true }),
    ).toBeNull();
    expect(
      parseRitualPublicationRequest({
        ...request,
        operationId: request.operationId.toUpperCase(),
      }),
    ).toBeNull();
  });

  it("binds completed receipts to the requested operation and ritual", () => {
    expect(parseRitualPublicationResult(request, success)).toEqual(success);
    expect(
      parseRitualPublicationResult(request, {
        ...success,
        receipt: { ...success.receipt, ritualId: createUuidV7() },
      }),
    ).toBeNull();
    expect(
      parseRitualPublicationResult(request, { ...success, unexpected: true }),
    ).toBeNull();
  });

  it("accepts only canonical safe failures", () => {
    const failure = failedRitualPublication("BUSY");
    expect(parseRitualPublicationResult(request, failure)).toEqual(failure);
    expect(
      parseRitualPublicationResult(request, {
        ...failure,
        message: "raw provider diagnostic",
      }),
    ).toBeNull();
  });
});
