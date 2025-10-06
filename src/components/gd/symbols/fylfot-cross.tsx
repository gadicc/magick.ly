import data from "@/../data/data";

const colorFromElement = {
  fire: "red",
  water: "blue",
  air: "yellow",
  earth: "#333",
};

const flashingColorFromColor = {
  red: "green",
  blue: "yellow",
  yellow: "purple",
  "#333": "red",
};

function elementFromPos(row: number, col: number) {
  if (row < 2) return col < 3 ? "fire" : "water";
  if (row === 2) {
    if (col === 2) return "sol";
    return col < 2 ? "earth" : "water";
  }
  if (row > 2) return col < 2 ? "earth" : "air";
  return "invalid-position";
}

export const fylfot = [
  ["fire", "sagittarius", "leo", null, "water"],
  [null, null, "aries", null, "pisces"],
  ["taurus", "capricorn", "sol", "cancer", "scorpio"],
  ["virgo", null, "libra", null, null],
  ["earth", null, "aquarius", "gemini", "air"],
];

export function typeFromId(id) {
  if (id === "sol") return "planet";
  if (["earth", "air", "water", "fire"].includes(id)) return "element";
  return "zodiac";
}

export default function FylfotCross({
  cells = fylfot,
  onClick,
  showColors = true,
}: {
  cells: (string | null)[][];
  onClick?: (
    id: string | null,
    rowIndex: number,
    colIndex: number,
    correctId: string,
  ) => void;
  showColors: boolean;
}) {
  console.log(cells);

  return (
    <table>
      <style jsx>{`
        table {
          margin: 20px auto;
          border-collapse: collapse;
        }
        td {
          width: 1.5em;
          font-size: 200%;
          text-align: center;
          vertical-align: middle;
        }
        td:not(:empty) {
          border: 1px solid black;
        }
      `}</style>
      <tbody>
        {cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((id, colIndex) => {
              const correctId = fylfot[rowIndex][colIndex];
              const isCorrect = id === correctId;

              const _onClick = () =>
                onClick && onClick(id, rowIndex, colIndex, correctId as string);

              let background: undefined | string = undefined;
              let color: undefined | string = undefined;
              const opacity = isCorrect ? 1 : 0.5;

              if (showColors && id !== "sol") {
                const element = elementFromPos(rowIndex, colIndex);
                background = colorFromElement[element] as string;
                color = flashingColorFromColor[background];
              }
              const style = { background, color, opacity };

              if (id === null) return <td key={colIndex} />;
              if (id === "")
                return (
                  <td
                    key={colIndex}
                    onClick={_onClick}
                    style={{
                      ...style,
                      cursor: onClick ? "pointer" : undefined,
                    }}
                  >
                    &nbsp;
                  </td>
                );
              if (id === "cursor")
                return (
                  <td
                    key={colIndex}
                    style={{
                      ...style,
                      border: "2px solid " + (showColors ? color : "red"),
                    }}
                  >
                    &nbsp;
                  </td>
                );

              const type = typeFromId(id);
              const item = data[type][id];
              // console.log([id, type, item]);

              return (
                <td
                  key={colIndex}
                  onClick={_onClick}
                  style={{
                    ...style,
                    cursor: onClick ? "pointer" : undefined,
                    fontFamily: "monospace !important",
                  }}
                >
                  {
                    // U+FE0E is Unicode Variation Selector VS15,
                    // i.e. prefer text character to emoji, so
                    // we can style it ourselves.
                    item.symbol + "\uFE0E"
                  }
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
