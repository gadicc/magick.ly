"use client";
import {
  Container,
  FormControlLabel,
  FormGroup,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import Typography from "@mui/material/Typography";
import React from "react";
import data, {
  tetragram as _tetragrams,
  geomanicHouse as houses,
} from "@/../data/data";
import PlanetarySpirit from "@/components/astrology/planetarySpirits";
import { capitalizeFirstLetter } from "@/lib/utils";
import { PlanetId } from "../../../../data/astrology/Planets";
import Tetragram from "../Tetragram";

/*
function id2title(str: string) {
  return (str[0].toUpperCase() + str.substring(1)).replace(
    /_(\w)/,
    (m, p1) => " " + p1.toUpperCase()
  );
}
*/

// https://stackoverflow.com/questions/13627308/add-st-nd-rd-and-th-ordinal-suffix-to-a-number
const nth = (n) =>
  ["st", "nd", "rd"][((((n + 90) % 100) - 10) % 10) - 1] || "th";

const rowsToBinary = (rows: (1 | 2)[]) =>
  parseInt(rows.map((r) => (r === 1 ? "0" : "1")).join(""), 2);
export default function Geomancy() {
  const [showAssoc, setShowAssoc] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<"alpha" | "pairs" | "binary">(
    "pairs",
  );

  const tetragrams = React.useMemo(() => {
    if (sortBy === "pairs") {
      const t = _tetragrams;
      // prettier-ignore
      return [
        t.acquisitio,
        t.amissio, // gain, loss
        t.albus,
        t.rubeus, // white, red
        t.puella,
        t.puer, // girl, boy
        t.laetitia,
        t.tristitia, // joy, sorrow
        t.caput_draconis,
        t.cauda_draconis, // dragon's head, tail
        t.populus,
        t.via, // people, way
        t.conjunctio,
        t.carcer, // conjunction, prison
        t.fortuna_major,
        t.fortuna_minor, // major, minor fortune
      ];
    }

    const tetragrams = Object.values(_tetragrams);
    if (sortBy === "alpha")
      tetragrams.sort((a, b) => a.title.en.localeCompare(b.title.en));
    else if (sortBy === "binary")
      tetragrams.sort((a, b) => rowsToBinary(a.rows) - rowsToBinary(b.rows));
    return tetragrams;
  }, [sortBy]);
  const byPairs = sortBy === "pairs" || sortBy === "binary";

  return (
    <>
      <Container sx={{ my: 1 }}>
        <p>
          In great appreciation of
          <i>The Golden Dawn Journal: Book 1: Divination</i> by Chic & Tabatha
          Cicero. Buy on{" "}
          <a href="https://www.amazon.com/Golden-Dawn-Journal-Divination-Llewellyns/dp/1567188508">
            Amazon
          </a>{" "}
          or{" "}
          <a href="https://www.goldendawnshop.com/product/basics-of-magic-the-best-of-the-golden-dawn-journal-book-1-divination/">
            GDShop
          </a>{" "}
          (summary).
        </p>

        <div style={{ textAlign: "center" }}>
          <Typography variant="h4" sx={{ my: 2 }}>
            16 Tetragrams
          </Typography>
          <Select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "alpha" | "pairs" | "binary")
            }
            size="small"
          >
            <MenuItem value="alpha">sort alphabetically</MenuItem>
            <MenuItem value="pairs">sort by meaning pairs</MenuItem>
            <MenuItem value="binary">sort by binary value</MenuItem>
          </Select>
          <br />
          <FormGroup sx={{ alignItems: "center" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={showAssoc}
                  onChange={() => setShowAssoc(!showAssoc)}
                />
              }
              label="show associations"
            />
          </FormGroup>
        </div>
        <br />

        <Grid container spacing={2} p={0}>
          {tetragrams.map((tetragram) => (
            <Grid
              key={tetragram.id}
              size={{
                xs: 6,
                sm: byPairs ? 6 : 4,
                md: byPairs ? 6 : 3,
                lg: byPairs ? 6 : 2,
                xl: byPairs ? 6 : 1,
              }}
            >
              <Grid container spacing={2}>
                <Grid size={8}>
                  <b>{tetragram.title.en}</b>
                  <br />({tetragram.translation.en})
                </Grid>
                <Grid size={4}>
                  <Stack direction="row" spacing={1}>
                    <Tetragram rows={tetragram.rows} />
                    {showAssoc && (
                      <div
                        style={{
                          paddingTop: 3,
                          fontSize: "90%",
                          textAlign: "center",
                          lineHeight: "1em",
                        }}
                      >
                        {tetragram.zodiacId &&
                          (Array.isArray(tetragram.zodiacId)
                            ? tetragram.zodiacId
                                .map((z) => data.zodiac[z].symbol)
                                .join("/")
                            : data.zodiac[tetragram.zodiacId].symbol)}
                        <br />
                        {data.element[tetragram.elementId]?.symbol}
                        <br />
                        {/* tetragram.rulerId */}
                        {Array.isArray(tetragram.planetId)
                          ? tetragram.planetId
                              .map((p) => data.planet[p].symbol)
                              .join("/")
                          : data.planet[tetragram.planetId].symbol}
                      </div>
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </Grid>
          ))}
        </Grid>
        <br />

        <Typography variant="h4" sx={{ my: 2 }} style={{ textAlign: "center" }}>
          Spirits and Rulers
        </Typography>

        <TableContainer component={Paper}>
          <Table aria-label="planets, spirits, rulers, sigils">
            <TableHead>
              <TableRow>
                <TableCell align="center">Planet</TableCell>
                <TableCell align="center">Intelligence</TableCell>
                <TableCell align="center">Spirit / Ruler</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {["sol", "mercury", "venus", "luna", "mars", "jupiter", "saturn"]
                .map((planetId: PlanetId) => data.planet[planetId])
                .map((planet) => (
                  <TableRow
                    key={planet.id}
                    sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
                  >
                    <TableCell align="center">
                      {planet.symbol} {planet.name.en.en}
                    </TableCell>
                    <TableCell align="center">
                      {capitalizeFirstLetter(planet.intelligenceId || "")}
                    </TableCell>
                    <TableCell align="center">
                      {capitalizeFirstLetter(planet.spiritId || "")} &nbsp;
                      <PlanetarySpirit
                        id={planet.spiritId}
                        height="1.1em"
                        display="inline-block"
                      />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>
        <br />

        <Typography variant="h4" sx={{ my: 2 }} style={{ textAlign: "center" }}>
          Geomanic Houses
        </Typography>

        <div style={{ textAlign: "justify" }}>
          {houses.slice(1).map((house, i) => (
            <p key={i}>
              <b>
                {i + 1}
                {nth(i + 1)} House:
              </b>{" "}
              {house.meaning.en}
            </p>
          ))}
        </div>

        <Typography variant="h4" sx={{ my: 2 }} style={{ textAlign: "center" }}>
          Meanings in the Houses
        </Typography>

        {Object.values(tetragrams).map((tetragram) => (
          <div key={tetragram.id}>
            <b>{tetragram.title.en}</b>
            <br />
            <i> {tetragram.meaning.en}</i>
            <br />
            <ol>
              {tetragram.meanings.slice(1).map((meaning, i) => (
                <li key={i}>{meaning.en}</li>
              ))}
            </ol>
          </div>
        ))}
      </Container>
    </>
  );
}
