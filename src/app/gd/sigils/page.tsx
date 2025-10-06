"use client";
import { Clear } from "@mui/icons-material";

import {
  Checkbox,
  Container,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
} from "@mui/material";
import React from "react";
import RoseSigil, { letterIJ } from "@/components/gd/RoseSigil";
import CopyPasteExport, { ToastContainer } from "@/copyPasteExport";

export default function Sigils() {
  const ref = React.useRef(null);
  const [sigilText, setSigilText] = React.useState("גדי");
  const [showRose, setShowRose] = React.useState(true);
  const [animate, setAnimate] = React.useState(true);
  const [showKeys, setShowKeys] = React.useState(false);
  const [debug, setDebug] = React.useState(false);

  const rectified = (function () {
    const text = sigilText;
    return text
      .replaceAll("ך", "כ")
      .replaceAll("ם", "מ")
      .replaceAll("ן", "נ")
      .replaceAll("ף", "פ")
      .replaceAll("ץ", "צ");
  })();

  const charsValid = rectified
    .split("")
    .map((letter) => letterIJ(letter)[0] >= 0);
  const isValid = charsValid.indexOf(false) === -1;

  /*
  const isValid = (function () {
    for (const letter of rectified) {
      if (letterIJ(letter)[0] < 0) return false;
    }
    return true;
  })();
  */

  return (
    <div>
      <Container sx={{ py: 2 }}>
        <TextField
          placeholder="Sigil text"
          size="small"
          value={sigilText}
          dir="rtl"
          lang="he"
          onChange={(e) => setSigilText(e.target.value)}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => {
                    setSigilText("");
                  }}
                >
                  <Clear />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        {!isValid && (
          <div>
            Invalid characters:{" "}
            {charsValid.map((valid, i) => (
              <span key={i} style={{ color: valid ? "" : "red" }}>
                {sigilText[i]}
              </span>
            ))}
          </div>
        )}
        <FormGroup>
          <Stack direction="row">
            <FormControlLabel
              control={
                <Checkbox
                  checked={showRose}
                  onChange={() => setShowRose(!showRose)}
                />
              }
              label="Show Rose"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={animate}
                  onChange={() => setAnimate(!animate)}
                />
              }
              label="Animate"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={showKeys}
                  onChange={() => setShowKeys(!showKeys)}
                />
              }
              label="Show Keys"
            />
            <FormControlLabel
              control={
                <Checkbox checked={debug} onChange={() => setDebug(!debug)} />
              }
              label="Debug"
            />
          </Stack>
        </FormGroup>

        {rectified != sigilText && <div>Rectified text: {rectified}</div>}

        {showKeys && (
          <div style={{ direction: "rtl" }}>
            {"אבגדהוזחטיכךלמםנןסעפףצץקרשת←".split("").map((letter, i) => (
              <button
                key={i}
                style={{ margin: "1px" }}
                onClick={() => {
                  if (letter === "←") setSigilText(sigilText.slice(0, -1));
                  else setSigilText(sigilText + letter);
                }}
              >
                {letter}
              </button>
            ))}
          </div>
        )}

        <RoseSigil
          ref={ref}
          sigilText={isValid ? rectified : ""}
          showRose={showRose}
          animate={animate}
          debug={debug}
        />
        <CopyPasteExport ref={ref} filename={`RoseSigil-${rectified}`} />
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
    </div>
  );
}
