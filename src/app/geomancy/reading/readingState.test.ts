import { describe, expect, it } from "vitest";
import { readingFromSearchParams, readingSearchParams } from "./readingState";

const defaults = {
  mothers: [
    [1, 2, 1, 1],
    [1, 1, 1, 2],
    [2, 1, 1, 1],
    [1, 2, 1, 2],
  ],
  house: "1",
  planetId: "luna",
};

describe("geomancy reading links", () => {
  it("restores a shared reading exactly and never casts a new one", () => {
    const state = readingFromSearchParams(
      new URLSearchParams("m=2222111122221111&house=7&planet=mars"),
    );
    expect(state).toEqual({
      mothers: [
        [2, 2, 2, 2],
        [1, 1, 1, 1],
        [2, 2, 2, 2],
        [1, 1, 1, 1],
      ],
      house: "7",
      planetId: "mars",
    });
    expect(readingSearchParams(state).toString()).toBe(
      "m=2222111122221111&house=7&planet=mars",
    );
    expect(readingFromSearchParams(readingSearchParams(state))).toEqual(state);
  });

  it("falls back to the page defaults for missing or malformed values", () => {
    expect(readingFromSearchParams(null)).toEqual(defaults);
    expect(readingFromSearchParams(new URLSearchParams(""))).toEqual(defaults);
    expect(
      readingFromSearchParams(
        new URLSearchParams("m=123&house=13&planet=pluto"),
      ),
    ).toEqual(defaults);
    expect(
      readingFromSearchParams(new URLSearchParams("house=0&planet=luna")),
    ).toEqual(defaults);
    expect(readingSearchParams(defaults as never).toString()).toBe(
      "m=1211111221111212",
    );
  });
});
