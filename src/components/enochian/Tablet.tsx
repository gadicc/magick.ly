import React from "react";

import enochianTablets, { EnochianTablet } from "@/../data/enochian/Tablets";
import EnochianFont from "./enochianFont";

function isCrossFromPosition(x: number, y: number) {
  if (x === 2 || x === 5 || x === 6 || x === 9) return true;
  if (y === 1 || y === 6 || y === 8) return true;
  return false;
}

function elementFromPosition(x: number, y: number) {
  if (x < 5) {
    if (y < 6) return "air";
    if (y > 6) return "earth";
  } else if (x > 6) {
    if (y < 6) return "water";
    if (y > 6) return "fire";
  }
  return "";
}

const elementColors = {
  air: "yellow",
  water: "#59f",
  fire: "#f55",
  earth: "black",
};

const tabletColors = {
  earth: {
    color: {
      default: "black",
      earth: "white",
    },
    background: "black",
    borderCross: "white",
  },
  air: {
    color: {
      default: "black",
      air: "brown",
    },
    background: "#fff100",
  },
};

function EarthSigil() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">
      <circle
        cx={0}
        cy={0}
        r={92}
        fill="none"
        stroke="black"
        strokeWidth={15}
      />
      {/* <circle cx={0} cy={0} r={1} fill="black" /> */}
      <path
        d={
          "M -10 -10 v -45 " +
          "c 0 -10, -10 -10, -20 -10" +
          "v -8 h 60 v 8" +
          "c -10 0, -20 0, -20 10" +
          "v 45 h -20"
        }
        fill="#c3b030"
        stroke="black"
      />
      <path
        d={
          "M -10 -10 v -45 " +
          "c 0 -10, -10 -10, -20 -10" +
          "v -8 h 60 v 8" +
          "c -10 0, -20 0, -20 10" +
          "v 45 h -20"
        }
        fill="#626e30"
        stroke="black"
        transform="rotate(90)"
      />
      <path
        d={
          "M -10 -10 v -45 " +
          "c 0 -10, -10 -10, -20 -10" +
          "v -8 h 60 v 8" +
          "c -10 0, -20 0, -20 10" +
          "v 45 h -20"
        }
        fill="black"
        stroke="black"
        transform="rotate(180)"
      />
      <path
        d={
          "M -10 -10 v -45 " +
          "c 0 -10, -10 -10, -20 -10" +
          "v -8 h 60 v 8" +
          "c -10 0, -20 0, -20 10" +
          "v 45 h -20"
        }
        fill="#993621"
        stroke="black"
        transform="rotate(270)"
      />
    </svg>
  );
}

function AirSigil(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-100 -100 200 200"
      {...props}
    >
      <g stroke="#000">
        <circle r={98} fill="#ff0" strokeWidth={2.5} />
        <circle r={80} fill="#774060" strokeWidth={2} />
        <g fill="#ff0" strokeWidth={1}>
          <path d="M-10.513 68.112c-1.933 0-4.687-.217-5.46-.651-.774-.484-1.16-1.258-1.16-2.321 0-1.547 2.657-2.827 5.17-3.843 1.258-.483 2.248-.943 2.973-1.377.919-.58 1.548-1.45 1.885-2.61.387-1.208.58-3.408.58-6.597v-74.386c0-3.432-.434-5.559-1.304-6.38-.871-.87-2.562-1.306-5.077-1.306-3.382 0-6.5.41-9.351 1.232-2.803.774-5.535 1.983-8.193 3.626-1.305.87-3.046 2.368-5.22 4.495-2.175 2.078-3.988 3.118-5.438 3.118-.82 0-1.402-.219-1.74-.653-.338-.435-.508-1.258-.508-2.465 0-3.432.291-6.647.871-9.643.58-2.997 1.135-4.833 1.667-5.51.531-.725 1.306-1.232 2.32-1.522 1.016-.291 2.828-.436 5.438-.436h64.38c3.094 0 5.148.097 6.163.292 1.064.144 1.886.41 2.466.797.966.675 1.763 2.513 2.392 5.509.675 2.948 1.014 6.453 1.014 10.513 0 1.258-.145 2.102-.434 2.538-.291.387-.822.58-1.595.58-1.547 0-3.456-1.112-5.728-3.337-1.112-1.061-2.03-1.884-2.754-2.464-2.9-2.272-5.97-3.939-9.209-5.002-3.19-1.112-6.766-1.668-10.73-1.668-2.513 0-4.205.436-5.075 1.305-.87.821-1.305 2.949-1.305 6.38v74.387c0 2.754.121 4.663.362 5.726.243 1.065.63 1.934 1.16 2.611.533.676 1.933 1.474 4.205 2.393 2.321.917 4.882 2.15 4.882 3.697 0 1.063-.387 1.837-1.16 2.32-.773.435-2.803.652-4.688.652z" />
          <path d="M-11.858-62.828h3.198q2.59 0 3.858.993 1.268.993 1.763 3.858.441 2.426-.11 5.127-.55 2.7-1.984 4.797Q-6.51-45.958-8-44.636q-1.488 1.269-2.425.276-.827-.938.496-2.26 3.307-3.142 2.81-6.065-.163-1.101-.99-1.708-.828-.606-1.93-.606h-1.378q-2.37 0-3.529-1.159-1.101-1.211-1.101-3.694 0-1.983.771-3.747.771-1.765 1.818-1.765.443 0 .497.167.11.166.055.662-.055.44-.055.661.11.441.44.772.331.275.663.275z" />
          <path d="M29.984-62.828h3.198q2.59 0 3.858.993 1.268.993 1.764 3.858.44 2.426-.11 5.127-.551 2.7-1.985 4.797-1.377 2.095-2.867 3.417-1.488 1.269-2.425.276-.827-.938.496-2.26 3.307-3.142 2.81-6.065-.165-1.101-.992-1.708-.826-.606-1.928-.606h-1.378q-2.37 0-3.529-1.159-1.101-1.211-1.101-3.694 0-1.983.77-3.747.772-1.765 1.82-1.765.44 0 .496.167.11.166.055.662-.055.44-.055.661.11.441.44.772.332.275.663.275zM9.063-63.4h3.198q2.59 0 3.858.993 1.268.992 1.764 3.858.44 2.426-.11 5.127-.551 2.7-1.985 4.796-1.377 2.094-2.867 3.417-1.488 1.268-2.425.277-.827-.938.496-2.26 3.307-3.144 2.81-6.065-.165-1.102-.99-1.708-.828-.607-1.93-.607H9.504q-2.37 0-3.529-1.157-1.101-1.213-1.101-3.695 0-1.983.77-3.747.772-1.764 1.82-1.764.442 0 .496.165.11.166.055.662-.055.441-.055.662.11.44.44.77.332.276.663.276zm-41.842 0h3.198q2.59 0 3.858.993 1.268.992 1.763 3.858.441 2.426-.11 5.127-.55 2.7-1.984 4.796-1.377 2.094-2.867 3.417-1.488 1.268-2.425.277-.827-.938.496-2.26 3.307-3.144 2.81-6.065-.163-1.102-.99-1.708-.827-.607-1.93-.607h-1.378q-2.37 0-3.529-1.157-1.101-1.213-1.101-3.695 0-1.983.771-3.747.771-1.764 1.82-1.764.44 0 .495.165.11.166.056.662-.056.441-.056.662.11.44.44.77.332.276.663.276z" />
        </g>
      </g>
    </svg>
  );
}

export const Sigils = {
  earth: EarthSigil,
  air: AirSigil,
};

function Grid({
  id,
  enochianFont = false,
}: {
  id: string;
  enochianFont?: boolean;
}) {
  const tablet: EnochianTablet = enochianTablets[id];
  const size = 20;
  const border = 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size * 12 + border * 2} ${size * 13 + border * 2}`}
    >
      {tablet.grid.map((row, y) =>
        row.map((letter, x) => {
          const element = elementFromPosition(x, y);
          const isCross = isCrossFromPosition(x, y);
          const fill = tabletColors[id]?.background || elementColors[element];
          const color =
            tabletColors[id]?.color?.[element] || elementColors[element];

          return (
            <React.Fragment key={"grid-" + x + "," + y}>
              <rect
                key={`r-${y}-${x}`}
                x={x * size + border}
                y={y * size + border}
                width={size}
                height={size}
                style={{
                  strokeWidth: 1.2,
                  stroke: isCross
                    ? tabletColors[id]?.border || "black"
                    : tabletColors[id]?.borderCross || "black",
                  fill: isCross ? "white" : fill,
                }}
              />
              <text
                key={`t-${y}-${x}`}
                x={x * size + size / 2 + border}
                y={y * size + size / 2 + 6 + border}
                style={{
                  fontWeight: enochianFont ? "bold" : undefined,
                  fontSize: size - 2 - (enochianFont ? 4 : 0),
                  textAnchor: "middle",
                  fill: isCross ? "black" : color || undefined,
                  ...(enochianFont ? EnochianFont.style : {}),
                }}
              >
                {letter}
              </text>
            </React.Fragment>
          );
        }),
      )}
      <rect
        x={0}
        y={0}
        width={size * 12 + border * 2}
        height={size * 13 + border * 2}
        style={{
          strokeWidth: border + 2,
          stroke: "black",
          fill: "none",
        }}
      />
    </svg>
  );
}

const Tablet = React.forwardRef(function Tablet(
  {
    id,
    enochianFont = false,
    width,
    height,
  }: {
    id: string;
    enochianFont?: boolean;
    width?: string | number;
    height?: string | number;
  },
  ref: React.Ref<SVGSVGElement>,
) {
  const Sigil = Sigils[id];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-105 0 210 297"
      width={width}
      height={height}
      style={{ border: "1px solid black" }}
      ref={ref}
    >
      <g transform="translate(-31.5,-5) scale(0.3)">
        <Sigil />
      </g>
      <g transform="translate(-94.5,48) scale(0.9)">
        <Grid id={id} enochianFont={enochianFont} />
      </g>
    </svg>
  );
});

export default Tablet;
