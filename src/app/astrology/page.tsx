import Link from "@magick-components/Link";
import { Box } from "@mui/material";
import Tiles from "@/components/Tiles";
import { pageMetadata } from "@/seo/metadata";
import AstrologyTile from "../img/astrology.jpeg";
import PlanetaryHoursPic from "./img/planetary-hours.webp";

export const metadata = pageMetadata("/astrology");

const tiles = [
  {
    title: "Planetary Hours",
    to: "/astrology/planetary-hours",
    img: PlanetaryHoursPic,
    alt: "Planets around a clock",
  },
  {
    title: "Planets",
    to: "/astrology/planets",
    img: "/pics/planets2013.jpg",
    alt: "Our solar system",
  },
  {
    title: "Zodiac",
    to: "/astrology/zodiac",
    img: AstrologyTile,
    alt: "zodiac wheel",
  },
];

function Astrology() {
  return (
    <>
      <Tiles tiles={tiles} />
      <Box sx={{ m: 2, fontSize: "80%" }}>
        <Link href="/about#credits">Image credits</Link>
      </Box>
    </>
  );
}

export default Astrology;
