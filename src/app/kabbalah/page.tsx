import Tiles from "@/components/Tiles";

const tiles = [
  {
    img: "/pics/treeOfLife.jpg",
    title: "Tree of Life",
    to: "/kabbalah/tree",
  },
  {
    Component: () => (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "400%" }}>יהוה</div>
        <div>שם המפורש</div>
      </div>
    ),
    title: "Shem HaMephorash",
    to: "/kabbalah/yhvh",
  },
];

function Kabbalah() {
  return <Tiles tiles={tiles} />;
}

export default Kabbalah;
