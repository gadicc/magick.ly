import { describe, expect, it } from "vitest";
import { maximalMarginalRelevance } from "./mmr";

describe("existing corpus MMR ranking", () => {
  it("chooses relevance first and then diversity at lambda .25", () => {
    expect(
      maximalMarginalRelevance(
        [1, 0],
        [
          [1, 0],
          [0.9, 0.1],
          [0, 1],
          [-1, 0],
          [0, -1],
        ],
      ),
    ).toEqual([0, 3, 2, 4]);
  });

  it("preserves first-result tie order and handles zero-norm vectors", () => {
    expect(
      maximalMarginalRelevance(
        [0, 0],
        [
          [1, 0],
          [1, 0],
          [0, 0],
          [0, 1],
        ],
      ),
    ).toEqual([0, 2, 3, 1]);
    expect(
      maximalMarginalRelevance(
        [1, 0],
        [
          [1, 0],
          [1, 0],
          [1, 0],
        ],
      ),
    ).toEqual([0, 1, 2]);
  });

  it("returns fewer than four candidates and supports empty matches", () => {
    expect(maximalMarginalRelevance([1, 0], [])).toEqual([]);
    expect(maximalMarginalRelevance([1, 0], [[0, 1]])).toEqual([0]);
    expect(maximalMarginalRelevance([1, 0], [[0, 1]], 0.25, 0)).toEqual([]);
    expect(
      maximalMarginalRelevance(
        [1, 0],
        [
          [0, 1],
          [1, 0],
        ],
      ),
    ).toEqual([1, 0]);
  });

  it("rejects mismatched or nonfinite returned vectors", () => {
    expect(() => maximalMarginalRelevance([1, 0], [[1]])).toThrow(
      "incompatible",
    );
    expect(() => maximalMarginalRelevance([1, 0], [[NaN, 1]])).toThrow(
      "incompatible",
    );
  });
});
