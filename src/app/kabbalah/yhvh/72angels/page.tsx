"use client";
import React from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Container,
  FormControl,
  FormControlLabel,
  FormLabel,
  Paper,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { ExpandMore } from "@mui/icons-material";

import angels, { type Angel } from "@/../data/kabbalah/SeventyTwoAngels";
import angelicOrders from "@/../data/kabbalah/AngelicOrders";
import zodiacs from "@/../data/astrology/Zodiac";

const formatter = new Intl.DateTimeFormat("default", {
  month: "short",
  day: "numeric",
});
function dateToMonthAndDay(date) {
  return formatter.format(date);
}
function formatMonthDayArray(monthDayArray) {
  return dateToMonthAndDay(new Date(0, monthDayArray[0] - 1, monthDayArray[1]));
}

// start of Aries from https://masteringthezodiac.com/sidereal-astrology
const startDayBySystem = {
  tropical: 80, // 21 March
  sidereal: 105, // 15 April (Fagan-Bradley)
};

function dateFromAngelIndex(index: number, startDay = 79) {
  const degrees = index * 5;
  const dayOfYear = (365 / 360) * degrees;
  const date = new Date(0, 0, startDay + dayOfYear); // avoid leap years
  return date;
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules
const enOrdinalRules = new Intl.PluralRules("en-US", { type: "ordinal" });
const suffixes = new Map([
  ["one", "st"],
  ["two", "nd"],
  ["few", "rd"],
  ["other", "th"],
]);
const formatOrdinals = (n) => {
  const rule = enOrdinalRules.select(n);
  const suffix = suffixes.get(rule);
  return `${n}${suffix}`;
};

function Governs({ index, astrologySystem }) {
  const degrees = index * 5;
  const signIndex = degrees % 12;
  const sign = Object.values(zodiacs)[signIndex];
  const signDegrees = degrees % 30;
  const quinant = Math.floor(signDegrees / 5);

  const startDay = dateFromAngelIndex(index, startDayBySystem[astrologySystem]);
  const endDay = new Date(startDay).setDate(startDay.getDate() + 4);

  return (
    <>
      {signDegrees}-{signDegrees + 5}° of {sign.name.en} (
      {formatOrdinals(quinant + 1)} quinant)
      <br />
      {dateToMonthAndDay(startDay)} - {dateToMonthAndDay(endDay)}
    </>
  );
}

function Angel({
  angel,
  i,
  astrologySystem,
}: {
  angel: Angel;
  i: number;
  astrologySystem: string;
}) {
  const angelicOrder =
    angel.angelicOrderId && angelicOrders[angel.angelicOrderId];
  const startDay = dateFromAngelIndex(i, startDayBySystem[astrologySystem]);
  const endDay = new Date(startDay).setDate(startDay.getDate() + 4);

  return (
    <Accordion key={i}>
      <AccordionSummary
        expandIcon={<ExpandMore />}
        aria-controls="panel1a-content"
        id="panel1a-header"
      >
        <Typography>
          {i + 1}. {angel.name.en} ({dateToMonthAndDay(startDay)} -{" "}
          {dateToMonthAndDay(endDay)})
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <TableContainer component={Paper}>
          <Table aria-label="simple table" size="small">
            <TableBody>
              <TableRow>
                <TableCell component="th" scope="row" sx={{ width: 150 }}>
                  Angel (genius):
                </TableCell>
                <TableCell>
                  {angel.name.en} | {angel.name.he}
                </TableCell>
              </TableRow>
              {angel.godName && (
                <TableRow>
                  <TableCell component="th" scope="row" sx={{ width: 150 }}>
                    God Name:
                  </TableCell>
                  <TableCell>{angel.godName}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell component="th" scope="row" sx={{ width: 150 }}>
                  Attribute:
                </TableCell>
                <TableCell>{angel.attribute.en}</TableCell>
              </TableRow>
              {angelicOrder && (
                <TableRow>
                  <TableCell component="th" scope="row">
                    Angelic order:
                  </TableCell>
                  <TableCell>
                    {angelicOrder.name.roman} | {angelicOrder.name.he}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell>Governs:</TableCell>
                <TableCell>
                  <Governs index={i} astrologySystem={astrologySystem} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Presiding Days:</TableCell>
                <TableCell>
                  {angel.presidesOver
                    .map((monthDay) => formatMonthDayArray(monthDay))
                    .join(", ")}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        <br />
        <details style={{ fontSize: "80%" }}>
          <summary>Original text</summary>

          <div
            style={{
              marginTop: ".8em",
              whiteSpace: "pre-wrap",
              textAlign: "justify",
            }}
          >
            {angel.text.en}
          </div>
        </details>
      </AccordionDetails>
    </Accordion>
  );
}

function SevenyTwo() {
  const [astrologySystem, setAstrologySystem] = React.useState("tropical");

  return (
    <>
      <Container style={{ textAlign: "justify" }}>
        <details style={{ fontSize: "80%", marginTop: "1em" }}>
          <summary>What is this?</summary>
          <p style={{ fontSize: "80%" }}>
            In Christian Kabbalah, Johann Reuchlin (1455–1522) considered the 72
            names - made pronounceable by adding the suffixes &quot;El&quot; or
            &quot;Yah&quot; - to be the names of angels: individuated products
            of God&apos;s will. He lists these &quot;72 Angels of the Shem
            HaMephorash&quot; in his <i>De Arte Cabbalistica</i> (1517), which
            greatly influenced later Hermetic works including those of the
            Golden Dawn. More info on the{" "}
            <a
              target="_blank"
              href="https://en.wikipedia.org/wiki/Shem_HaMephorash"
            >
              Shem HaMephorash
            </a>{" "}
            wikipedia page.
          </p>
        </details>
        <details style={{ fontSize: "80%", marginTop: "1em" }}>
          <summary>Important note on sources used.</summary>
          <p>
            The material here is taken from{" "}
            <a href="https://www.google.co.uk/books/edition/La_science_cabalistique/ZqgpxTZ43HkC?hl=en&gbpv=0">
              The Science of the Kabbalah
            </a>{" "}
            (English title) by Lazare Lenain (1823; digitized by Google Books),
            passed through OCRmyPDF (
            <a href="/docs/Lenain%20-%20La%20Science%20Cabalistique%20(1823)%20-%20Google.txt">
              output.txt
            </a>
            ), and translated with Google Translate. This was done in an effort
            to provide a Copyright-free version of this material, however, a
            much better translation exists:
          </p>
          <p>
            We highly recommend the{" "}
            <a href="https://www.amazon.co.uk/Science-Kabbalah-Lazare-Lenain/dp/1947907093/ref=sr_1_1?crid=L3H786IAH9D0&keywords=the+science+of+the+kabbalah&qid=1695585748&sprefix=the+science+of+the+kabbalah%2Caps%2C121&sr=8-1">
              translation by Piers A. Vaughan
            </a>{" "}
            (Amazon link), who has not only provided an outstanding work, but
            also provided free, high quality images of the sigils on his blog,
            in{" "}
            <a href="https://rosecirclebooks.com/the-science-of-the-kabbalah-lenain/">
              this post
            </a>{" "}
            and{" "}
            <a href="https://rosecirclebooks.com/levi-seals-for-shemhamephorash/">
              this post
            </a>
            .
          </p>
        </details>
        <p>The sigils will be added at a later time.</p>
      </Container>
      <Container>
        <FormControl>
          <FormLabel id="astrology-radio-buttons-group">Astrology</FormLabel>
          <RadioGroup
            row
            aria-labelledby="astrology-radio-buttons-group"
            value={astrologySystem}
            onChange={(e) => setAstrologySystem(e.target.value)}
          >
            <FormControlLabel
              value="tropical"
              control={<Radio />}
              label="Tropical"
            />
            <FormControlLabel
              value="sidereal"
              control={<Radio />}
              label="Sidereal (Fagan-Bradley)"
            />
          </RadioGroup>
        </FormControl>
      </Container>
      <div style={{ marginTop: "1em" }}>
        {angels.map((angel, i) => (
          <Angel
            key={i}
            angel={angel}
            i={i}
            astrologySystem={astrologySystem}
          />
        ))}
      </div>
      <br />
      <Container sx={{ fontSize: "80%", textAlign: "justify" }}>
        Magick.ly is open-source. You can see the code used to generate this
        page{" "}
        <a href="https://github.com/gadicc/magick.ly/blob/master/pages/kabbalah/yhvh/72angels.tsx">
          here
        </a>
        . Additionally, see the{" "}
        <a href="https://github.com/gadicc/magick.ly/blob/master/data/kabbalah/seventyTwoAngels.json5">
          data file
        </a>{" "}
        and{" "}
        <a href="/docs/Lenain - La Science Cabalistique (1823) - Google.txt">
          text extraction
        </a>{" "}
        from the original book (with OCRmyPDF).
      </Container>
    </>
  );
}

export default SevenyTwo;
