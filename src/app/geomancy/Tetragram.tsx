import { tetragram as tetragrams } from "@/../data/data";

function Tetragram({
  id,
  width,
  height,
  x,
  y,
}: {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
});

function Tetragram({
  rows,
  width,
  height,
  x,
  y,
}: {
  rows: (1 | 2)[];
  width?: number;
  height?: number;
  x?: number;
  y?: number;
});

function Tetragram({
  id,
  rows,
  width,
  height = 50,
  x,
  y,
}: {
  id?: string;
  rows?: (1 | 2)[];
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}) {
  if (!(rows || id))
    throw new Error("Tetragram, either `id` or `rows` must be specified");
  if (id) {
    const tetragram = tetragrams[id];
    if (!tetragram) throw new Error(`No Tetragram with id "${id}"`);
    rows = tetragram.rows;
  }
  if (!rows) throw new Error("No rows (TypeScript says this can happen)");

  const radius = 3;
  const padding = 3;

  const rowHeight = padding + 2 * radius;
  const viewBoxHeight = rows.length * rowHeight + padding;
  const viewBoxWidth = 4 * (radius + padding);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      // viewBox="0 0 316 600"
      // viewBox={"0 0 " + canvasWidth + " " + canvasHeight}
      viewBox={`-${viewBoxWidth / 2} 0 ${viewBoxWidth} ${viewBoxHeight}`}
      width={width}
      height={height}
      x={x}
      y={y}
      // style={{ border: "1px solid black" }}
    >
      {rows.map((n, i) =>
        n === 2 ? (
          <g key={i}>
            <circle
              cx={-(radius + padding) + 1.5}
              cy={padding + radius + i * rowHeight}
              r={radius}
            />
            <circle
              cx={radius + padding - 1.5}
              cy={padding + radius + i * rowHeight}
              r={radius}
            />
          </g>
        ) : (
          <circle
            key={i}
            cx={0}
            cy={padding + radius + i * rowHeight}
            r={radius}
          />
        ),
      )}
    </svg>
  );
}

export default Tetragram;
