import Tiles from "@/components/Tiles";

const tiles = [
  {
    Component: () => (
      <div style={{ margin: "auto", textAlign: "center" }}>72 Angels</div>
    ),
    title: "72 Angels",
    to: "/kabbalah/yhvh/72angels",
  },
];

function Kabbalah() {
  return <Tiles tiles={tiles} />;
}

export default Kabbalah;
