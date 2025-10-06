import { Box } from "@mui/material";
import Tablet from "@/components/enochian/Tablet";
import Tiles from "@/components/Tiles";
import dictionaryImg from "./img/dictionary.jpg";
import enochianAbc from "./img/enochianAbc.png";
import firstKey from "./img/enochianFirstKey.png";
//import aethyrs from './enochian/30aethyrs.jpg';
import orationThumb from "./img/oration-thumb.jpg";

const tiles = [
  {
    img: orationThumb,
    title: "Oration to God",
    to: "/enochian/oration",
    alt: "Oration to God",
  },
  {
    img: firstKey,
    title: "Keys / Calls",
    to: "/enochian/keys",
    alt: "Keys / Calls",
  },
  {
    img: enochianAbc,
    title: "Learn",
    to: "/study?tags=enochian",
    alt: "Enochian letters on a blackboard",
  },
  {
    img: dictionaryImg,
    title: "Dictionary",
    to: "/enochian/dictionary",
    alt: "Screenshot of the Enochian dictionary",
  },
  {
    title: "Tablets",
    to: "/enochian/tablets",
    alt: "Enochian Tablets",
    Component: () => (
      <Box height="100%" textAlign="center" marginTop={1}>
        <Tablet id="earth" height="100%" />
      </Box>
    ),
  },
];

function Enochian() {
  return <Tiles tiles={tiles} />;
}

export default Enochian;
