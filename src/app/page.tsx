import { AdminPanelSettingsTwoTone } from "@mui/icons-material";
import { useGongoOne, useGongoUserId } from "gongo-client-react";
import Tiles from "@/components/Tiles";
import GDLogoSquished from "@/goldendawn-logo-squished.svg";
import AndroidMagician from "./img/android-magician.png";
import AstrologyTile from "./img/astrology.jpeg";
import EnochianAngel from "./img/enochian-angel.webp";
import GeomancyImg from "./img/geomancy.webp";
import MagicalTemple from "./img/magical-temple.webp";
import PortaeLucis from "./img/portae_lucis_upsampled.webp";
import MagicBook from "./img/shutterstock_393367726_768x512.webp";
import StudyImg from "./img/study.webp";

const tiles = [
  {
    title: "About",
    to: "/about",
    img: "/pics/about.png",
    alt: "About Icon",
  },
  {
    title: "Astrology",
    to: "/astrology",
    img: AstrologyTile,
    alt: "Astrology Wheel",
  },
  {
    title: "Chat (MagickGPT)",
    to: "/chat",
    img: AndroidMagician,
    alt: "Android Magician",
  },
  {
    title: "Enochian",
    to: "/enochian/",
    img: EnochianAngel,
    alt: "Enochian Aethyrs",
  },
  {
    title: "Geomancy",
    to: "/geomancy/",
    img: GeomancyImg,
    alt: "A shaman pokes holes in the sand",
  },
  {
    title: "Golden Dawn",
    to: "/gd/",
    Component: () => <GDLogoSquished width="100%" />,
  },
  {
    title: "Kabbalah",
    to: "/kabbalah",
    img: PortaeLucis,
    alt: "Kabbalistic Tree of Life",
  },
  {
    title: "Magick Journal",
    to: "https://majou.app/",
    img: MagicBook,
    alt: "Glowing Magical Journal",
  },
  {
    title: "Study",
    to: "/study",
    img: StudyImg,
    alt: "Student Studying Magick",
  },
  {
    title: "Temples",
    to: "/temples",
    img: MagicalTemple,
    alt: "A Magical Temple",
  },
];

const adminTile = {
  Component: () => (
    <div style={{ textAlign: "center" }}>
      <AdminPanelSettingsTwoTone sx={{ color: "#555", fontSize: "700%" }} />
    </div>
  ),
  title: "Admin",
  to: "/admin",
};

function Index() {
  const userId = useGongoUserId();
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId }),
  );

  const _tiles = user?.admin ? [adminTile, ...tiles] : tiles;

  return <Tiles tiles={_tiles} />;
}

export default Index;
