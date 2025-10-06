import bartzabel from "@/../svg/astrology/spirits/bartzabel.svg";
import chasmodai from "@/../svg/astrology/spirits/chasmodai.svg";
import hismael from "@/../svg/astrology/spirits/hismael.svg";
import kedemel from "@/../svg/astrology/spirits/kedemel.svg";
import sorath from "@/../svg/astrology/spirits/sorath.svg";
import taphthartharath from "@/../svg/astrology/spirits/taphthartharath.svg";
import zazel from "@/../svg/astrology/spirits/zazel.svg";

const spirits = {
  bartzabel,
  kedemel,
  taphthartharath,
  chasmodai,
  sorath,
  hismael,
  zazel,
};

export default function PlanetarySpirit(props) {
  const { id, ...rest } = props;
  const Spirit = spirits[id];
  if (!Spirit) return null;
  return (
    <div
      style={{
        // padding: "0.1em",
        display: "flex",
        alignContent: "center",
        justifyContent: "center",
        ...rest,
      }}
    >
      <Spirit height="100%" width={undefined} />
    </div>
  );
}
