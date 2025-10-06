"use client";
import {
  Box,
  Container,
  FormControlLabel,
  FormGroup,
  ListSubheader,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
import React from "react";
import { PlanetId } from "@/../data/astrology/Planets";
import data, {
  geomanicHouse as houses,
  tetragram as tetragrams,
} from "@/../data/data";
import { upcomingHoursForPlanetAtLocation } from "@/app/astrology/planetary-hours/utils";
import PlanetarySpirit from "@/components/astrology/planetarySpirits";
import CopyPasteExport, { ToastContainer } from "@/copyPasteExport";
import { capitalizeFirstLetter, ordinal } from "@/lib/utils";
import useGeoIP from "@/useGeoIP";
import Tetragram from "../Tetragram";
import { compute } from "../tetragrams";
import AstroGeomancyChart from "./AstroGeomancyChart";

const { planet: planets, archangel: archangels } = data;

// https://blog.stevenlevithan.com/archives/javascript-roman-numeral-converter
function romanize(num) {
  if (!+num) return false;
  const digits = String(+num).split("");
  // prettier-ignore
  const key = [
    "",
    "C",
    "CC",
    "CCC",
    "CD",
    "D",
    "DC",
    "DCC",
    "DCCC",
    "CM",
    "",
    "X",
    "XX",
    "XXX",
    "XL",
    "L",
    "LX",
    "LXX",
    "LXXX",
    "XC",
    "",
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
  ];
  // prettier-ignore
  let roman = "",
    i = 3;
  // @ts-expect-error: while(i--) ensures digits.pop() is defined.
  while (i--) roman = (key[+digits.pop() + i * 10] || "") + roman;
  return Array(+digits.join("") + 1).join("M") + roman;
}

function tetragramFromRows(rows) {
  for (const tetragram of Object.values(tetragrams)) {
    const tr = tetragram.rows;
    if (
      tr[0] === rows[0] &&
      tr[1] === rows[1] &&
      tr[2] === rows[2] &&
      tr[3] === rows[3]
    )
      return tetragram;
  }
  return null;
}

function interpretationText(interpretationId: string) {
  switch (interpretationId) {
    case "111":
      return (
        <span>
          A <b>good judge</b> made of <b>two good witnesses</b> is <b>good</b>.
        </span>
      );

    case "000":
      return (
        <span>
          A <b>bad judge</b> made of <b>two bad witnesses</b> is <b>bad</b>.
        </span>
      );

    case "101":
    case "011":
      return (
        <span>
          A <b>good judge</b> made of mixed <b>good & bad witnesses</b> means{" "}
          <b>success, but delay and vexation</b>.
        </span>
      );

    case "110":
      return (
        <span>
          <b>Two good witnesses</b> and a <b>bad judge</b>, the result will be{" "}
          <b>unfortunate in the end</b>.
        </span>
      );

    case "100":
      return (
        <span>
          <b>First witness is good</b> and the <b>second bad</b>, the{" "}
          <b>success will be very doubtful</b>.
        </span>
      );

    case "010":
      return (
        <span>
          <b>
            First<b> witness i</b>s bad
          </b>{" "}
          and the <b>second good</b>,{" "}
          <b>unfortunate beginning will take a good turn</b>.
        </span>
      );

    case "001":
      return (
        <span>
          A <b>good judge</b> made of <b>two bad witnesses</b> means{" "}
          <b>success after delays and problems</b> (note: sourced elsewhere).
        </span>
      );
  }
}

type TetraRow = (1 | 2)[];

function TetragramStack({
  title,
  start,
  tetraRows,
  group,
}: {
  title: string;
  start: number;
  tetraRows: TetraRow[];
  group: boolean;
}) {
  return (
    <Box sx={{ textAlign: "center" }}>
      <b>{title}</b>
      <br />
      <Stack direction="row-reverse" justifyContent="space-evenly">
        {tetraRows.map((rows, i) => (
          <Box key={i} sx={{ width: "45px", position: "relative" }}>
            {romanize(i + start)}
            <br />
            <Tetragram key={i} rows={rows} />
            <br />
            {!group && (
              <>
                <div
                  style={{
                    position: "absolute",
                    fontSize: "80%",
                    left: "50%",
                    transform: "translateX(-50%)",
                  }}
                >
                  {tetragramFromRows(rows)?.title.en}
                </div>
                <br />
              </>
            )}
          </Box>
        ))}
      </Stack>
      {group && (
        <Box>
          <ol
            start={start + 3}
            type="I"
            reversed
            style={{ fontSize: "80%", marginTop: "5px" }}
          >
            {[...tetraRows].reverse().map((rows, i) => (
              <li key={i}>{tetragramFromRows(rows)?.title.en}</li>
            ))}
          </ol>
        </Box>
      )}
    </Box>
  );
}

function GeomancyReading() {
  const ref = React.useRef(null);
  const [planetId, setPlanetId] = React.useState<PlanetId>("luna");
  const [planetHint, setPlanetHint] = React.useState(false);
  const [planetaryHour, setPlanetaryHour] = React.useState(-1);
  const geo = useGeoIP();
  const planetaryHours = React.useMemo(() => {
    if (!geo) return [];
    return upcomingHoursForPlanetAtLocation(planetId, geo).map(
      ({ from, to }, i) => ({
        value: i,
        // label: formatFromTo(from, to),
        labels: [
          format(from, "ccc"),
          format(from, "LLL do"),
          format(from, "h:mm aaa"),
          format(to, "h:mm aaa"),
        ],
      }),
    );
  }, [planetId, geo]);

  const [houseNoStr, setHouseNoStr] = React.useState("1");
  const [mothers, setMothers] = React.useState<TetraRow[]>([
    [1, 2, 1, 1],
    [1, 1, 1, 2],
    [2, 1, 1, 1],
    [1, 2, 1, 2],
  ]);

  const { daughters, nephews, witnesses, judges } = React.useMemo(
    () => compute(mothers),
    [mothers],
  );
  const allFigures = React.useMemo(
    () =>
      [...mothers, ...daughters, ...nephews, ...witnesses, ...judges].map(
        tetragramFromRows,
      ),
    [mothers, daughters, nephews, witnesses, judges],
  );

  const interpretations = [
    {
      title: "1st (Right) Witness",
      tetragram: tetragramFromRows(witnesses[0]),
      goodState: React.useState(true),
      hint: "the beginning of the matter",
    },
    {
      title: "2nd (Left) Witness",
      tetragram: tetragramFromRows(witnesses[1]),
      goodState: React.useState(true),
      hint: "the way in which the matter progreses",
    },
    {
      title: "Judge",
      tetragram: tetragramFromRows(judges[0]),
      goodState: React.useState(true),
      hint: "conclusion of the matter",
    },
  ];

  const interpretationId = interpretations
    .map((interpretation) => interpretation.goodState[0])
    .map(Number)
    .join("");

  function toggle(tetragram: number, row: number) {
    return function () {
      const newMothers = new Array(4);
      for (let ti = 0; ti < 4; ti++)
        newMothers[ti] = ti === tetragram ? [...mothers[ti]] : mothers[ti];
      newMothers[tetragram][row] = mothers[tetragram][row] === 2 ? 1 : 2;
      setMothers(newMothers);
    };
  }

  function random(tetragram: number) {
    return function () {
      const randomValues = new Uint32Array(4);
      crypto.getRandomValues(randomValues);
      const randomTetra = Array.from(
        randomValues.map((x) => (x % 2 === 0 ? 2 : 1)),
      );

      const newMothers = new Array(4);
      for (let ti = 0; ti < 4; ti++)
        newMothers[ti] = ti === tetragram ? randomTetra : mothers[ti];
      setMothers(newMothers);
    };
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: See note below.
  React.useEffect(
    () => {
      for (const interpretation of interpretations) {
        const meaning =
          interpretation.tetragram?.meanings[parseInt(houseNoStr)].en;
        const isGood = !!meaning?.match(/good|happy|success/i);
        interpretation.goodState[1](isGood);
      }
    },
    // This is intentional, we only care about mothers being changed.
    [mothers],
  );

  const planet = planets[planetId];
  const archangel = archangels[planet.archangelId];

  return (
    <>
      <Container sx={{ my: 2, textAlign: "center" }}>
        <Select
          labelId="planet-select-label"
          id="planet-select"
          value={planetId}
          onChange={(event: SelectChangeEvent) =>
            setPlanetId(event.target.value as PlanetId)
          }
        >
          <ListSubheader>
            <div>
              <style jsx>{`
                span {
                  display: inline-block;
                  text-align: left;
                  color: #aaa;
                  font-size: 15px;
                }
              `}</style>
              <span style={{ width: 20 }}>&nbsp;</span>
              <span style={{ width: 75 }}>Planet</span>
              <span style={{ width: 95 }}>Intelligence</span>
              <span style={{ width: 115 }}>Spirit</span>
            </div>
          </ListSubheader>
          {Object.values(planets)
            .filter((p) => p.spiritId)
            .map((planet) => (
              <MenuItem key={planet.id} value={planet.id}>
                <div>
                  <style jsx>{`
                    span {
                      display: inline-block;
                      text-align: left;
                      font-size: 15px;
                    }
                  `}</style>
                  <span
                    style={{ width: 20, textAlign: "center", marginRight: 5 }}
                  >
                    {planet.symbol}
                  </span>
                  <span style={{ width: 75 }}>{planet.name.en.en}</span>
                  <span style={{ width: 90 }}>
                    {capitalizeFirstLetter(planet.intelligenceId as string)}
                  </span>
                  <span style={{ width: 120 }}>
                    {capitalizeFirstLetter(planet.spiritId as string)}
                  </span>
                  {planetHint && (
                    <div
                      style={{
                        color: "#aaa",
                        maxWidth: 385,
                        fontSize: "70%",
                        whiteSpace: "normal",
                        textAlign: "left",
                        lineHeight: "1em",
                        marginTop: 5,
                      }}
                    >
                      {planet.magickTypes?.en}
                    </div>
                  )}
                </div>
              </MenuItem>
            ))}
        </Select>
        <FormGroup>
          <FormControlLabel
            label="Show planetary effect hints"
            componentsProps={{
              typography: {
                sx: {
                  fontSize: "80%",
                  color: "#aaa",
                },
              },
            }}
            sx={{
              justifyContent: "center",
              marginTop: 1,
            }}
            control={
              <Switch
                size="small"
                value={planetHint}
                onChange={(e) => setPlanetHint(e.target.checked)}
              />
            }
          />
        </FormGroup>
        <Select
          size="small"
          value={planetaryHour}
          onChange={(e) => setPlanetaryHour(e.target.value as number)}
          sx={{
            marginTop: 2,
            marginBottom: 2,
            fontSize: "90%",
            textAlign: "center",
          }}
        >
          <MenuItem value={-1}>
            <div style={{ width: "100%", textAlign: "center" }}>
              Planetary Hour for {planet.name.en.en} in {geo?.city}
            </div>
          </MenuItem>
          {planetaryHours.map(({ value, labels }) => (
            <MenuItem key={value} value={value}>
              <div
                style={{
                  display: "inline-block",
                  textAlign: "center",
                  width: 50,
                }}
              >
                {labels[0]}
              </div>
              <div
                style={{
                  display: "inline-block",
                  textAlign: "center",
                  width: 100,
                }}
              >
                {labels[1]}
              </div>
              <div
                style={{
                  display: "inline-block",
                  textAlign: "center",
                  width: 100,
                }}
              >
                {labels[2]}
              </div>
              <div
                style={{
                  display: "inline-block",
                  textAlign: "center",
                  width: 5,
                }}
              >
                -
              </div>
              <div
                style={{
                  display: "inline-block",
                  textAlign: "center",
                  width: 100,
                }}
              >
                {labels[3]}
              </div>
            </MenuItem>
          ))}
        </Select>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative" }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="-1.1 -1.1 2.2 2.2"
              style={{ width: 350 }}
            >
              <circle
                cx="0"
                cy="0"
                r="1.03"
                fill="none"
                stroke="black"
                strokeWidth="0.02"
              />
              <path
                d="M 0 -1 L 0.587785 0.809017 L -0.951057 -0.309017 L 0.951057 -0.309017 L -0.587785 0.809017 Z"
                fill="none"
                stroke="black"
                strokeWidth="0.02"
              />
            </svg>
            <PlanetarySpirit
              id={planet.spiritId}
              width={70}
              height={70}
              position="absolute"
              top="39%"
              left="40%"
              //border="1px solid black"
            />
          </div>
        </div>
        <div style={{ textAlign: "justify", marginTop: 6 }}>
          In the Divine Name of ADONAI HA-ARETZ (אֲדוֹנָי הָאָרֶץ), I invoke the
          mighty and power angel URIEL (אוּרִיאֵל), come forth and invest this
          divination with Truth. I invoke thee, choir of Angels known as ASHIM
          (אֲשִׁים), thou Souls of Flame, I invoke thee{" "}
          <u>{archangel.name.roman.toUpperCase()}</u>, thou Archangel (of
          Malkuth?) who rules the day and hour of the Planet{" "}
          <u>{planet.name.en.en}</u>. Come forth{" "}
          <u>{planet.intelligenceId?.toLocaleUpperCase()}</u> to manifest the
          Spirit of this working -- the Spirit{" "}
          <u>{planet.spiritId?.toLocaleUpperCase()}</u>. Come forth I say and
          invest this working with the truth of what I perceive.
        </div>
        <div style={{ opacity: 0.5, fontSize: "70%", marginTop: 5 }}>
          Adapted from the Hensen&apos;s &quot;Geomancy in the Golden Dawn&quot;
          as published in{" "}
          <a
            target="_blank"
            href="https://www.amazon.co.uk/Golden-Dawn-Journal-Divination-Bk-1/dp/1567188508"
          >
            The Golden Dawn Journal, Book 1: Divination
          </a>
          .
        </div>
        <br />
        <Typography variant="h6">Mothers</Typography>
        <span style={{ fontSize: "80%", fontStyle: "italic" }}>
          Tap the rows to toggle between odd &amp; even (or click the dice)
        </span>
        <br />
        <Stack
          direction="row-reverse"
          spacing={2}
          justifyContent="space-around"
        >
          {mothers.map((tetragram, ti) => (
            <Box key={ti}>
              {ti + 1}
              <br />
              <Box sx={{ border: "1px solid black", width: 70 }}>
                {tetragram.map((row, i) => (
                  <div
                    key={i}
                    onClick={toggle(ti, i)}
                    style={{
                      border: "1px solid black",
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    {row === 2 ? "• •" : "•"}
                  </div>
                ))}
                <div
                  onClick={random(ti)}
                  style={{
                    border: "1px solid black",
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  🎲
                </div>
              </Box>
            </Box>
          ))}
        </Stack>
        <br />
        <hr />
        <br />
        <Stack direction="row-reverse" justifyContent="space-around">
          <TetragramStack
            title="Mothers"
            tetraRows={mothers}
            start={1}
            group={true}
          />
          <TetragramStack
            title="Daughters"
            tetraRows={daughters}
            start={5}
            group={true}
          />
        </Stack>
        <TetragramStack
          title="Nephews"
          tetraRows={nephews}
          start={9}
          group={false}
        />
        <br />
        <TetragramStack
          title="Witnesses"
          tetraRows={witnesses}
          start={13}
          group={false}
        />
        <br />
        <TetragramStack
          title="Judge"
          tetraRows={judges}
          start={15}
          group={false}
        />
        <br />
        <Typography variant="h6">Interpretation</Typography>
        <div style={{ color: "#aaa", fontSize: "80%", marginBottom: 10 }}>
          Select the most relevant house to which the question pertains.
        </div>
        <Select
          labelId="house-select-label"
          id="house-select"
          value={houseNoStr}
          onChange={(event: SelectChangeEvent) =>
            setHouseNoStr(event.target.value as string)
          }
        >
          {houses.slice(1).map((house) => (
            <MenuItem key={house.id} value={house.id}>
              <div
                style={{
                  textAlign: "center",
                  width: "100%",
                  whiteSpace: "normal",
                }}
              >
                <div>
                  <b>{ordinal(house.id)} House</b>
                </div>
                <div>{house.meaning.en}</div>
              </div>
            </MenuItem>
          ))}
        </Select>
        <br />
        <br />
        <div style={{ color: "#aaa", fontSize: "80%", marginBottom: 10 }}>
          Adjust the thumbs up/down if we did not guess correctly.
        </div>
        {interpretations.map((interpretation, i) => (
          <React.Fragment key={i}>
            <div>
              <b>
                {interpretation.title} ({interpretation.tetragram?.title.en}) in{" "}
                {ordinal(parseInt(houseNoStr))} House
              </b>
              <br />
              <div style={{ color: "#aaa", fontSize: "80%", marginBottom: 5 }}>
                {interpretation.hint}
              </div>
              {(() => {
                if (interpretation.title !== "Judge") return null;
                const tetragram = interpretation.tetragram;
                if (!tetragram) return null;
                return (
                  <div style={{ fontSize: "80%" }}>
                    {tetragram.zodiacId &&
                      (Array.isArray(tetragram.zodiacId)
                        ? tetragram.zodiacId
                            .map((z) => data.zodiac[z].symbol)
                            .join("/")
                        : data.zodiac[tetragram.zodiacId].symbol)}
                    {data.element[tetragram.elementId]?.symbol}
                    {/* tetragram.rulerId */}
                    {Array.isArray(tetragram.planetId)
                      ? tetragram.planetId
                          .map((p) => data.planet[p].symbol)
                          .join("/")
                      : data.planet[tetragram.planetId].symbol}
                  </div>
                );
              })()}
              {interpretation.tetragram?.meanings[parseInt(houseNoStr)].en}
            </div>
            <ToggleButtonGroup
              value={interpretation.goodState[0]}
              exclusive
              size="small"
              onChange={(_event, isGood: boolean | null) =>
                isGood !== null && interpretation.goodState[1](isGood)
              }
              aria-label={interpretation.title + " is good"}
            >
              <ToggleButton value={true} aria-label="left aligned">
                👍
              </ToggleButton>
              <ToggleButton value={false} aria-label="left aligned">
                👎
              </ToggleButton>
            </ToggleButtonGroup>
            <br />
            <br />
          </React.Fragment>
        ))}
        <div>
          <b>Interpretation</b>
          <br />
          {interpretationText(interpretationId)}
        </div>
        <br />
        <AstroGeomancyChart ref={ref} tetragrams={allFigures} width="80%" />
        <CopyPasteExport ref={ref} filename={`astroGeomancy`} />
        <ToastContainer
          position="bottom-center"
          autoClose={1500}
          hideProgressBar
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss={false}
          draggable={false}
          pauseOnHover
        />
      </Container>
    </>
  );
}

export default GeomancyReading;
