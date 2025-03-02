import React from "react";
import dotProp from "dot-prop";

import Data from "@/../data/data";
const _sephirot = Object.values(Data.sephirah);
const _paths = Data.tolPath;

// Draw order, which paths are "on top" of which, for clarity
// prettier-ignore
const orderedPaths = {
  hebrew: [
    "4_5", "2_3", "7_8", // alef, shin, mem
    "1_2", "1_3", "1_6", // he, vav, dalet
    "2_5", "3_4", // zayin, qof <-- paths specific to hebrew tree
    "2_4", "2_6", "3_5", "3_6",
    "4_6", "4_7", "5_6", "5_8", "6_7", "6_8", "6_9", "7_9", "8_9", "9_10",
  ],
  hermetic: [
    "4_5", "2_3", "7_8",
    "1_2", "1_3", "1_6", "2_4", "2_6", "3_5", "3_6",
    "4_6", "4_7", "5_6", "5_8", "6_7", "6_8", "6_9", "7_9", "8_9", "9_10",
    "7_10", "8_10", // paths specific to hermetic tree
  ]
};

const firstUpper = (string) => string[0].toUpperCase() + string.substr(1);

function LineOutline({ x1, y1, x2, y2, offset = 5, ...args }) {
  const theta = Math.PI / 2 - Math.atan((x2 - x1) / (y2 - y1));
  const xd = Math.sin(theta) * offset;
  const yd = Math.cos(theta) * offset;

  return (
    <path
      {...args}
      d={
        `M ${x1 - xd},${y1 + yd} L ${x1 + xd},${y1 - yd} ` +
        `L ${x2 + xd},${y2 - yd} L ${x2 - xd},${y2 + yd} z`
      }
    />
  );
}

/*
 * Note: originally I used a lot of CSS classes, which worked superbly in the
 * browser, but was very inconsistent when exporting into external programs.
 */

function TreeOfLife({
  width,
  height,
  labels,
  colorScale,
  field,
  topText = "index",
  bottomText = "",
  letterAttr = "hermetic",
  active,
  pathHref,
  sephirahHref,
  activePath,
  flip,
  showDaat,
  fontSize,
  ref,
}: {
  width?: string | number;
  height?: string | number;
  labels?;
  colorScale?;
  field?;
  topText?: string;
  bottomText?: string;
  letterAttr?: string;
  active?;
  pathHref?;
  sephirahHref?;
  activePath?;
  flip?;
  showDaat?;
  fontSize?;
  ref: React.RefObject<SVGSVGElement>;
}) {
  const color = colorScale ? colorScale + "Web" : "queenWeb";
  width = width || "100%";
  field = field || "index";

  sephirahHref = sephirahHref || ((s) => "/kabbalah/sephirah/" + s.data.id);
  pathHref = pathHref || ((path) => "/kabbalah/path/" + path.id);

  if (!labels)
    labels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
      field
        .split(",")
        .map((field) => dotProp.get(_sephirot[i], field))
        .join(" ")
    );

  const topTextArr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
    topText
      .split(",")
      .map((path) => dotProp.get(_sephirot[i], path))
      .join(" ")
  );
  const bottomTextArr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
    bottomText
      .split(",")
      .map((path) => dotProp.get(_sephirot[i], path))
      .join(" ")
  );

  const fontSizeFromFieldName = {
    index: 32,
    "name.en": 10,
    "name.he": 20,
    "name.roman": 12,
    "godName.name.he": 20,
  };

  if (!fontSize) fontSize = fontSizeFromFieldName[field] || 10;

  const constructRadius = 128.5;
  const intersectionOffset = (constructRadius / 2) * Math.sqrt(3);
  const strokePadding = 2;
  const showConstructionCircles = false;

  const sephirahRadius = 40;
  const canvasWidth = 2 * (constructRadius + sephirahRadius + strokePadding);
  const canvasHeight =
    4 * constructRadius + 2 * (sephirahRadius + strokePadding);

  // prettier-ignore
  const pillar = [
    { name: "severity", x: -intersectionOffset },
    { name: "equilibrium", x: 0 },
    { name: "mercy", x: intersectionOffset },
  ];

  const rowStart = sephirahRadius + strokePadding;
  const rowGap = constructRadius / 2;

  // prettier-ignore
  const sephirot = [
    { x: pillar[1].x, y: rowStart+rowGap*0, data: _sephirot[0], color: _sephirot[0].color[color], text: labels[0], textColor: _sephirot[0].color[color+'Text'] },
    { x: pillar[2].x, y: rowStart+rowGap*1, data: _sephirot[1], color: _sephirot[1].color[color], text: labels[1], textColor: _sephirot[1].color[color+'Text'] },
    { x: pillar[0].x, y: rowStart+rowGap*1, data: _sephirot[2], color: _sephirot[2].color[color], text: labels[2], textColor: _sephirot[2].color[color+'Text'] },
    { x: pillar[2].x, y: rowStart+rowGap*3, data: _sephirot[3], color: _sephirot[3].color[color], text: labels[3], textColor: _sephirot[3].color[color+'Text'] },
    { x: pillar[0].x, y: rowStart+rowGap*3, data: _sephirot[4], color: _sephirot[4].color[color], text: labels[4], textColor: _sephirot[4].color[color+'Text'] },
    { x: pillar[1].x, y: rowStart+rowGap*4, data: _sephirot[5], color: _sephirot[5].color[color], text: labels[5], textColor: _sephirot[5].color[color+'Text'] },
    { x: pillar[2].x, y: rowStart+rowGap*5, data: _sephirot[6], color: _sephirot[6].color[color], text: labels[6], textColor: _sephirot[6].color[color+'Text'] },
    { x: pillar[0].x, y: rowStart+rowGap*5, data: _sephirot[7], color: _sephirot[7].color[color], text: labels[7], textColor: _sephirot[7].color[color+'Text'] },
    { x: pillar[1].x, y: rowStart+rowGap*6, data: _sephirot[8], color: _sephirot[8].color[color], text: labels[8], textColor: _sephirot[8].color[color+'Text'] },
    { x: pillar[1].x, y: rowStart+rowGap*8, data: _sephirot[9], color: _sephirot[9].color[color], text: labels[9], textColor: _sephirot[9].color[color+'Text'] },
  ];

  if (showDaat)
    sephirot.push({
      x: pillar[1].x,
      y: rowStart + rowGap * 2,
      data: _sephirot[10],
      color: _sephirot[10].color[color],
      text: labels[10],
      textColor: _sephirot[10].color[color + "Text"],
    });

  //console.log(sephirot);

  let pathsToDraw = orderedPaths[letterAttr];
  if (activePath) {
    // Bring activePath to top
    pathsToDraw = pathsToDraw.filter((x) => x !== activePath);
    pathsToDraw.unshift(activePath);
  }

  // Map to path data with that id
  pathsToDraw = pathsToDraw.map((id) => _paths[id]).reverse();

  const outerSephirot = activePath && activePath.split("_").map(Number);

  function sephirahOpacity(sephirah) {
    if (!active && !activePath) return 1;

    if (active && active === sephirah.data.id) return 1;

    if (activePath) {
      if (outerSephirot.includes(sephirah.data.index)) return 1;
    }

    return 0.1;
  }

  function pathLetterPos(path) {
    // Adjust position on path to avoid being covered over by other paths
    // prettier-ignore
    const specialPositions = {
      hebrew: {
        '2_5': 0.3,   '3_4': 0.3,   // Half way to 2_5,3_4 intersection
        '2_6': 0.333, '3_6': 0.333, // Level with y-cent of 1_6, 2_4, 3_5
        '6_9': 0.635                // Visible between 7_8 and Yesod
      },
      hermetic: {
        '2_6': 0.333, '3_6': 0.333, // In line with Center 1_6, 2_4, 3_5
        '6_9': 0.635                // Visible between 7_8 and Yesod
      }
    };
    return specialPositions[letterAttr][path.id] || 0.5;
  }

  // const innerRef = React.useRef<SVGSVGElement>(null);
  // React.useImperativeHandle(ref, () => innerRef.current);

  if ("useEffect" in React) {
    // doesn't exist on the server.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      ref?.current?.querySelectorAll("a").forEach((a) => {
        a.onclick = function (e) {
          if (typeof window === "object") {
            e.preventDefault();
            const href = a.getAttribute("xlink:href");
            // href && router.push(href);  // TODO, maybe accept a router passed in?
            if (href) location.href = href;
          }
        };
      });
    }, [ref]);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      // viewBox="0 0 316 600"
      // viewBox={"0 0 " + canvasWidth + " " + canvasHeight}
      viewBox={
        -canvasWidth / 2 + " " + 0 + " " + canvasWidth + " " + canvasHeight
      }
      id="TreeOfLife"
      width={width}
      height={height}
      ref={ref}
    >
      <style type="text/css">
        {`
        @font-face {
          font-family: 'Noto Sans';
          src: local('Noto Sans'), url('https://magick.ly/fonts/NotoSans-Regular.ttf') format('truetype')
        }
        @font-face {
          font-family: 'Noto Sans Hebrew';
          src: local("Noto Sans Hebrew"), url('https://magick.ly/fonts/NotoSansHebrew-Regular.ttf') format('truetype')
        }
        svg#TreeOfLife {
          font-family: 'Noto Sans', 'Noto Sans Hebrew', Arial, sans-serif;
        }
        a:visited * {
          fill: inherit;
        }
      ` + (flip && "svg#TreeOfLife { transform: rotateY(180deg) }")}
      </style>
      {/* Paths */}
      <g
        id="paths"
        style={{
          stroke: "#000",
          strokeWidth: 3,
          fill: "#fff",
          paintOrder: "stroke fill markers",
        }}
      >
        {pathsToDraw.map((path) => {
          const parts = path.id.split("_");
          const start = sephirot[Number(parts[0]) - 1];
          const end = sephirot[Number(parts[1]) - 1];

          const styleActive = { fill: "#ffa" };
          const styleInactive = { opacity: 0.2 };
          const style = activePath
            ? activePath === path.id
              ? styleActive
              : styleInactive
            : null;

          return (
            // @ts-expect-error: later
            <a key={path.id} id={"path" + path.id} xlinkHref={pathHref(path)}>
              <LineOutline
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                offset={8.5}
                style={style}
              />
              {/*
                  Note: Originally it was quite nice to have each letter inside the path.
                  But for export purposes, much more helpful to have all letters in their
                  own group (to edit style as a group).  MOVED BELOW.

                <text className={"letter"+activePathClass} x={letterPos.x} y={letterPos.y}
                    textAnchor="middle" dominantBaseline="middle">
                  { path[letterAttr]?.hebrewLetter?.letter?.he }
                </text>
                */}
              <title>
                {(function () {
                  // React is super strict that we'll only return ONE thing here.
                  let out =
                    "Letter: " + path[letterAttr]?.hebrewLetter?.letter?.he;
                  if (letterAttr === "hermetic" && path.hermetic)
                    out +=
                      ", pathNo: " +
                      (path.hermetic.pathNo ?? "?") +
                      ", tarotId: " +
                      (path.hermetic.tarotId ?? "?");
                  return out;
                })()}
              </title>
            </a>
          );
        })}
      </g>
      <g id="pathLetters" style={{ fontSize: "100%" }}>
        {pathsToDraw.map((path) => {
          const parts = path.id.split("_");
          const start = sephirot[Number(parts[0]) - 1];
          const end = sephirot[Number(parts[1]) - 1];

          const shift = pathLetterPos(path);
          const letterPos = {
            x: start.x + (end.x - start.x) * shift,
            y: start.y + (end.y - start.y) * shift,
          };

          const styleActive = {};
          const styleInactive = { opacity: 0.2 };
          const style = activePath
            ? activePath === path.id
              ? styleActive
              : styleInactive
            : null;

          return (
            // @ts-expect-error: later
            <a key={path.id} id={"path" + path.id} xlinkHref={pathHref(path)}>
              <text
                key={path.id}
                style={style || undefined}
                x={letterPos.x}
                y={letterPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {path[letterAttr]?.hebrewLetter?.letter?.he}
              </text>
            </a>
          );
        })}
      </g>
      <g id="sephirot">
        {sephirot.map((s, i) => (
          // @ts-expect-error: later
          <a key={i} id={s.data.id} xlinkHref={sephirahHref(s)}>
            <circle
              cx={s.x}
              cy={s.y}
              r={sephirahRadius}
              fill={s.color.match(",") ? null : s.color}
              style={{
                // Override a:visited * { inherit } from style.
                fill: s.color.match(",") ? null : s.color,
              }}
              // @ts-expect-error: later
              stroke={s.data.color.strokeColor || "#000"}
              strokeWidth="1.568"
              // @ts-expect-error: later
              strokeDasharray={s.data.color.strokeDasharray}
              opacity={sephirahOpacity(s)}
            ></circle>
            {(function () {
              const colors = s.color.split(",");
              if (colors.length > 1) {
                const out = new Array(colors.length);
                const r = sephirahRadius;
                const rads = Math.PI / 180;
                // Adapted from https://codepen.io/hari_shanx/pen/NRyPBz
                const from = { angle: 0, x: 0, y: 0 },
                  to = { angle: 0, x: 0, y: 0 };
                for (let i = 0; i < colors.length; i++) {
                  // 180 - 45; hard coded malkuth angles till we need something else
                  from.angle = (i * 360) / colors.length + 180 - 45;
                  to.angle = ((i + 1) * 360) / colors.length + 180 - 45;
                  from.x = s.x + r * Math.cos(from.angle * rads);
                  from.y = s.y + r * Math.sin(from.angle * rads);
                  to.x = s.x + r * Math.cos(to.angle * rads);
                  to.y = s.y + r * Math.sin(to.angle * rads);
                  out.push(
                    <path
                      key={i}
                      style={{
                        fill: colors[i],
                        stroke: "#000000",
                        strokeWidth: 1.568,
                      }}
                      opacity={sephirahOpacity(s)}
                      d={`M ${s.x},${s.y} L ${from.x},${from.y} A ${r},${r} 0 0,1 ${to.x},${to.y} z`}
                    />
                  );
                }
                return out;
              } else {
                return null;
              }
            })()}
            {field === "gdGrade.id" ? (
              <g>
                <circle
                  cx={s.x - 20}
                  cy={s.y}
                  r="12"
                  fill="none"
                  stroke={s.textColor || "black"}
                />
                <text
                  x={s.x - 20}
                  y={s.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={s.textColor || "black"}
                >
                  {s.text.split("=")[0]}
                </text>

                <text
                  x={s.x}
                  y={s.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={s.textColor || "black"}
                  fontSize="150%"
                >
                  =
                </text>

                <rect
                  x={s.x + 10}
                  y={s.y - 10}
                  width="20"
                  height="20"
                  fill="none"
                  stroke={s.textColor || "black"}
                />
                <text
                  x={s.x + 20}
                  y={s.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={s.textColor || "black"}
                >
                  {s.text.split("=")[1]}
                </text>
              </g>
            ) : (
              (function () {
                const texts = s.text.split(" ").filter((s) => s !== "");
                const style = {
                  // We repeat in "style" to override a:visited * { color }
                  style: { fill: s.textColor || "black" },
                  fill: s.textColor || "black",
                  fillOpacity: sephirahOpacity(s),
                  textAnchor: "middle",
                  dominantBaseline: "middle",
                  stroke: "none",
                  fontSize: fontSize,
                  fontStyle: "normal",
                  fontWeight: "normal",
                  letterSpacing: 0,
                  wordSpacing: 0,
                };
                if (texts.length > 1) {
                  return (
                    <g>
                      <text x={s.x} y={s.y - 11} {...style}>
                        {texts[0]}
                      </text>
                      <text x={s.x} y={s.y + 11} {...style}>
                        {texts.slice(1).join(" ")}
                      </text>
                    </g>
                  );
                } else {
                  return (
                    <text key={i} x={s.x} y={s.y} {...style}>
                      {s.text}
                    </text>
                  );
                }
              })()
            )}
            {(function () {
              const diameter = 64;
              const radius = diameter / 2;

              // http://digerati-illuminatus.blogspot.com/2008/05/approximating-semicircle-with-cubic.html
              const xValueInset = diameter * 0.05;
              const yValueOffset = (radius * 4.0) / 3.0;

              return (
                <g>
                  <path
                    id={"topTextPath" + i}
                    d={
                      `M ${s.x - radius},${
                        s.y
                      } c ${xValueInset},-${yValueOffset} ` +
                      `${diameter - xValueInset},-${yValueOffset} ${diameter},0`
                    }
                    style={{ fill: "none", stroke: "none" }}
                  />

                  <text
                    id={"topText_" + i}
                    style={{
                      fontStyle: "normal",
                      fontWeight: "normal",
                      fontSize: "10px",
                      letterSpacing: "-0.5px",
                      wordSpacing: "0px",
                      fill: s.textColor || "black",
                      fillOpacity: sephirahOpacity(s),
                      stroke: "none",
                      strokeWidth: "0.8px",
                      strokeLinecap: "butt",
                      strokeLinejoin: "miter",
                      strokeOpacity: 1,
                    }}
                  >
                    <textPath
                      xlinkHref={"#topTextPath" + i}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      startOffset="50%"
                    >
                      {topTextArr[i]}
                    </textPath>
                  </text>

                  <path
                    id={"bottomTextPath" + i}
                    d={
                      `M ${s.x - radius},${
                        s.y
                      } c ${xValueInset},${yValueOffset} ` +
                      `${diameter - xValueInset},${yValueOffset} ${diameter},0`
                    }
                    style={{ fill: "none", stroke: "none" }}
                  />

                  <text
                    id={"bottomText_" + i}
                    style={{
                      fontStyle: "normal",
                      fontWeight: "normal",
                      fontSize: "10px",
                      letterSpacing: "-0.5px",
                      wordSpacing: "0px",
                      fill: s.textColor || "black",
                      fillOpacity: sephirahOpacity(s),
                      stroke: "none",
                      strokeWidth: "0.8px",
                      strokeLinecap: "butt",
                      strokeLinejoin: "miter",
                      strokeOpacity: 1,
                    }}
                  >
                    <textPath
                      xlinkHref={"#bottomTextPath" + i}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      startOffset="50%"
                    >
                      {bottomTextArr[i]}
                    </textPath>
                  </text>
                </g>
              );
            })()}
          </a>
        ))}
      </g>
      {showConstructionCircles && (
        <>
          <circle
            cx={pillar[1].x}
            cy={rowStart}
            r={constructRadius}
            stroke="#f00"
            fill="white"
            fillOpacity="0.5"
          />
          <circle
            cx={pillar[1].x}
            cy={rowStart + constructRadius}
            r={constructRadius}
            stroke="#f00"
            fill="white"
            fillOpacity="0.5"
          />
          <circle
            cx={pillar[1].x}
            cy={rowStart + 2 * constructRadius}
            r={constructRadius}
            stroke="#f00"
            fill="white"
            fillOpacity="0.5"
          />
          <circle
            cx={pillar[1].x}
            cy={rowStart + 3 * constructRadius}
            r={constructRadius}
            stroke="#f00"
            fill="white"
            fillOpacity="0.5"
          />
        </>
      )}
    </svg>
  );
}

export default TreeOfLife;
