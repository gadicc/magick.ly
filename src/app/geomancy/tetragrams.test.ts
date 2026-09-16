import { describe, expect, it } from "vitest";
import { compute, figuresFromMothers, tetragramFromRows } from "./tetragrams";

describe("geomancy", () => {
  describe("compute", () => {
    it("works with book result", () => {
      const mothers: (1 | 2)[][] = [
        [1, 2, 1, 1],
        [1, 1, 1, 2],
        [2, 1, 1, 1],
        [1, 2, 1, 2],
      ];

      const { daughters, nephews, witnesses, judges } = compute(mothers);

      const all = mothers.concat(daughters, nephews, witnesses, judges);
      const str = JSON.stringify(all);
      expect(str).toBe(
        "[[1,2,1,1],[1,1,1,2],[2,1,1,1],[1,2,1,2],[1,1,2,1],[2,1,1,2],[1,1,1,1],[1,2,1,2],[2,1,2,1],[1,1,2,1],[1,2,1,1],[2,1,2,1],[1,2,2,2],[1,1,1,2],[2,1,1,2]]",
      );
    });
  });

  describe("figures", () => {
    it("looks figures up by rows and derives all sixteen for a reading", () => {
      expect(tetragramFromRows([1, 2, 1, 1])?.id).toBe("puella");
      expect(tetragramFromRows([3, 3, 3, 3])).toBeNull();
      expect(tetragramFromRows([1, 2, 1])).toBeNull();
      const figures = figuresFromMothers([
        [1, 2, 1, 1],
        [1, 1, 1, 2],
        [2, 1, 1, 1],
        [1, 2, 1, 2],
      ]);
      expect(figures).toHaveLength(15);
      expect(figures.every((figure) => figure !== null)).toBe(true);
      expect(figures.map((figure) => figure?.rows.join("")).join(" ")).toBe(
        "1211 1112 2111 1212 1121 2112 1111 1212 2121 1121 1211 2121 1222 1112 2112",
      );
    });
  });
});
