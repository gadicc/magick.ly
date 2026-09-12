import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  parseFinalizeRitualUpload,
  parseInitiateRitualUpload,
  RITUAL_UPLOAD_MAX_BYTES,
} from "./ritualUploadProtocol";

function request() {
  return {
    version: 1,
    operationId: createUuidV7(),
    expectedActorId: createUuidV7(),
    ritualId: createUuidV7(),
    filename: "\ufeff Ritual 守護\r\n.png ",
    byteSize: 300,
    contentType: "image/png",
    sha256: "a".repeat(64),
  };
}
describe("immutable ritual upload command boundary", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])(
    "accepts %s and preserves the exact display filename",
    (contentType) => {
      const input = { ...request(), contentType };
      expect(parseInitiateRitualUpload(input)).toEqual(input);
    },
  );
  it.each([1, RITUAL_UPLOAD_MAX_BYTES])(
    "allows exact compressed byte boundary %i",
    (byteSize) => {
      const input = { ...request(), byteSize };
      expect(parseInitiateRitualUpload(input)).toEqual(input);
    },
  );
  it.each([
    0,
    -1,
    1.5,
    RITUAL_UPLOAD_MAX_BYTES + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "300",
  ])("rejects invalid declared byte size %s", (byteSize) => {
    expect(parseInitiateRitualUpload({ ...request(), byteSize })).toBeNull();
  });
  it.each(["", "   ", "image\0.png", "x".repeat(1025), "bad\ud800.png"])(
    "rejects invalid display filename %#",
    (filename) => {
      expect(parseInitiateRitualUpload({ ...request(), filename })).toBeNull();
    },
  );
  it.each([
    "image/svg+xml",
    "image/apng",
    "application/pdf",
    "image/jpg",
    "image/png; charset=utf-8",
  ])("rejects unsupported claimed MIME %s", (contentType) => {
    expect(parseInitiateRitualUpload({ ...request(), contentType })).toBeNull();
  });
  it.each(["ownerId", "objectKey", "bucket", "visibility", "meta", "canEdit"])(
    "rejects client-controlled %s authority",
    (key) => {
      expect(
        parseInitiateRitualUpload({ ...request(), [key]: "injected" }),
      ).toBeNull();
    },
  );
  it.each(["operationId", "expectedActorId", "ritualId"])(
    "requires canonical UUIDv7 for %s",
    (key) => {
      for (const id of [
        "507f1f77bcf86cd799439011",
        "550e8400-e29b-41d4-a716-446655440000",
        "019a12ab-1234-7ABC-8abc-123456789abc",
        { toString: () => createUuidV7() },
      ]) {
        expect(
          parseInitiateRitualUpload({ ...request(), [key]: id }),
        ).toBeNull();
      }
    },
  );
  it("rejects getters without evaluating them, symbols, arrays and inherited request data", () => {
    const read = vi.fn(() => "image/png");
    const accessor = request();
    Object.defineProperty(accessor, "contentType", { get: read });
    for (const input of [
      accessor,
      { ...request(), [Symbol("hidden")]: 1 },
      Object.create(request()),
      Object.values(request()),
      null,
    ])
      expect(parseInitiateRitualUpload(input)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("requires lowercase exact SHA256 and protocol version one", () => {
    for (const sha256 of ["a".repeat(63), "g".repeat(64), "A".repeat(64), null])
      expect(parseInitiateRitualUpload({ ...request(), sha256 })).toBeNull();
    expect(parseInitiateRitualUpload({ ...request(), version: 2 })).toBeNull();
  });
  it("finalization accepts only the retained operation and expected actor", () => {
    const initial = request(),
      input = {
        version: 1,
        operationId: initial.operationId,
        expectedActorId: initial.expectedActorId,
      };
    expect(parseFinalizeRitualUpload(input)).toEqual(input);
    expect(
      parseFinalizeRitualUpload({ ...input, ritualId: initial.ritualId }),
    ).toBeNull();
    expect(
      parseFinalizeRitualUpload({ ...input, operationId: "client-picked-key" }),
    ).toBeNull();
    expect(parseFinalizeRitualUpload({ ...input, version: 2 })).toBeNull();
  });
});
