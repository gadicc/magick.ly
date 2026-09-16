/**
 * Rose-cross sigil geometry shared by the interactive component and the server
 * renderer. Everything is deterministic for a given letter sequence, including
 * the layout optimisation, which is bounded by evaluation count rather than
 * time so both sides agree.
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

function calculatePerpendicularPointsAtEnd(
  point1: Point,
  point2: Point,
  distance: number,
): [Point, Point] {
  // Calculate slope of original line
  const slope = (point2.y - point1.y) / (point2.x - point1.x);

  // Calculate slope of perpendicular line
  const perpSlope = -1 / slope;

  // Choose a point on the original line
  const targetPoint = point2;

  // Calculate y-intercept of perpendicular line
  const yIntercept = targetPoint.y - perpSlope * targetPoint.x;

  // Calculate two points on perpendicular line
  const pointA = {
    x: targetPoint.x + distance / Math.sqrt(1 + perpSlope ** 2),
    y:
      perpSlope * (targetPoint.x + distance / Math.sqrt(1 + perpSlope ** 2)) +
      yIntercept,
  };
  const pointB = {
    x: targetPoint.x - distance / Math.sqrt(1 + perpSlope ** 2),
    y:
      perpSlope * (targetPoint.x - distance / Math.sqrt(1 + perpSlope ** 2)) +
      yIntercept,
  };

  return [pointA, pointB];
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
  const frac = distance / length;
  return pointAtFractionOfLine(p1, p2, 1 - frac);
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

  // Circle at the start
  const start = points[1]
    ? pointFromEndOfLine(points[1], points[0], -1)
    : { x: points[0].x - 1, y: points[0].y };
  const end = points[1]
    ? pointFromEndOfLine(points[1], points[0], 1)
    : { x: points[0].x + 1, y: points[0].y };
  d +=
    `M ${end.x},${end.y} ` +
    `A 1,1 0 1,0 ${start.x},${start.y} ` +
    `A 1,1 0 1,0 ${end.x},${end.y} `;

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

        d += "L " + justBefore.x + "," + justBefore.y + " ";
        d += `A ${r},${r} 0 1,1 ${p.x},${p.y} `;
        d += `A ${r},${r} 0 1,1 ${justBefore.x},${justBefore.y} `;
        d += `A ${r},${r} 0 1,1 ${p.x},${p.y} `;
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
        d += "L " + justBefore.x + "," + justBefore.y + " ";
        d += `A 2,1 0 1,${side} ${justBefore2.x},${justBefore2.y}`;
        d += `A 2,1 0 1,${side} ${p.x},${p.y}`;
        i++;
        continue;
      }
    } /* if (next) */

    d += "L " + p.x + "," + p.y + " ";
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

    d += "L " + finalPoints.map((p) => p.x + "," + p.y).join(" L ");
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
