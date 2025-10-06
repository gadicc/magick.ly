import nlopt from "nlopt-js";
import React from "react";

const letters = [
  ["א", "מ", "ש"],
  ["פ", "ר", "ב", "ד", "ג", "ת", "כ"],
  ["ה", "ו", "ז", "ח", "ט", "י", "ל", "נ", "ס", "ע", "צ", "ק"],
];

export function letterIJ(letter: string) {
  for (let i = 0; i < letters.length; i++) {
    const row = letters[i];
    const j = row.indexOf(letter);
    if (j >= 0) {
      return [i, j];
    }
  }
  return [-1, -1];
}

interface Point {
  x: number;
  y: number;
}

function letterPoint(letter: string): Point {
  const [i, j] = letterIJ(letter);
  const points = letters[i].length;
  const slice = (2 * Math.PI) / points;
  const offset = -Math.PI / 2 - (i == 1 ? slice / 2 : 0);
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

function arrayToPoints(array: number[]) {
  const points: Point[] = [];
  for (let i = 0; i < array.length; i += 2) {
    points.push({ x: array[i], y: array[i + 1] });
  }
  return points;
}

function pointsToArray(points: Point[]) {
  return points.map((p) => [p.x, p.y]).flat();
}

function pathFromPoints({
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

    if (next) {
      if (prev) {
        // const slope = (prev.y - p.y) / (prev.x - p.x);

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
        if (next && sigilTokens[i] == sigilTokens[i + 1]) {
          // const r = 1;
          const justBefore = pointFromEndOfLine(prev, p, 0.7);
          const justBefore2 = pointFromEndOfLine(prev, p, 0.35);
          const nextNext = points[i + 2];
          const nextAngle =
            nextNext &&
            toDegrees(angleBetweenTwoPointsAndVertex(prev, nextNext, p));
          const side = nextAngle < 0 ? "1" : "0";
          d += "L " + justBefore.x + "," + justBefore.y + " ";
          d += `A 2,1 0 1,${side} ${justBefore2.x},${justBefore2.y}`;
          d += `A 2,1 0 1,${side} ${p.x},${p.y}`;
          i++;
          continue;
        }
      } /* if (prev) */
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

function objective(points: Point[], x: number[]) {
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
    // console.log(i, angle);
    // if (angle < 20) score -= angle * 100;
    // else

    // [REWARD] Wider angles are better, less overlap, clearer to see.
    score += angle;
  }
  // console.log("total", score);

  // Distance between computed points and their original centers
  const MAX_DISTANCE_FROM_ORIGIN = 4.6;
  for (let i = 0; i < points.length; i++) {
    const distance = lengthBetweenTwoPoints(points[i], points2[i]);
    // console.log("p" + i + " distance from origin: " + distance);
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

  // Length of connecting line between each point
  for (let i = 1; i < points2.length; i++) {
    // const length = lengthBetweenTwoPoints(points2[i - 1], points2[i]);
    // console.log(i, d);
    // [REWARD]
    // score -= length * 10;
  }

  // console.log("SCORE: ", score);
  return score;
}

export default React.forwardRef(function RoseSigil(
  {
    sigilText,
    showRose = true,
    animate = true,
    debug = false,
  }: {
    sigilText: string;
    showRose: boolean;
    animate: boolean;
    debug: boolean;
  },
  ref: React.Ref<SVGSVGElement>,
) {
  const sigilTokens = React.useMemo(() => sigilText.split(""), [sigilText]);
  const pathRef = React.useRef<SVGPathElement>(null);
  const points = React.useMemo(
    () => sigilTokens.map((letter) => letterPoint(letter)),
    [sigilTokens],
  );
  const [res, setRes] = React.useState<null | {
    success: boolean;
    value: number;
    x: number[];
  }>(null);

  React.useEffect(() => {
    if (points.length)
      (async () => {
        await nlopt.ready;
        const opt = new nlopt.Optimize(
          nlopt.Algorithm.LN_COBYLA,
          2 * points.length,
        );
        opt.setMaxObjective(objective.bind(null, points), 1e-4);
        const res = opt.optimize(pointsToArray(points));
        nlopt.GC.flush();
        setRes(res);
      })();
  }, [points]);

  const points2 = res && res.x && arrayToPoints(res.x);

  React.useEffect(() => {
    if (pathRef.current && points2) {
      // const animationDuration = points2.length / 4;
      const length = pathRef.current.getTotalLength();
      pathRef.current.style.strokeDasharray = animate ? length.toString() : "";
      pathRef.current.style.strokeDashoffset = animate ? length.toString() : "";
      pathRef.current.classList.remove("path");
      // @ts-expect-error: trick to trigger reflow
      void pathRef.current.offsetWidth;
      if (animate) pathRef.current.classList.add("path");
    }
  }, [animate, points2]);

  const roseStrokeColor = "rgba(0,0,0,.4)";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      viewBox="-50 -50 100 100"
      ref={ref}
    >
      <style jsx>
        {`
          .path {
            animation: dash ${sigilTokens.length / 4}s linear 0s forwards 1;
          }

          @keyframes dash {
            to {
              stroke-dashoffset: 0;
            }
          }
        `}
      </style>
      {showRose && (
        <>
          {" "}
          <circle
            cx={0}
            cy={0}
            r={10}
            stroke={roseStrokeColor}
            strokeWidth={0.5}
            fill="none"
          />
          {letters.map((row, i) => {
            const points = row.length;
            const slice = (2 * Math.PI) / points;
            const offset = -Math.PI / 2 - (i == 1 ? slice / 2 : 0);
            const radius = 10 * (i + 1) + 5;
            return (
              <React.Fragment key={i}>
                <circle
                  key={i}
                  cx={0}
                  cy={0}
                  r={10 * (i + 2)}
                  stroke={roseStrokeColor}
                  strokeWidth={0.5}
                  fill="none"
                />
                {row.map((letter, j) => {
                  const angle = offset - slice * j;
                  return (
                    <React.Fragment key={j}>
                      {debug && (
                        <circle
                          cx={radius * Math.cos(angle)}
                          cy={radius * Math.sin(angle)}
                          r={5}
                          stroke={roseStrokeColor}
                          strokeWidth={0.5}
                          strokeDasharray={0.2}
                          fill="none"
                        />
                      )}
                      <text
                        key={j}
                        x={radius * Math.cos(angle)}
                        y={radius * Math.sin(angle)}
                        fill={roseStrokeColor}
                        textAnchor="middle"
                        fontSize={10}
                        dominantBaseline="middle"
                      >
                        {letter}
                      </text>
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </>
      )}

      {debug && (
        <path
          // Connecting path
          stroke="#aa0"
          fill="none"
          d={pathFromPoints({ points, sigilTokens })}
        />
      )}

      <path
        // Connecting path
        stroke="red"
        fill="none"
        ref={pathRef}
        d={pathFromPoints({ points: points2 || points, sigilTokens })}
      />
    </svg>
  );
});
