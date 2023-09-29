import React from "react";
import {
  Checkbox,
  Container,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
} from "@mui/material";
import CopyPasteExport, { ToastContainer } from "../../src/copyPasteExport";
import AppBar from "../../components/AppBar";
import RoseSigil, { letterIJ } from "../../components/hogd/RoseSigil";

const navParts = [
  {
    title: "HOGD",
    url: "/hogd",
  },
];

export default function Sigils() {
  const ref = React.useRef(null);
  const [sigilText, setSigilText] = React.useState("גדי");
  const [showRose, setShowRose] = React.useState(true);
  const [animate, setAnimate] = React.useState(true);

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
      <AppBar title="Sigils" navParts={navParts} />
      <Container sx={{ py: 2 }}>
        <TextField
          placeholder="Sigil text"
          size="small"
          value={sigilText}
          onChange={(e) => setSigilText(e.target.value)}
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
          </Stack>
        </FormGroup>

        {rectified != sigilText && <div>Rectified text: {rectified}</div>}
        <RoseSigil
          ref={ref}
          sigilText={isValid ? rectified : ""}
          showRose={showRose}
          animate={animate}
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
