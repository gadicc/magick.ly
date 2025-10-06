"use client";
import React from "react";
import { PlanetId } from "@/../data/astrology/Planets";
import data from "@/../data/data";

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

/*
const branches: PlanetId[] = [
  "sol",
  "mars",
  "jupiter",
  "saturn",
  "luna",
  "mercury",
  "venus",
];
*/

const branches: PlanetId[] = [
  "venus",
  "mercury",
  "sol",
  "mars",
  "jupiter",
  "saturn",
  "luna",
];

function Branch({ index }: { index: number }) {
  const radius = 7.4; // TODO, work it out properly
  const center = degreesToPointOnCircle((index * 360) / 7 - 90, 25 + radius);

  const planetId = branches[index];
  const planet = data.planet[planetId];
  // console.log(planet);
  const texts = [
    planet.archangel?.name.he,
    planet.hebrewLetter?.letter?.he,
    planet.name.he.he,
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
  const rotation = (360 / 7) * index;

  return (
    <g transform={`rotate(${rotation} ${center.x} ${center.y})`}>
      <circle
        cx={center.x}
        cy={center.y}
        r={radius}
        fill="none"
        stroke="black"
        strokeWidth="0.5"
      />
      <path
        d={`M ${bottom.x} ${bottom.y} L ${topLeft.x} ${topLeft.y} L ${topRight.x} ${topRight.y} L ${bottom.x} ${bottom.y}`}
        fill="none"
        stroke="black"
        strokeWidth="0.5"
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
        {planet.symbol}
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

export default React.forwardRef(function SevenBranchedCandleStick(
  _opts,
  ref: React.Ref<SVGSVGElement>,
) {
  const indexes = [0, 1, 2, 3, 4, 5, 6];

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
        strokeWidth=".5"
      />
      <circle
        cx="0"
        cy="0"
        r="25"
        fill="none"
        stroke="black"
        strokeWidth=".5"
      />

      {/* Heptagram */}
      {(function () {
        // Start from bottom left corner, to top, etc.
        const orderedIndexes = [4, 0, 3, 6, 2, 5, 1, 4];
        const d =
          "M " +
          orderedIndexes
            .concat([0])
            .map((i) => {
              const p = degreesToPointOnCircle(
                (i * 360) / indexes.length - 90,
                25,
              );
              return `${p.x} ${p.y}`;
            })
            .join(" L ");
        return <path d={d} fill="none" stroke="black" strokeWidth=".5" />;
      })()}

      {indexes.map((i) => (
        <Branch key={i} index={i} />
      ))}
    </svg>
  );
});
