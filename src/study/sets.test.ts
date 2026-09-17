import { describe, expect, it, vi } from "vitest";
import getSet, { sets } from "./sets";

// The study API route loads these sets, and Turbopack gives route handlers no
// `next/font`; a font import here would break that route.
vi.mock("next/font/local", () => {
  throw new Error("study sets must not load next/font");
});

describe("study sets", () => {
  it("resolve card ids without loading fonts", () => {
    for (const id of Object.keys(sets))
      expect(Object.keys(getSet(id).data).length, id).toBeGreaterThan(0);
    expect(() => getSet("missing")).toThrow("No such set");
  });

  it("name the Enochian question font", () => {
    expect(sets["enochian-letters-latin"].questionFont).toBe("enochian");
    expect(sets["enochian-letter-names"].questionFont).toBe("enochian");
  });
});
