import { describe, expect, it } from "vitest";
import { pageSearchParams } from "./pageSearchParams";

describe("pageSearchParams", () => {
  it("keeps the first value of repeated keys and drops undefined", () => {
    expect(
      pageSearchParams({
        m: "1211111221111212",
        house: ["7", "8"],
        planet: undefined,
      }).toString(),
    ).toBe("m=1211111221111212&house=7");
    expect(pageSearchParams({}).toString()).toBe("");
    expect(pageSearchParams({ text: [] }).toString()).toBe("");
  });
});
