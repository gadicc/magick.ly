import React from "react";
import Tiles from "@/components/Tiles";

import PlanetaryHoursPic from "./img/planetary-hours.webp";
import AstrologyTile from "../img/astrology.jpeg";

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
  return <Tiles tiles={tiles} />;
}

export default Astrology;
