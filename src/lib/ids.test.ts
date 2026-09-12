import { describe, expect, it } from "vitest";
import { createUuidV7, isUuidV7 } from "./ids";

describe("canonical UUIDv7 identifiers", () => {
  it("generates unique IDs with the current timestamp and correct version/variant", () => {
    const before = Date.now();
    const ids = Array.from({ length: 100 }, () => createUuidV7());
    const after = Date.now();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isUuidV7(id)).toBe(true);
      expect(id[14]).toBe("7");
      expect("89ab").toContain(id[19]);
      const timestamp = Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    }
  });

  it.each([
    undefined,
    null,
    7,
    "",
    "507f1f77bcf86cd799439011",
    "550e8400-e29b-41d4-a716-446655440000",
    "01890f47-9bb0-7000-0715-5cdf04b5c08d",
  ])("rejects non-v7 values: %s", (value) => {
    expect(isUuidV7(value)).toBe(false);
  });

  it("accepts uppercase UUID input", () => {
    expect(isUuidV7(createUuidV7().toUpperCase())).toBe(true);
  });
});
