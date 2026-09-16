import Tiles from "@/components/Tiles";
import { pageMetadata } from "@/seo/metadata";

export const metadata = pageMetadata("/kabbalah/yhvh");

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
