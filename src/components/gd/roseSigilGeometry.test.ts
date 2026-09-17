import { describe, expect, it } from "vitest";
import {
  largeArc,
  letterIJ,
  letterPoint,
  objective,
  optimizeSigilPoints,
  type Point,
  pathFromPoints,
  pointsToArray,
  SVG_COORDINATE_DECIMALS,
  sigilPoints,
  svgCoordinate,
} from "./roseSigilGeometry";

/** One or two doubles away from zero: the size of a Node/Chromium trig difference. */
const nudge = (value: number) => value * (1 + Number.EPSILON);

/** Centre and radius SVG gives `A radius,radius 0 large,sweep to` (SVG 2, B.2.4). */
function arcCircle(
  from: Point,
  to: Point,
  radius: number,
  large: boolean,
  sweep: boolean,
) {
  const hx = (from.x - to.x) / 2;
  const hy = (from.y - to.y) / 2;
  const half = hx * hx + hy * hy;
  const r = Math.max(radius, Math.sqrt(half));
  const coef =
    (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, r * r - half) / half);
  return {
    x: coef * hy + (from.x + to.x) / 2,
    y: -coef * hx + (from.y + to.y) / 2,
    r,
  };
}

const NUMBER = /-?[\d.]+(?:e[-+]?\d+)?/g;

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
    // The start marker is a full circle of eight anticlockwise quarter arcs.
    expect(single).toMatch(/^M 1,-15 A 1,1 0 0,0 /);
    expect(single.match(/A 1,1 0 0,0 /g)).toHaveLength(8);
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
    // Three clockwise loop arcs, four quarters each.
    expect(straight.match(/A 1,1 0 0,1 /g)).toHaveLength(12);
    expect(pathFromPoints({ points: [], sigilTokens: [] })).toBe("");
  });

  it("keeps non-degenerate paths unchanged", () => {
    const path = (text: string) =>
      pathFromPoints({ points: sigilPoints(text), sigilTokens: [...text] });
    // Written by the implementation before coincident points were handled.
    expect(path("אבבא")).toBe(
      "M -0.538,-14.157 A 1,1 0 0,0 0.215,-14.023 A 1,1 0 0,0 0.843,-14.462 " +
        "A 1,1 0 0,0 0.977,-15.215 A 1,1 0 0,0 0.538,-15.843 " +
        "A 1,1 0 0,0 -0.215,-15.977 A 1,1 0 0,0 -0.843,-15.538 " +
        "A 1,1 0 0,0 -0.977,-14.785 A 1,1 0 0,0 -0.538,-14.157 " +
        "L -19.169,14.997 A 2,1 0 1,0 -19.357,15.292" +
        "A 2,1 0 1,0 -19.546,15.587" +
        "L 0,-15 L 1.685,-13.923 L -1.685,-16.077",
    );
    expect(path("שלומ")).toMatch(
      / L 0,35 L -17\.5,-30\.311 L -12\.99,7\.5 L -11\.004,7\.263 L -14\.976,7\.737$/,
    );
    // End bars across rising, falling and vertical lines, +x end first.
    const bar = (points: Point[]) =>
      pathFromPoints({ points, sigilTokens: ["א", "ב"] })
        .match(/ L (\S+) L (\S+)$/)
        ?.slice(1);
    const origin = { x: 0, y: 0 };
    expect(bar([origin, { x: 3, y: 4 }])).toEqual(["4.6,2.8", "1.4,5.2"]);
    expect(bar([origin, { x: 3, y: -4 }])).toEqual(["4.6,-2.8", "1.4,-5.2"]);
    expect(bar([origin, { x: 0, y: 5 }])).toEqual(["2,5", "-2,5"]);
    expect(bar([{ x: 0, y: 5 }, origin])).toEqual(["2,0", "-2,0"]);
  });

  it("draws repeated letters that share a centre", () => {
    const texts = ["אא", "אאא", "אאב", "באאז", "קללללללב", "חפטטההה", "דדדבבב"];
    const paths = new Map<string, string>();
    for (const text of texts) {
      const sigilTokens = [...text];
      const points = sigilPoints(text);
      const d = pathFromPoints({ points, sigilTokens });
      expect(d).not.toContain("NaN");
      for (const number of d.match(NUMBER) ?? [])
        expect(number).toMatch(/^-?\d+(\.\d{1,3})?$/);
      // The server renders these before optimisation, so hydration needs
      // them to survive last-bit differences too.
      const nudged = points.map(({ x, y }) => ({ x: nudge(x), y: nudge(y) }));
      expect(pathFromPoints({ points: nudged, sigilTokens })).toBe(d);
      paths.set(text, d);
    }
    // A coincident neighbour counts as lying on the +x side, where
    // `Math.atan2(0, 0)` puts it: a repeated first letter's circle is a lone
    // letter's, and a repeated last letter's end bar is vertical.
    const lone = pathFromPoints({
      points: sigilPoints("א"),
      sigilTokens: ["א"],
    });
    expect(paths.get("אא")).toBe(`${lone}L 0,-15 L 0,-13 L 0,-17`);
    expect(paths.get("דדדבבב")).toMatch(/^M 1,25 A 1,1 0 0,0 /);
    expect(paths.get("חפטטההה")).toMatch(/ 0,-35L 0,-35 L 0,-33 L 0,-37$/);
    // Later repeats of a run squiggle in from +x; the last one bends away
    // from ב.
    expect(paths.get("קללללללב")).toContain(
      "A 2,1 0 1,0 0,35" +
        "L 0.7,35 A 2,1 0 1,0 0.35,35A 2,1 0 1,0 0,35" +
        "L 0.7,35 A 2,1 0 1,1 0.35,35A 2,1 0 1,1 0,35" +
        "L -19.546,15.587 ",
    );
  });

  it("draws a vertical end bar after a level line", () => {
    const path = (text: string) =>
      pathFromPoints({ points: sigilPoints(text), sigilTokens: [...text] });
    // פ and כ mirror each other at exactly the same height.
    expect(path("פכ")).toMatch(/ L 10\.847,-24\.524 L 10\.847,-20\.524$/);
    expect(path("כפ")).toMatch(/ L -10\.847,-20\.524 L -10\.847,-24\.524$/);
    // ב and ג differ in height by only 9e-15, which the old slope formula
    // turned into both ends at (19.546, 16).
    expect(path("אבג")).toMatch(/ L 19\.546,13\.587 L 19\.546,17\.587$/);
    expect(path("גב")).toMatch(/ L -19\.546,17\.587 L -19\.546,13\.587$/);
    // Rounding noise of either sign leaves the bar and its end order alone.
    const [bet, gimel] = sigilPoints("בג");
    const bars = [-1e-10, -1e-14, 0, 1e-14, 1e-10].map((rise) =>
      pathFromPoints({
        points: [bet, { x: gimel.x, y: bet.y + rise }],
        sigilTokens: ["ב", "ג"],
      }),
    );
    expect(new Set(bars).size).toBe(1);
    expect(bars[0]).toMatch(/ L 19\.546,13\.587 L 19\.546,17\.587$/);
  });

  it("rounds coordinates so engines that differ in the last bit agree", () => {
    expect(SVG_COORDINATE_DECIMALS).toBe(3);
    // י's label y from Node 25 and from Chromium 152, which failed hydration.
    expect(svgCoordinate(30.310889132455348)).toBe(30.311);
    expect(svgCoordinate(30.310889132455344)).toBe(30.311);
    expect(svgCoordinate(-17.500000000000014)).toBe(-17.5);
    expect(Object.is(svgCoordinate(-6.429395695523604e-15), 0)).toBe(true);
    for (const text of ["א", "אב", "אבג", "גדי", "אבבג", "גבבא", "שלומ"]) {
      const sigilTokens = text.split("");
      const points = sigilPoints(text);
      const d = pathFromPoints({ points, sigilTokens });
      for (const number of d.match(NUMBER) ?? [])
        expect(number).toMatch(/^-?\d+(\.\d{1,3})?$/);
      const nudged = points.map(({ x, y }) => ({ x: nudge(x), y: nudge(y) }));
      expect(nudged).not.toEqual(points);
      expect(pathFromPoints({ points: nudged, sigilTokens })).toBe(d);
    }
  });

  it("draws large arcs as quarters of the same circle that rounding keeps", () => {
    const cases: Array<[Point, Point]> = [
      // An ordinary loop.
      [
        { x: 1.931, y: 24.02 },
        { x: 0, y: 24.503 },
      ],
      // Optimised repeats: rounded as one arc, its ends would merge.
      [
        { x: 0, y: -14.99913 },
        { x: 0, y: -14.99901 },
      ],
      // The start marker's chord is its diameter.
      [
        { x: 1, y: -15 },
        { x: -1, y: -15 },
      ],
      // Longer than the diameter, so SVG enlarges the radius.
      [
        { x: 3, y: 4 },
        { x: 0, y: 0 },
      ],
    ];
    for (const [from, to] of cases)
      for (const clockwise of [true, false]) {
        const d = largeArc(from, to, 1, clockwise);
        const quarters = [
          ...d.matchAll(/A ([\d.]+),\1 0 0,([01]) (-?[\d.]+),(-?[\d.]+) /g),
        ];
        expect(quarters).toHaveLength(4);
        expect(quarters.map(([command]) => command).join("")).toBe(d);
        const circle = arcCircle(from, to, 1, true, clockwise);
        let at = { x: svgCoordinate(from.x), y: svgCoordinate(from.y) };
        for (const [, r, sweep, x, y] of quarters) {
          expect(sweep).toBe(clockwise ? "1" : "0");
          const next = { x: Number(x), y: Number(y) };
          const quarter = arcCircle(at, next, Number(r), false, clockwise);
          expect(
            Math.hypot(quarter.x - circle.x, quarter.y - circle.y),
          ).toBeLessThan(0.002);
          expect(Math.abs(quarter.r - circle.r)).toBeLessThan(0.002);
          at = next;
        }
        expect(at).toEqual({ x: svgCoordinate(to.x), y: svgCoordinate(to.y) });
      }
    expect(largeArc({ x: 1, y: 2 }, { x: 1, y: 2 }, 1, true)).toBe("");
  });

  it("keeps the loop between optimised repeats a thousandth apart", () => {
    // COBYLA's layout for אאא under Node 25; the loop's chord is 0.00012.
    const points = [
      { x: 1.8369684029544886e-15, y: -15.000510271213843 },
      { x: 1.836944300199573e-15, y: -14.999293443774167 },
      { x: 9.184537381221264e-16, y: -14.998976117843958 },
    ];
    const d = pathFromPoints({ points, sigilTokens: ["א", "א", "א"] });
    const loop = [...d.matchAll(/A 1,1 0 0,1 (-?[\d.]+),/g)].map(([, x]) =>
      Number(x),
    );
    expect(loop).toHaveLength(12);
    // Its two unit circles sit either side of the vertical path.
    expect(Math.max(...loop)).toBe(2);
    expect(Math.min(...loop)).toBe(-2);
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
