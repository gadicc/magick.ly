import React, { CSSProperties } from "react";
import planets from "@/../data/astrology/Planets";
// import houses from "@/../data/astrology/Houses";
import zodiacs from "@/../data/astrology/Zodiac";
import type { Tetragram } from "@/../data/geomancy/Tetragrams";
import TetragramRender from "../Tetragram";

// type Point = { x: number; y: number };

const houseLayouts = [
  {
    index: 1,
    geoFigIdx: 2,
    indexPos: { x: -6, y: 0 },
    tetragramPos: { x: 10, y: 0 },
    planetPos: { x: -14, y: 0 },
    planetMultiDir: "vertical",
    zodiacPos: { x: -59, y: 0 },
  },
  {
    index: 2,
    geoFigIdx: 6,
    indexPos: { x: -30, y: 25 },
    tetragramPos: { x: -9, y: 20 },
    planetPos: { x: -44, y: 35 },
    zodiacPos: { x: -58, y: 25 },
  },
  {
    index: 3,
    geoFigIdx: 10,
    indexPos: { x: -25, y: 30 },
    tetragramPos: { x: 6, y: 40 },
    planetPos: { x: -18, y: 43 },
    zodiacPos: { x: -25, y: 58 },
  },
  {
    index: 4,
    geoFigIdx: 3,
    indexPos: { x: 0, y: 6 },
    tetragramPos: { x: 35, y: 33 },
    planetPos: { x: 0, y: 16 },
    zodiacPos: { x: 0, y: 59 },
  },
  {
    index: 5,
    geoFigIdx: 7,
    indexPos: { x: 25, y: 30 },
    tetragramPos: { x: 56, y: 40 },
    planetPos: { x: 33, y: 43 },
    zodiacPos: { x: 25, y: 58 },
  },
  {
    index: 6,
    geoFigIdx: 11,
    indexPos: { x: 30, y: 25 },
    tetragramPos: { x: 79, y: 20 },
    planetPos: { x: 44, y: 35 },
    zodiacPos: { x: 58, y: 25 },
  },
  {
    index: 7,
    geoFigIdx: 4,
    indexPos: { x: 6, y: 0 },
    tetragramPos: { x: 60, y: 0 },
    planetPos: { x: 15, y: 0 },
    planetMultiDir: "vertical",
    zodiacPos: { x: 59, y: 0 },
  },
  {
    index: 8,
    geoFigIdx: 8,
    indexPos: { x: 30, y: -25 },
    tetragramPos: { x: 79, y: -20 },
    planetPos: { x: 44, y: -35 },
    zodiacPos: { x: 58, y: -25 },
  },
  {
    index: 9,
    geoFigIdx: 12,
    indexPos: { x: 25, y: -30 },
    tetragramPos: { x: 56, y: -40 },
    planetPos: { x: 33, y: -43 },
    zodiacPos: { x: 25, y: -58 },
  },
  {
    index: 10,
    geoFigIdx: 1,
    indexPos: { x: 0, y: -6 },
    tetragramPos: { x: 35, y: -33 },
    planetPos: { x: 0, y: -16 },
    zodiacPos: { x: 0, y: -59 },
  },
  {
    index: 11,
    geoFigIdx: 5,
    indexPos: { x: -25, y: -30 },
    tetragramPos: { x: 6, y: -40 },
    planetPos: { x: -18, y: -43 },
    zodiacPos: { x: -25, y: -58 },
  },
  {
    index: 12,
    geoFigIdx: 9,
    indexPos: { x: -31, y: -25 },
    tetragramPos: { x: -9, y: -20 },
    planetPos: { x: -44, y: -35 },
    zodiacPos: { x: -58, y: -25 },
  },
];

/*           25px
 * 25px +--- 100px ---+ 25px
 *
 */
export default React.forwardRef(function AstroGeomancyChart(
  {
    tetragrams,
    width,
    height,
  }: {
    tetragrams: (Tetragram | null)[];
    width?: CSSProperties["width"];
    height?: CSSProperties["width"];
  },
  ref: React.Ref<SVGSVGElement>,
) {
  const innerRatio = 1 / Math.sqrt(2);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      viewBox="-65 -65 130 130"
      width={width}
      height={height}
      ref={ref}
      // style={{ border: "1px solid red" }}
    >
      <rect
        x="-50"
        y="-50"
        width="100"
        height="100"
        fill="none"
        stroke="black"
        strokeWidth=".5"
      />
      <rect
        x={-50 * innerRatio}
        y={-50 * innerRatio}
        width={100 * innerRatio}
        height={100 * innerRatio}
        fill="none"
        stroke="black"
        strokeWidth=".5"
        transform="rotate(45)"
      />

      {/* Diagonal Lines */}
      <line x1="-50" y1="-50" x2="50" y2="50" stroke="black" strokeWidth=".5" />
      <line x1="-50" y1="50" x2="50" y2="-50" stroke="black" strokeWidth=".5" />

      {/* "Tips" to center houses */}
      <line x1="0" y1="-52" y2="-50" x2="0" stroke="black" strokeWidth=".5" />
      <line x1="0" y1="50" y2="52" x2="0" stroke="black" strokeWidth=".5" />
      <line x1="-52" y1="0" x2="-50" y2="0" stroke="black" strokeWidth=".5" />
      <line x1="50" y1="0" x2="52" y2="0" stroke="black" strokeWidth=".5" />

      {houseLayouts.map((layout) => {
        // const house = houses[layout.index - 1];
        const tetragram = tetragrams[layout.geoFigIdx - 1];
        if (!tetragram) return null;

        // const houseZodiac = zodiacs[house.zodiacId];
        const tetragramZodiac =
          tetragram.zodiacId && zodiacs[tetragram.zodiacId];

        const tetragramPlanets = Array.isArray(tetragram.planetId)
          ? tetragram.planetId?.map((planetId) => planets[planetId])
          : [planets[tetragram.planetId]];
        console.log({ tetragramPlanets });

        return (
          <g key={layout.index}>
            <text
              x={layout.indexPos.x}
              y={layout.indexPos.y}
              textAnchor="middle"
              alignmentBaseline="middle"
              fontSize="5"
            >
              {layout.index}
            </text>
            {layout.zodiacPos && (
              <text
                x={layout.zodiacPos.x}
                y={layout.zodiacPos.y}
                textAnchor="middle"
                alignmentBaseline="central"
                fontSize="10"
              >
                {tetragramZodiac?.symbol}
              </text>
            )}
            {layout.planetPos &&
              (tetragramPlanets.length > 1 &&
              layout.planetMultiDir === "vertical" ? (
                <text
                  x={layout.planetPos.x}
                  y={
                    layout.planetPos.y - (tetragramPlanets.length === 1 ? 0 : 2)
                  }
                  textAnchor="middle"
                  alignmentBaseline="central"
                  fontSize={tetragramPlanets.length === 1 ? 10 : 8}
                >
                  <tspan x={layout.planetPos.x}>
                    {tetragramPlanets[0].symbol}
                  </tspan>
                  <tspan x={layout.planetPos.x} dy="1em">
                    {tetragramPlanets[1].symbol}
                  </tspan>
                </text>
              ) : (
                <text
                  x={layout.planetPos.x}
                  y={layout.planetPos.y}
                  textAnchor="middle"
                  alignmentBaseline="central"
                  fontSize={tetragramPlanets.length === 1 ? 10 : 8}
                >
                  {tetragramPlanets.map((planet) => planet.symbol).join("")}
                </text>
              ))}

            {layout.tetragramPos && (
              <TetragramRender
                rows={tetragram.rows}
                height={18}
                x={layout.tetragramPos.x - 100}
                y={layout.tetragramPos.y - 9}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
});
