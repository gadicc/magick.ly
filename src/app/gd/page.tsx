import GradeTree from "@/components/gd/GradeTree";
import Tiles from "@/components/Tiles";

const tiles = [
  {
    Component: () => <GradeTree height="120%" />,
    title: "Grades",
    to: "/gd/grades",
  },
  {
    img: "/pics/Anxfisa_Golden_Dawn_Robes.jpg",
    title: "Rituals",
    to: "/gd/rituals",
  },
  {
    Component: () => (
      <div
        style={{
          marginTop: 50,
          textAlign: "center",
          fontSize: "200%",
          color: "black",
          textDecoration: "none",
        }}
      >
        Sigils
      </div>
    ),
    title: "Sigils",
    to: "/gd/sigils",
  },
  {
    Component: () => (
      <div
        style={{
          marginTop: 30,
          textAlign: "center",
          fontSize: "300%",
          color: "black",
          textDecoration: "none",
        }}
      >
        ✭
      </div>
    ),
    title: "Symbols",
    to: "/gd/symbols",
  },
];

function GD() {
  return <Tiles tiles={tiles} />;
}

export default GD;
