import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoseSigil from "./RoseSigil";
import { letterPoint } from "./roseSigilGeometry";

/** One or two doubles away from zero: the size of a Node/Chromium trig difference. */
const nudge = (value: number) => value * (1 + Number.EPSILON);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RoseSigil", () => {
  it("hydrates when the browser's trig results differ in the last bit", () => {
    // The server render and the first client render both draw the letter
    // centres; the optimised layout only arrives after hydration.
    const render = () =>
      renderToString(<RoseSigil sigilText="אבג" showRose animate debug />);
    const server = render();
    const yod = letterPoint("י");
    const { cos, sin } = Math;
    vi.spyOn(Math, "cos").mockImplementation((x) => nudge(cos(x)));
    vi.spyOn(Math, "sin").mockImplementation((x) => nudge(sin(x)));
    expect(letterPoint("י")).not.toEqual(yod);
    expect(render()).toBe(server);

    // Node 25 wrote י's label at y="30.310889132455348", Chromium 152 at …344.
    expect(server).toContain('<text x="-17.5" y="30.311"');
    const numbers = [...server.matchAll(/ (?:x|y|cx|cy|d)="([^"]*)"/g)].flatMap(
      ([, value]) => value.match(/-?[\d.]+(?:e[-+]?\d+)?/g) ?? [],
    );
    expect(numbers.length).toBeGreaterThan(100);
    for (const number of numbers) expect(number).toMatch(/^-?\d+(\.\d{1,3})?$/);
  });

  it("draws repeated letters before optimisation", () => {
    // Repeated letters share a centre until the client optimises the layout.
    // A browser stops drawing a path at its first NaN, so a NaN in the
    // opening move drops the whole path.
    const html = renderToString(
      <RoseSigil sigilText="דדדבבב" showRose={false} animate debug />,
    );
    const paths = [...html.matchAll(/<path [^>]*\bd="([^"]*)"/g)];
    expect(paths).toHaveLength(2);
    for (const [, d] of paths) {
      expect(d).toMatch(/^M 1,25 A /);
      expect(d).not.toContain("NaN");
    }
  });
});
