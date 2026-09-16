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
import ExportControls from "@/components/export/ExportControls";
import RoseSigil, { letterIJ } from "@/components/gd/RoseSigil";
import { parseComponentImageRequest } from "@/render/componentImageRequest";
import { rectifySigilText } from "@/render/contracts/roseSigil";

export default function Sigils({
  initial,
}: {
  initial: { text: string; rose: boolean };
}) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [sigilText, setSigilText] = React.useState(initial.text);
  const [showRose, setShowRose] = React.useState(initial.rose);
  const [animate, setAnimate] = React.useState(true);
  const [showKeys, setShowKeys] = React.useState(false);
  const [debug, setDebug] = React.useState(false);

  const rectified = rectifySigilText(sigilText);

  const charsValid = rectified
    .split("")
    .map((letter) => letterIJ(letter)[0] >= 0);
  const isValid = charsValid.indexOf(false) === -1;

  // Links only exist for text the server contract accepts; the text is the
  // user's own, so the controls say so and nothing is written to the URL.
  const link = (() => {
    if (!isValid || !rectified) return undefined;
    try {
      const params = new URLSearchParams({ text: rectified });
      if (!showRose) params.set("rose", "false");
      return {
        slug: "rose-sigil" as const,
        props: parseComponentImageRequest("rose-sigil", params).props,
      };
    } catch {
      return undefined;
    }
  })();
  const share = link
    ? () => {
        const params = new URLSearchParams({ text: link.props.text });
        if (!link.props.rose) params.set("rose", "false");
        return `/gd/sigils?${params}`;
      }
    : undefined;

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
          slotProps={{
            input: {
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
            },
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
        <ExportControls
          target={ref}
          filename={`RoseSigil-${rectified}`}
          link={link}
          share={share}
        />
      </Container>
    </div>
  );
}
