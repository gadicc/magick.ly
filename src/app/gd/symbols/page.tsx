import SevenBranchedCandleStick from "@/components/gd/SevenBranchedCandleStick";
// import { FylfotCross } from "../../pages/hogd/symbols/fylfot-cross";
import TableOfShewbread from "@/components/gd/TableOfShewbread";
import Tiles from "@/components/Tiles";

const tiles = [
  {
    Component: () => (
      <div
        style={{
          marginTop: 10,
          fontSize: "500%",
          textAlign: "center",
          color: "black",
        }}
      >
        卍
      </div>
    ),
    // img: "/pics/treeOfLife.jpg",
    title: "Fylfot Cross",
    to: "symbols/fylfot-cross",
  },
  {
    Component: () => <SevenBranchedCandleStick />,
    // img: "/pics/treeOfLife.jpg",
    title: "7B Candlestick",
    to: "symbols/candlestick",
  },
  {
    Component: () => <TableOfShewbread />,
    // img: "/pics/treeOfLife.jpg",
    title: "Shewbread Table",
    to: "symbols/shewbread",
  },
];

function Symbols() {
  return <Tiles tiles={tiles} />;
}

export default Symbols;
