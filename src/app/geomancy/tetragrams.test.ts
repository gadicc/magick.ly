import { describe, expect, it } from "vitest";
import { compute } from "./tetragrams";

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
});
