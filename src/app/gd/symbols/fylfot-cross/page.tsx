"use client";

import {
  Button,
  Checkbox,
  Chip,
  Container,
  FormControlLabel,
  FormGroup,
  Grid,
} from "@mui/material";
import React from "react";

import data from "@/../data/data";
import FylfotCross, {
  fylfot,
  typeFromId,
} from "@/components/gd/symbols/fylfot-cross";
import OpenSource from "@/OpenSource";

function unflat(flat, split = 5) {
  const unflat: (string | null)[][] = [[], [], [], [], []];
  for (let i = 0, row = -1; i < flat.length; i++) {
    if (i % split === 0) row++;
    console.log(unflat);
    unflat[row].push(flat[i]);
  }
  return unflat;
}

const fylfotEmpty = [
  ["cursor", "", "", null, ""],
  [null, null, "", null, ""],
  ["", "", "", "", ""],
  ["", null, "", null, null],
  ["", null, "", "", ""],
];

const fylfotSymbols = fylfot.flat(2).filter(Boolean) as string[];
fylfotSymbols.sort();

export default function FylfotCrossPage() {
  const [showColors, setShowColors] = React.useState(true);
  const [cells, setCells] = React.useState<(string | null)[][]>(fylfotEmpty);
  const [used, setUsed] = React.useState<string[]>([]);
  const [testing, setTesting] = React.useState(false);

  function crossClick(id: string, rowIndex, colIndex, correctId) {
    console.log({ id, rowIndex, colIndex, correctId });
    setUsed(used.filter((item) => item !== id));
    const flat = cells.flat(2);
    if (used.length < fylfotSymbols.length) flat[flat.indexOf("cursor")] = "";
    if (id) flat[flat.indexOf(id)] = "cursor";
    const newCells = unflat(flat);
    if (!id) newCells[rowIndex][colIndex] = "cursor";
    setCells(newCells);
  }

  function optionsClick(id: string) {
    setUsed([...used, id]);

    const flat = cells.flat(2);
    flat[flat.indexOf("cursor")] = id;

    const indexes = flat
      .map((x, i) => (x === "" ? i : null))
      .filter(Boolean) as number[];
    flat[indexes[Math.floor(Math.random() * indexes.length)]] = "cursor";

    setCells(unflat(flat));
  }

  return (
    <Container sx={{ p: 2 }}>
      <FylfotCross
        cells={testing ? cells : fylfot}
        onClick={crossClick}
        showColors={showColors}
      />
      <div
        style={{
          textAlign: "center",
          fontSize: "50%",
          margin: "5px 0 8px 0",
        }}
      >
        NB: This is NOT the Nazi symbol, see <a href="#swastika">note below</a>.
      </div>
      {testing && (
        <div>
          {fylfotSymbols.map((id) => {
            const type = typeFromId(id);
            const item = data[type][id];
            const inUse = used.includes(id);
            // console.log(item);
            return (
              <Chip
                sx={{
                  m: 1,
                  p: 0.5,
                  userSelect: "none",
                  cursor: "pointer",
                  fontSize: "130%",
                }}
                key={id}
                label={item.symbol}
                onClick={() => optionsClick(id)}
                disabled={inUse}
              />
            );
          })}
        </div>
      )}
      <div>
        <Grid container>
          <Grid size={6}>
            <FormGroup>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={showColors}
                    onChange={() => setShowColors(!showColors)}
                  />
                }
                label="Show Colors"
              />
            </FormGroup>
          </Grid>
          {!testing && (
            <Grid sx={{ textAlign: "right" }} size={6}>
              <Button variant="outlined" onClick={() => setTesting(true)}>
                Test me!
              </Button>
            </Grid>
          )}
        </Grid>
      </div>
      <div style={{ fontSize: "80%", textAlign: "justify" }}>
        <p>
          <b>Construction:</b> The symbol of the Sun is at the center of the
          cross at the point of stillness, while the zodiacal signs divided into
          the four triplicities make up the arms of the cross. The cardinal
          signs all begin at the center of the cross next to the solar symbol,
          followed by the fixed and mutable signs. The arms terminate with the
          elemental symbols of each triplicity. The whole cross represents the
          center of the universe giving rise to the celestial signs, which then
          formulate the elements of the physical world (source:{" "}
          <a href="https://www.goldendawnshop.com/product/fylfot-cross/">
            Golden Dawn Shop
          </a>
          ).
        </p>
        <a id="swastika" />
        <p>
          <b>History:</b> The swastika (卐 or 卍) is a symbol of divinity and
          spirituality in Hinduism, Buddhism, and many other Asian, certain
          European and Native American cultures and religions. It&apos;s been
          around since at least 10,000 B.C.E. and is most commonly associated
          with good fortune and auspiciousness. The Nazis appropriated the
          right-facing variant and rotated it 45° (
          <span style={{ display: "inline-block", transform: "rotate(45deg)" }}>
            卐
          </span>
          ). You can read more on{" "}
          <a href="https://en.wikipedia.org/wiki/Swastika">Wikipedia</a>.
        </p>
        <p>
          <b>Symbol issues:</b> Chrome incorrectly shows Emoji for some symbols
          on certain platforms (e.g. Android), which breaks color and styling (
          <a
            title="Chrome often ignores emoji and text variation selectors U+FE0F and U+FE0E"
            href="https://bugs.chromium.org/p/chromium/issues/detail?id=964527"
          >
            issue #964527
          </a>
          )
        </p>
      </div>
      <OpenSource href="/pages/hogd/symbols/fylfot-cross.tsx" />
    </Container>
  );
}
