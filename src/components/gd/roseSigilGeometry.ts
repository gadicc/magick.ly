/**
 * Rose-cross sigil geometry shared by the interactive component and the server
 * renderer. Everything is deterministic for a given letter sequence, including
 * the layout optimisation, which is bounded by evaluation count rather than
 * time so both sides agree. Engines can still differ in the last bit of a
 * trig result, so every number written to SVG goes through `svgCoordinate`.
 */

export const ROSE_LETTERS = [
  ["א", "מ", "ש"],
  ["פ", "ר", "ב", "ד", "ג", "ת", "כ"],
  ["ה", "ו", "ז", "ח", "ט", "י", "ל", "נ", "ס", "ע", "צ", "ק"],
];

/** Evaluation cap for the layout optimiser; identical on every platform. */
export const SIGIL_MAX_EVALUATIONS = 20_000;

export interface Point {
  x: number;
  y: number;
}

/**
 * Decimal places kept in SVG output, as in SVGO's default. On the 100-unit
 * canvas that is about 0.02 px of error even at the 4096 px raster limit.
 */
export const SVG_COORDINATE_DECIMALS = 3;
const SVG_COORDINATE_SCALE = 10 ** SVG_COORDINATE_DECIMALS;

/**
 * A number as written to SVG. Node and the browser can disagree in the last
 * bit of `Math.sin`/`Math.cos` (30.310889132455348 against …344), and React
 * reports any such attribute difference as a hydration mismatch; rounding
 * gives both the same digits.
 */
export function svgCoordinate(value: number): number {
  // `+ 0` turns the -0 that tiny negative values round to into 0.
  return Math.round(value * SVG_COORDINATE_SCALE) / SVG_COORDINATE_SCALE + 0;
}

/** `x,y` for SVG path data, rounded like every other emitted coordinate. */
function svgPair(point: Point) {
  return `${svgCoordinate(point.x)},${svgCoordinate(point.y)}`;
}

export function letterIJ(letter: string) {
  for (let i = 0; i < ROSE_LETTERS.length; i++) {
    const row = ROSE_LETTERS[i];
    const j = row.indexOf(letter);
    if (j >= 0) {
      return [i, j];
    }
  }
  return [-1, -1];
}

export function letterPoint(letter: string): Point {
  const [i, j] = letterIJ(letter);
  const points = ROSE_LETTERS[i].length;
  const slice = (2 * Math.PI) / points;
  const offset = -Math.PI / 2 - (i === 1 ? slice / 2 : 0);
  const angle = offset - slice * j;
  const radius = 10 * (i + 2) - 5;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

/**
 * A line whose y falls by less than this fraction of its length is level,
 * and its end bar takes the end order of a line whose y rises. Letters
 * mirrored about the vertical axis differ in y only by rounding, under
 * 1e-15 of the length, and engines can disagree on its sign, which would
 * otherwise swap the bar's ends between server and browser. A bar this
 * close to vertical is vertical at SVG's 0.001 precision.
 */
const LEVEL_RISE = 1e-9;

/**
 * The ends of a bar through `point2`, `distance` either side of it and
 * perpendicular to the line from `point1`. The end on the +x side comes
 * first; a level line's bar is vertical, and its end to the left of the
 * direction of travel comes first.
 */
function calculatePerpendicularPointsAtEnd(
  point1: Point,
  point2: Point,
  distance: number,
): [Point, Point] {
  const length = lengthBetweenTwoPoints(point1, point2);
  // As in `pointFromEndOfLine`, a coincident `point1` lies on the +x side.
  const along =
    length === 0
      ? { x: -1, y: 0 }
      : {
          x: (point2.x - point1.x) / length,
          y: (point2.y - point1.y) / length,
        };
  const side = along.y <= -LEVEL_RISE ? -distance : distance;
  const offset = { x: along.y * side, y: -along.x * side };
  return [
    { x: point2.x + offset.x, y: point2.y + offset.y },
    { x: point2.x - offset.x, y: point2.y - offset.y },
  ];
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function lengthBetweenTwoPoints(p1: Point, p2: Point) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

// Subtract vertex from p1,p2 to normalize on x-axis and calc angle
function angleBetweenTwoPointsAndVertex(p1: Point, p2: Point, vertex: Point) {
  return (
    Math.atan2(p2.y - vertex.y, p2.x - vertex.x) -
    Math.atan2(p1.y - vertex.y, p1.x - vertex.x)
  );
}

function pointAtFractionOfLine(p1: Point, p2: Point, frac: number): Point {
  return {
    x: p1.x + (p2.x - p1.x) * frac,
    y: p1.y + (p2.y - p1.y) * frac,
  };
}

function pointFromEndOfLine(p1: Point, p2: Point, distance: number): Point {
  const length = lengthBetweenTwoPoints(p1, p2);
  // Repeated letters share a centre before optimisation, so the line
  // between them has no direction. Treat `p1` as lying on the +x side, as
  // `Math.atan2(0, 0)` does in the angle tests.
  if (length === 0) return { x: p2.x + distance, y: p2.y };
  const frac = distance / length;
  return pointAtFractionOfLine(p1, p2, 1 - frac);
}

/**
 * Path data for the arc `A radius,radius 0 1,<sweep> to` drawn from `from`,
 * split into four equal arcs of the same circle. `clockwise` is SVG's sweep
 * flag (clockwise on screen).
 *
 * A single arc is fragile once rounded when its chord is tiny or a whole
 * diameter. Loops between optimised repeats have chords of a few
 * hundred-thousandths of a unit, and their circle turns with the chord, so
 * rounded ends could make it vanish or move. The start marker's chord is
 * its diameter, where rounding moves the arc by the square root of the
 * error. Each quarter spans 45° to 90°, so its chord is at least 0.76 ×
 * radius and rounding barely moves its centre.
 */
export function largeArc(
  from: Point,
  to: Point,
  radius: number,
  clockwise: boolean,
) {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const chord = Math.hypot(dx, dy);
  // SVG draws nothing for an arc whose ends coincide.
  if (chord === 0) return "";
  // SVG enlarges the radius until the chord fits.
  const r = Math.max(radius, chord / 2);
  // SVG places a large arc's centre off the chord's midpoint along
  // (-dy, dx) when clockwise and the opposite way otherwise; clockwise on
  // screen is towards positive angles.
  const turn = clockwise ? 1 : -1;
  const offset = (turn * Math.sqrt(r * r - (chord / 2) ** 2)) / chord;
  const cx = (from.x + to.x) / 2 - dy * offset;
  const cy = (from.y + to.y) / 2 + dx * offset;
  const start = Math.atan2(from.y - cy, from.x - cx);
  // The large arc is the whole circle minus the short arc between the ends.
  const span = turn * (2 * Math.PI - 2 * Math.asin(chord / 2 / r));
  const arc = `A ${svgCoordinate(r)},${svgCoordinate(r)} 0 0,${clockwise ? 1 : 0}`;
  let d = "";
  for (let quarter = 1; quarter <= 4; quarter++) {
    const angle = start + (span * quarter) / 4;
    const point =
      quarter === 4
        ? to
        : { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    d += `${arc} ${svgPair(point)} `;
  }
  return d;
}

export function arrayToPoints(array: number[]) {
  const points: Point[] = [];
  for (let i = 0; i < array.length; i += 2) {
    points.push({ x: array[i], y: array[i + 1] });
  }
  return points;
}

export function pointsToArray(points: Point[]) {
  return points.map((p) => [p.x, p.y]).flat();
}

export function pathFromPoints({
  points,
  sigilTokens,
}: {
  points: Point[];
  sigilTokens: string[];
}) {
  let d = "";
  if (points.length === 0) return "";

  // Circle at the start, drawn from the side facing the second point, where
  // the path leaves it. A lone letter has no second point, so like a
  // repeated first letter its circle starts on the +x side.
  const ahead = points[1] ?? points[0];
  const start = pointFromEndOfLine(ahead, points[0], -1);
  const end = pointFromEndOfLine(ahead, points[0], 1);
  d +=
    `M ${svgPair(end)} ` +
    largeArc(end, start, 1, false) +
    largeArc(start, end, 1, false);

  // Connecting line
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      prev = points[i - 1],
      next = points[i + 1];

    // `prev` always exists here: the loop starts at the second point.
    if (next) {
      // On (near-) straight lines, do a loop to emphasize that the
      // point is indeed part of the sigil and we're not just passing
      // through.
      const range = 10;
      const angle = Math.abs(
        toDegrees(angleBetweenTwoPointsAndVertex(prev, next, p)),
      );
      if (angle > 180 - range && angle < 180 + range) {
        const r = 1;
        const justBefore = pointAtFractionOfLine(prev, p, 0.9);

        d += `L ${svgPair(justBefore)} `;
        d += largeArc(justBefore, p, r, true);
        d += largeArc(p, justBefore, r, true);
        d += largeArc(justBefore, p, r, true);
        continue;
      } /* if (near-) straight line */

      // If the next token is the same token, do a squiqqle
      if (sigilTokens[i] === sigilTokens[i + 1]) {
        const justBefore = pointFromEndOfLine(prev, p, 0.7);
        const justBefore2 = pointFromEndOfLine(prev, p, 0.35);
        const nextNext = points[i + 2];
        // The squiggle bends away from where the path goes next; a repeat
        // at the very end has no next point and bends the default way.
        const side =
          nextNext &&
          toDegrees(angleBetweenTwoPointsAndVertex(prev, nextNext, p)) < 0
            ? "1"
            : "0";
        d += `L ${svgPair(justBefore)} `;
        d += `A 2,1 0 1,${side} ${svgPair(justBefore2)}`;
        d += `A 2,1 0 1,${side} ${svgPair(p)}`;
        i++;
        continue;
      }
    } /* if (next) */

    d += `L ${svgPair(p)} `;
  } /* for (point) */

  // Small perpendicular line at the end
  if (points.length > 1) {
    const lastPoint = points[points.length - 1];
    const secondLastPoint =
      points[
        points.length -
          (sigilTokens[points.length - 1] === sigilTokens[points.length - 2] &&
          points.length > 2
            ? 3
            : 2)
      ];
    const finalPoints = calculatePerpendicularPointsAtEnd(
      { x: secondLastPoint.x, y: secondLastPoint.y },
      { x: lastPoint.x, y: lastPoint.y },
      2,
    );

    d += "L " + finalPoints.map(svgPair).join(" L ");
  }

  return d;
}

export function objective(points: Point[], x: number[]) {
  let score = 0;
  const points2 = arrayToPoints(x);

  // Angles between the points
  for (let i = 1; i < points2.length - 1; i++) {
    let angle = Math.abs(
      toDegrees(
        angleBetweenTwoPointsAndVertex(
          points2[i - 1],
          points2[i + 1],
          points2[i],
        ),
      ),
    );
    if (angle > 180) angle -= 180;
    // [REWARD] Wider angles are better, less overlap, clearer to see.
    score += angle;
  }

  // Distance between computed points and their original centers
  const MAX_DISTANCE_FROM_ORIGIN = 4.6;
  for (let i = 0; i < points.length; i++) {
    const distance = lengthBetweenTwoPoints(points[i], points2[i]);
    // [PENALIZE] points that are too far away from their original center
    if (distance > MAX_DISTANCE_FROM_ORIGIN) score -= 50 * distance;
  }

  // Reward based on distance between all points around same center
  const repeatedPoints: Record<string, number[]> = {};
  for (let i = 0; i < points2.length; i++) {
    const pStr = points2[i].x.toFixed(2) + "," + points2[i].y.toFixed(2);
    const rp = repeatedPoints[pStr] || (repeatedPoints[pStr] = []);
    rp.push(i);
  }
  for (const indices of Object.values(repeatedPoints)) {
    for (let i = 1; i < indices.length; i++) {
      const idx = indices[i];
      const d = lengthBetweenTwoPoints(points2[idx], points2[idx - 1]);
      score += d / 9;
    }
  }

  return score;
}

/** Letter centres for a rectified sigil; letters off the rose are the caller's error. */
export function sigilPoints(sigilText: string): Point[] {
  return sigilText.split("").map((letter) => letterPoint(letter));
}

type NloptModule = {
  ready: Promise<unknown>;
  Algorithm: { LN_COBYLA: number };
  Optimize: new (
    algorithm: number,
    dimensions: number,
  ) => {
    setMaxObjective(
      objective: (x: number[]) => number,
      tolerance: number,
    ): void;
    setMaxeval(count: number): void;
    optimize(start: number[]): { x: number[] };
  };
  GC: { flush(): void };
};
type ProcessEvent = "unhandledRejection" | "uncaughtException";
let nloptModule: Promise<NloptModule> | undefined;

/**
 * Loads the optimiser once per runtime. Its Emscripten glue registers
 * process-wide abort handlers on load in Node, which would replace every
 * later server diagnostic with a WASM abort message; remove exactly those.
 */
async function loadNlopt(): Promise<NloptModule> {
  const node =
    typeof process === "object" && typeof process.listeners === "function"
      ? (process as NodeJS.EventEmitter)
      : null;
  const events: ProcessEvent[] = ["unhandledRejection", "uncaughtException"];
  const before = new Map(
    events.map((event) => [event, new Set(node?.listeners(event) ?? [])]),
  );
  // The bundler's namespace for this CommonJS module is a snapshot taken before
  // `ready` attaches the classes, so always go through the live default export.
  const nlopt = (await import("nlopt-js")).default as NloptModule;
  await nlopt.ready;
  if (node)
    for (const event of events)
      for (const listener of node.listeners(event))
        if (!before.get(event)?.has(listener))
          node.removeListener(event, listener as (...args: unknown[]) => void);
  return nlopt;
}

/**
 * Spreads the connecting path with COBYLA so repeated and collinear letters
 * stay readable. Bounded by evaluations, never by wall-clock time, so the
 * browser and the server converge on the same layout.
 */
export async function optimizeSigilPoints(points: Point[]): Promise<Point[]> {
  if (points.length === 0) return [];
  let nlopt: NloptModule;
  try {
    nlopt = await (nloptModule ??= loadNlopt());
  } catch (error) {
    nloptModule = undefined;
    throw error;
  }
  const opt = new nlopt.Optimize(nlopt.Algorithm.LN_COBYLA, 2 * points.length);
  try {
    opt.setMaxObjective(objective.bind(null, points), 1e-4);
    opt.setMaxeval(SIGIL_MAX_EVALUATIONS);
    const result = opt.optimize(pointsToArray(points));
    return arrayToPoints(result.x);
  } finally {
    nlopt.GC.flush();
  }
}
