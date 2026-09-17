import React from "react";
import {
  letterIJ,
  letterPoint,
  optimizeSigilPoints,
  type Point,
  pathFromPoints,
  ROSE_LETTERS,
  sigilPoints,
  svgCoordinate,
} from "./roseSigilGeometry";

export { letterIJ };

const roseStrokeColor = "rgba(0,0,0,.4)";

export interface RoseSigilImageProps {
  sigilText: string;
  showRose: boolean;
  debug: boolean;
  /** Letter centres to draw through; the optimised layout when available. */
  points: Point[];
  /**
   * Draw-on animation class for the connecting path, unique per instance
   * because a `<style>` inside inline SVG is document-wide; server renders
   * never animate.
   */
  animation?: string;
  svgRef?: React.Ref<SVGSVGElement>;
  pathRef?: React.Ref<SVGPathElement>;
}

/**
 * The sigil artwork with no hooks, so the server image route can render it
 * with React's server build; the interactive component adds the optimiser
 * and animation around it.
 */
export function RoseSigilImage({
  sigilText,
  showRose,
  debug,
  points,
  animation,
  svgRef,
  pathRef,
}: RoseSigilImageProps) {
  const sigilTokens = sigilText.split("");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      viewBox="-50 -50 100 100"
      ref={svgRef}
    >
      {animation && (
        <style>
          {`.${animation} { animation: ${animation} ${sigilTokens.length / 4}s linear 0s forwards 1; }
@keyframes ${animation} { to { stroke-dashoffset: 0; } }`}
        </style>
      )}
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
          {ROSE_LETTERS.map((row, i) => (
            <React.Fragment key={row.join("")}>
              <circle
                cx={0}
                cy={0}
                r={10 * (i + 2)}
                stroke={roseStrokeColor}
                strokeWidth={0.5}
                fill="none"
              />
              {row.map((letter) => {
                // Labels sit on the letter centres the path is drawn through.
                const centre = letterPoint(letter);
                const x = svgCoordinate(centre.x);
                const y = svgCoordinate(centre.y);
                return (
                  <React.Fragment key={letter}>
                    {debug && (
                      <circle
                        cx={x}
                        cy={y}
                        r={5}
                        stroke={roseStrokeColor}
                        strokeWidth={0.5}
                        strokeDasharray={0.2}
                        fill="none"
                      />
                    )}
                    <text
                      x={x}
                      y={y}
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
          ))}
        </>
      )}

      {debug && (
        <path
          // Letter centres before optimisation
          stroke="#aa0"
          fill="none"
          d={pathFromPoints({ points: sigilPoints(sigilText), sigilTokens })}
        />
      )}

      <path
        // Connecting path
        stroke="red"
        fill="none"
        ref={pathRef}
        d={pathFromPoints({ points, sigilTokens })}
      />
    </svg>
  );
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
  const pathRef = React.useRef<SVGPathElement>(null);
  // useId yields ":r1:"-style ids; CSS identifiers need the colons removed.
  const animation = `rose-sigil-draw-${React.useId().replace(/[^\w-]/g, "")}`;
  const points = React.useMemo(() => sigilPoints(sigilText), [sigilText]);
  const [optimized, setOptimized] = React.useState<Point[] | null>(null);

  React.useEffect(() => {
    if (!points.length) return;
    let cancelled = false;
    optimizeSigilPoints(points).then((result) => {
      if (!cancelled) setOptimized(result);
    });
    return () => {
      cancelled = true;
    };
  }, [points]);

  React.useEffect(() => {
    if (pathRef.current && optimized) {
      const length = pathRef.current.getTotalLength();
      pathRef.current.style.strokeDasharray = animate ? length.toString() : "";
      pathRef.current.style.strokeDashoffset = animate ? length.toString() : "";
      pathRef.current.classList.remove(animation);
      // @ts-expect-error: trick to trigger reflow
      void pathRef.current.offsetWidth;
      if (animate) pathRef.current.classList.add(animation);
    }
  }, [animate, animation, optimized]);

  return (
    <RoseSigilImage
      sigilText={sigilText}
      showRose={showRose}
      debug={debug}
      points={optimized || points}
      animation={animate ? animation : undefined}
      svgRef={ref}
      pathRef={pathRef}
    />
  );
});
