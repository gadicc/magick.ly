import { describe, expect, it } from "vitest";
import { createUuidV7, isUuidV7 } from "../lib/ids";
import { deriveRitualPublicationIdentity } from "./ritualPublicationIdentity";

describe("ritual publication identities", () => {
  it("derives distinct stable UUIDv7 bundle and ordered asset identities", () => {
    const operationId = createUuidV7();
    const first = deriveRitualPublicationIdentity(operationId, 3);
    const second = deriveRitualPublicationIdentity(operationId, 3);
    expect(first).toEqual(second);
    expect(new Set([first.bundleId, ...first.assetKeys]).size).toBe(4);
    expect([first.bundleId, ...first.assetKeys].every(isUuidV7)).toBe(true);
    expect(first.bundleId.slice(0, 13)).toBe(operationId.slice(0, 13));
  });

  it.each([
    ["invalid", 0],
    [createUuidV7().toUpperCase(), 0],
    [createUuidV7(), -1],
    [createUuidV7(), 513],
  ])("rejects invalid operation/count input", (operationId, count) => {
    expect(() => deriveRitualPublicationIdentity(operationId, count)).toThrow(
      TypeError,
    );
  });
});
