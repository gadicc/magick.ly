"use client";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
import React from "react";
import OpenSource from "@/OpenSource";
import useGeoIP from "@/useGeoIP";
import {
  calcPlanetaryHoursForDayAndLocation,
  DAY_IN_MS,
  upcomingHoursForPlanetAtLocation,
} from "./utils";

const sxNowRow = {
  "& .MuiTableCell-root": {
    fontWeight: "bold",
    borderTop: "1.5px solid red",
    borderBottom: "1.5px solid red",
    // borderCollapse: "separate",
  },
  "& .MuiTableCell-root:first-of-type": {
    borderLeft: "1.5px solid red",
  },
  "& .MuiTableCell-root:last-child": {
    borderRight: "1.5px solid red",
  },
};

function PlanetaryHoursForDayAndLocation({ date, geo, planet }) {
  const hours = calcPlanetaryHoursForDayAndLocation(date, geo);
  const now = new Date();
  function isNow(hour, i) {
    const hourInMinutes =
      hours.meta[i < 12 ? "dayHourInMinutes" : "nightHourInMinutes"];
    return (
      now > hour.date &&
      now.getTime() < hour.date.getTime() + hourInMinutes * 60_000
    );
  }

  return (
    <div>
      <TableContainer component={Paper} sx={{ mt: 1 }}>
        <Table size="small" aria-label="simple table">
          <TableBody>
            {hours.map((hour, i) => (
              <TableRow
                key={i}
                sx={[
                  {
                    background:
                      hour.planet === planet ? "#cc5" : i >= 12 ? "#ccc" : "",
                  },
                  isNow(hour, i) && sxNowRow,
                ]}
              >
                <TableCell>{(i % 12) + 1}</TableCell>
                <TableCell>{format(hour.date, "HH:mm")}</TableCell>
                <TableCell>
                  {hour.planet[0].toUpperCase() + hour.planet.substring(1)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <br />1 daytime hour = {hours.meta.dayHourInMinutes.toFixed(2)} minutes
      <br />1 nighttime hour = {hours.meta.nightHourInMinutes.toFixed(2)}{" "}
      minutes
      <br />
    </div>
  );
}
export default function PlanetaryHours() {
  const geo = useGeoIP();
  const [planet, setPlanet] = React.useState("");
  const [_upcomingHours, setUpcomingHours] = React.useState<
    { from: Date; to: Date }[]
  >([]);

  React.useEffect(() => {
    if (!geo) return;
    setUpcomingHours(upcomingHoursForPlanetAtLocation(planet, geo));
  }, [geo, planet]);

  if (!geo) return "Loading location...";

  const now = new Date();
  const week = [0, 1, 2, 3, 4, 5, 6].map(
    (d, i) => new Date(now.getTime() + d * DAY_IN_MS),
  );

  const planetSelect = [
    {
      value: "sol",
      label:
        "temporal wealth, hope, gain, fortune, divination, the favour of princes, to dissolve hostile feeling, to make friends",
    },
    {
      value: "venus",
      label:
        "forming friendships; for kindness and love; for joyous and pleasant undertakings, and for travelling.",
    },
    {
      value: "mercury",
      label:
        "eloquence and intelligence; promptitude in business; science and divination; wonders; apparitions; and answers regarding the future. Thou canst also operate under this Planet for thefts; writings; deceit; and merchandise.",
    },
    {
      value: "luna",
      label:
        "embassies; voyages envoys; messages; navigation; reconciliation; love; and the acquisition of merchandise by water.",
    },
    {
      value: "saturn",
      label:
        "summon the Souls from Hades, but only of those who have died a natural death. Similarly on these days and hours thou canst operate to bring either good or bad fortune to buildings; to have familiar Spirits attend thee in sleep; to cause good or ill success to business, possessions, goods, seeds, fruits, and similar things, in order to acquire learning; to bring destruction and to give death, and to sow hatred and discord.",
    },
    {
      value: "jupiter",
      label:
        "obtaining honours, acquiring riches; contracting friendships, preserving health; and arriving at all that thou canst desire.",
    },
    {
      value: "mars",
      label:
        "War; to arrive at military honour; to acquire courage; to overthrow enemies; and further to cause ruin, slaughter, cruelty, discord; to wound and to give death.",
    },
  ];

  return (
    <Container sx={{ my: 1 }}>
      <Box sx={{ my: 2 }}>
        {geo.city}, {geo.country}{" "}
        <span style={{ color: "#aaa" }}>
          ({geo.longitude}, {geo.latitude})
        </span>
      </Box>
      <FormControl fullWidth>
        <InputLabel id="select-planet-label">Planet</InputLabel>
        <Select
          label="Planet"
          id="select-planet"
          labelId="select-planet-label"
          value={planet}
          onChange={(event: SelectChangeEvent) => setPlanet(event.target.value)}
        >
          {planetSelect.map((ps) => (
            <MenuItem key={ps.value} value={ps.value}>
              <div
                style={{
                  textAlign: "center",
                  width: "100%",
                  whiteSpace: "normal",
                }}
              >
                <b>{ps.value[0].toUpperCase() + ps.value.substring(1)}</b>:{" "}
                {ps.label}
              </div>
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {/* planet && <UpcomingHours hours={upcomingHours} /> */}
      <Box sx={{ mt: 1 }}>
        {week.map((date, i) => (
          <Accordion key={i} defaultExpanded={i === 0}>
            <AccordionSummary
              expandIcon={<ExpandMore />}
              sx={
                {
                  // "& .MuiAccordionSummary-content": { margin: 0 },
                }
              }
            >
              <Typography>{format(date, "cccc (LLL d)")}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, m: 0 }}>
              <PlanetaryHoursForDayAndLocation
                date={date}
                geo={geo}
                planet={planet}
              />
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
      <br />
      <Box>
        Planetary influences sourced from The Key of Solomon,{" "}
        <a href="https://sacred-texts.com/grim/kos/kos07.htm">chapter 2</a>{" "}
        (MacGregor Mathers, 1888).
      </Box>
      <OpenSource
        files={[
          "/src/app/astrology/planetary-hours/page.tsx",
          "/src/app/astrology/planetary-hours/utils.tsx",
        ]}
      />
    </Container>
  );
}
