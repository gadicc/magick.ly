"use client";
import React from "react";

import zodiacs, { Zodiac } from "@/../data/astrology/Zodiac";
import tribesOfIsrael from "@/../data/kabbalah/TribesOfIsrael";

const zodiacArray = Object.values(zodiacs);

interface Point {
  x: number;
  y: number;
}

function degreesToPointOnCircle(
  degrees: number,
  radius: number,
  center: Point = { x: 0, y: 0 },
): Point {
  const radians = (degrees * Math.PI) / 180;
  // console.log(degrees, radians);
  return {
    x: radius * Math.cos(radians) + center.x,
    y: radius * Math.sin(radians) + center.y,
  };
}

const yhvH = {
  y: "י",
  h: "ה",
  v: "ו",
  H: "הּ",
};
const transToHeb = (str: string) =>
  str
    .split("")
    .map((c) => yhvH[c] || c)
    .join("");

function Branch({ zodiac, index }: { zodiac: Zodiac; index: number }) {
  const numBranches = 12;
  const radius = 8; // TODO, work it out properly
  const center = degreesToPointOnCircle(
    (-index * 360) / numBranches - 90,
    23.7 + radius,
  );

  const texts = [
    transToHeb(zodiac.tetragrammatonPermutation),
    "הוזחטילנסעצק"[index],
    tribesOfIsrael[zodiac.tribeOfIsraelId].name.he,
    // planet.archangel?.name.he,
    // planet.hebrewLetter?.letter?.he,
    // planet.name.he.he,
  ];

  // With extend radius so text is offset from the side of the triangle
  const textPaths = [
    [
      degreesToPointOnCircle(90, radius + 1, center),
      degreesToPointOnCircle(90 + 360 / 3, radius + 1, center),
    ],

    [
      // Extend the radius even further so text path (which is on the
      // bottom side of the text) still fits the top of the text below
      // the triangle.
      degreesToPointOnCircle(90 + (360 / 3) * 2, radius + 4.5, center),
      degreesToPointOnCircle(90 + 360 / 3, radius + 4.5, center),
    ],

    [
      degreesToPointOnCircle(90 + (360 / 3) * 2, radius + 1, center),
      degreesToPointOnCircle(90, radius + 1, center),
    ],
  ];
  const bottom = degreesToPointOnCircle(90, radius - 0.4, center);
  const topLeft = degreesToPointOnCircle(90 + 360 / 3, radius - 0.4, center);
  const topRight = degreesToPointOnCircle(
    90 + (360 / 3) * 2,
    radius - 0.4,
    center,
  );
  const rotation = (360 / numBranches) * -index;

  return (
    <g key={index} transform={`rotate(${rotation} ${center.x} ${center.y})`}>
      <circle
        cx={center.x}
        cy={center.y}
        r={radius}
        fill="none"
        stroke="black"
        strokeWidth="0.35"
      />
      <path
        d={`M ${bottom.x} ${bottom.y} L ${topLeft.x} ${topLeft.y} L ${topRight.x} ${topRight.y} L ${bottom.x} ${bottom.y}`}
        fill="none"
        stroke="black"
        strokeWidth="0.35"
      />

      <text
        x={center.x}
        y={center.y}
        transform={`rotate(180 ${center.x} ${center.y})`}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="4"
        fontWeight="bold"
      >
        {zodiac.symbol}
      </text>

      {texts.map((text, i) => (
        <g key={i}>
          <path
            id={`path-${index}-l${i}`}
            d={`M ${textPaths[i][0].x} ${textPaths[i][0].y} L ${textPaths[i][1].x} ${textPaths[i][1].y}`}
            fill="none"
            stroke="none"
          ></path>
          <text>
            <textPath
              fontSize="3"
              href={`#path-${index}-l${i}`}
              textAnchor="middle"
              startOffset="50%"
            >
              {texts[i]}
            </textPath>
          </text>
        </g>
      ))}
    </g>
  );
}

const innerCircleData = [
  { angelId: "raphael", kerub: "אדם", symbol: "👨" },
  { angelId: "michael", kerub: "אריה", symbol: "🦁" },
  { angelId: "gabriel", kerub: "נשר", symbol: "🦅" },
  { angelId: "uriel", kerub: "שור", symbol: "🐂" },
];

const innerRadius = 23.5;
const pentagramRadius = innerRadius * 0.45;
const innerCircleRadius = (innerRadius - pentagramRadius) / 2;

// We use this center point since Raphael's circle is not rotated when
// looking at the table.  We then rely on transform-rotate to place the
// remaining inner circles and present contents at correct angles.
const raphaelCircleCenter = degreesToPointOnCircle(
  90,
  innerRadius - innerCircleRadius,
);

const innerCircles = innerCircleData.map((data, index) => ({
  ...data,
  radius: innerCircleRadius,
  center: degreesToPointOnCircle(
    (270 + 90 * index) % 360,
    innerRadius - innerCircleRadius,
  ),
}));

function TextOnCircle({
  text,
  center,
  radius,
  position,
  offset = 0,
}: {
  text: string;
  center: Point;
  radius: number;
  position: "inner-top" | "inner-bottom";
  offset?: number;
}) {
  const fontSize = 2.5;
  const textPathId = `text-path-${text}-${position}`;
  radius -= offset;

  return (
    <g>
      <path
        id={textPathId}
        d={`M ${center.x - radius} ${center.y} A ${radius} ${radius} 0 1 ${
          position === "inner-top" ? 1 : 0
        } ${center.x + radius} ${center.y}`}
        fill="none"
        stroke="none"
      />
      <text>
        <textPath
          href={`#${textPathId}`}
          textAnchor="middle"
          dominantBaseline={
            position === "inner-top" ? "text-before-edge" : "text-after-edge"
          }
          startOffset="50%"
          fontSize={fontSize}
        >
          {text}
        </textPath>
      </text>
    </g>
  );
}

export default React.forwardRef(function TableOfShewbread(
  _opts,
  ref: React.Ref<SVGSVGElement>,
) {
  const innerTriangles = [0, 30, 60, 90].map((offset) => [
    degreesToPointOnCircle(30 + offset, innerRadius),
    degreesToPointOnCircle(150 + offset, innerRadius),
    degreesToPointOnCircle(270 + offset, innerRadius),
  ]);

  // degrees = 360 / 5 = 72;
  // offset = 270 (top point of cirlce) - 288 (degrees at index 4) = -18
  const pentagramPoints = [3, 0, 2, 4, 1].map((index) =>
    degreesToPointOnCircle(index * 72 - 18, pentagramRadius),
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      viewBox="-50 -50 100 100"
      ref={ref}
    >
      <style jsx>{``}</style>
      <circle
        cx="0"
        cy="0"
        r="40"
        fill="none"
        stroke="black"
        strokeWidth=".35"
      />
      <circle
        cx="0"
        cy="0"
        r={innerRadius}
        fill="none"
        stroke="black"
        strokeWidth=".35"
      />

      <g>
        {innerTriangles.map((triangle, i) => (
          <path
            key={i}
            d={`M ${triangle[0].x} ${triangle[0].y} L ${triangle[1].x} ${triangle[1].y} L ${triangle[2].x} ${triangle[2].y} Z`}
            fill="none"
            stroke="black"
            strokeWidth=".35"
          />
        ))}
      </g>

      <path
        d={`M ${pentagramPoints.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`}
        fill="none"
        stroke="black"
        strokeWidth=".35"
      />

      {zodiacArray.map((zodiac, i) => (
        <Branch key={i} zodiac={zodiac} index={i} />
      ))}

      <g>
        {innerCircles.map((circle, i) => (
          <g key={i} transform={`rotate(${180 + 90 * i}, 0, 0)`}>
            <circle
              cx={raphaelCircleCenter.x}
              cy={raphaelCircleCenter.y}
              r={circle.radius}
              fill="white"
              stroke="black"
              strokeWidth=".35"
            />
            <TextOnCircle
              text={circle.angelId}
              center={raphaelCircleCenter}
              radius={circle.radius}
              position="inner-top"
            />
            <text
              x={raphaelCircleCenter.x}
              y={raphaelCircleCenter.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={5}
            >
              {circle.symbol}
            </text>
            <TextOnCircle
              text={circle.kerub}
              center={raphaelCircleCenter}
              radius={circle.radius}
              position="inner-bottom"
            />
          </g>
        ))}
      </g>
    </svg>
  );
});
