import Image from "next/image";
import Tiles from "@/components/Tiles";

import ReadingImgTile from "./img/reading.webp";
import ReferenceImgTile from "./img/reference.webp";

const tiles = [
  {
    title: "Reading",
    to: "/geomancy/reading",
    Component: () => (
      <Image
        src={ReadingImgTile}
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        alt="Geomancy Reading"
        sizes="(max-width: 1200px) 300px"
      />
    ),
  },
  {
    title: "Reference",
    to: "/geomancy/reference",
    Component: () => (
      <Image
        src={ReferenceImgTile}
        style={{ objectFit: "cover", width: "100%", height: "100%" }}
        alt="Geomancy Reference"
        sizes="(max-width: 1200px) 300px"
      />
    ),
  },
];

function GeomancyPage() {
  return (
    <>
      <Tiles tiles={tiles} />
    </>
  );
}

export default GeomancyPage;
