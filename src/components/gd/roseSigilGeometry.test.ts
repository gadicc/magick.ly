import { describe, expect, it } from "vitest";
import {
  letterIJ,
  letterPoint,
  objective,
  optimizeSigilPoints,
  pathFromPoints,
  pointsToArray,
  sigilPoints,
} from "./roseSigilGeometry";

describe("rose sigil geometry", () => {
  it("places every rose letter on its ring and rejects others", () => {
    expect(letterIJ("א")).toEqual([0, 0]);
    expect(letterIJ("ק")).toEqual([2, 11]);
    expect(letterIJ("ך")).toEqual([-1, -1]);
    expect(letterIJ("a")).toEqual([-1, -1]);
    const alef = letterPoint("א");
    expect(Math.hypot(alef.x, alef.y)).toBeCloseTo(15);
    const qof = letterPoint("ק");
    expect(Math.hypot(qof.x, qof.y)).toBeCloseTo(35);
  });

  it("draws start marker, loops for straight runs, squiggles for repeats and an end bar", () => {
    const single = pathFromPoints({
      points: sigilPoints("א"),
      sigilTokens: ["א"],
    });
    expect(single).toMatch(/^M .* A 1,1 0 1,0 .* A 1,1 0 1,0 /);
    expect(single).not.toContain("L ");
    const repeat = pathFromPoints({
      points: sigilPoints("אבב"),
      sigilTokens: ["א", "ב", "ב"],
    });
    expect(repeat).toContain("A 2,1 0 1,0");
    // A repeat in the middle bends away from the following letter, so the
    // arc side depends on which way the path turns next.
    const path = (text: string) =>
      pathFromPoints({
        points: sigilPoints(text),
        sigilTokens: text.split(""),
      });
    expect(path("אבבג")).toContain("A 2,1 0 1,0");
    expect(path("גבבא")).toContain("A 2,1 0 1,1");
    const straight = pathFromPoints({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      sigilTokens: ["א", "ב", "ג"],
    });
    expect(straight.match(/A 1,1 0 1,1/g)).toHaveLength(3);
    expect(pathFromPoints({ points: [], sigilTokens: [] })).toBe("");
  });

  it("scores wider angles higher and penalises drifting far from the letter", () => {
    const points = sigilPoints("אבג");
    const base = objective(points, pointsToArray(points));
    const drifted = pointsToArray(points);
    drifted[0] += 20;
    expect(objective(points, drifted)).toBeLessThan(base);
  });

  it("optimises deterministically within the evaluation bound", async () => {
    const listeners = () => ({
      rejection: process.listeners("unhandledRejection"),
      exception: process.listeners("uncaughtException"),
    });
    const before = listeners();
    const points = sigilPoints("גדי");
    const first = await optimizeSigilPoints(points);
    const second = await optimizeSigilPoints(points);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    for (const [index, point] of first.entries()) {
      expect(
        Math.hypot(point.x - points[index].x, point.y - points[index].y),
      ).toBeLessThan(10);
    }
    expect(await optimizeSigilPoints([])).toEqual([]);
    // Emscripten's glue registers abort handlers on the process at load time;
    // they must not survive, or every later server diagnostic becomes a WASM
    // abort message.
    const after = listeners();
    expect(after.rejection).toEqual(before.rejection);
    expect(after.exception).toEqual(before.exception);
    expect(
      after.rejection.some((listener) => /abort\(/.test(String(listener))),
    ).toBe(false);
    const started = performance.now();
    const long = await optimizeSigilPoints(sigilPoints("א".repeat(32)));
    expect(long).toHaveLength(32);
    expect(performance.now() - started).toBeLessThan(10_000);
  }, 30_000);
});
