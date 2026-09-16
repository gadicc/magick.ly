"use client";
import { ExpandMore } from "@mui/icons-material";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Container,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";
import React from "react";
import dictionary from "@/../data/enochian/Dictionary";
import keys, { EnochianKey } from "@/../data/enochian/Keys";
import useEnochianFont, { EnochianFont } from "../useEnochianFont";

const s = {
  keyParagraph: {
    textAlign: "justify" as const,
  },
  selectedKey: {
    background: "yellow",
  },
};

function Dictionary({
  selectedKey,
}: {
  selectedKey: { key: number; subkey: number };
}) {
  const key = keys[selectedKey.key];
  const sub = key.subkeys[selectedKey.subkey];
  const dict = dictionary[sub.enochianLatin] || {
    meanings: [],
    pronounciations: [],
  };
  return (
    <table width="100%">
      <tbody>
        <tr>
          <td style={{ width: "33%", textAlign: "left" }}>
            {sub.enochianLatin}
          </td>
          <td style={{ width: "33%", textAlign: "center" }}>
            {dict.pronounciations.length &&
              dict.pronounciations[0].pronounciation}
          </td>
          <td
            style={{ width: "33%", textAlign: "right", ...EnochianFont.style }}
          >
            {sub.enochianLatin}
          </td>
        </tr>
        {dict.meanings.map((meaning, i) => (
          <tr key={i}>
            <td colSpan={3} style={{ textAlign: "center" }}>
              {meaning.meaning} ({meaning.source}) {meaning.source2}{" "}
              {meaning.note}
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={3} style={{ textAlign: "center" }}>
            {sub.english} (Dee book)
          </td>
        </tr>
        <tr>
          <td>
            Key {key.key}.{sub.subkey}
          </td>
          <td></td>
          <td style={{ textAlign: "right" }}>
            {dict.gematria ? "Gematria " + dict.gematria.join(", ") : ""}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function KeyText({
  enochianKey,
  lang,
  enochianFont,
  selectedKey,
  setSelectedKey,
}: {
  enochianKey: EnochianKey;
  lang: "enochian" | "english" | "both";
  enochianFont: boolean;
  selectedKey: { key: number; subkey: number } | null;
  setSelectedKey: ({ key, subkey }: { key: number; subkey: number }) => void;
}) {
  if (lang === "english")
    return (
      <div style={s.keyParagraph}>
        {enochianKey.subkeys.map((subkey) => (
          <React.Fragment key={subkey.subkey}>
            <span
              style={
                selectedKey &&
                selectedKey.key === enochianKey.key &&
                selectedKey.subkey === subkey.subkey
                  ? s.selectedKey
                  : undefined
              }
              onClick={() =>
                setSelectedKey({ key: enochianKey.key, subkey: subkey.subkey })
              }
            >
              {subkey.english}
            </span>{" "}
          </React.Fragment>
        ))}
      </div>
    );

  if (lang === "enochian")
    return (
      <div
        style={{ ...s.keyParagraph, ...(enochianFont && EnochianFont.style) }}
      >
        {enochianKey.subkeys.map((subkey) => (
          <React.Fragment key={subkey.subkey}>
            <span
              style={
                selectedKey &&
                selectedKey.key === enochianKey.key &&
                selectedKey.subkey === subkey.subkey
                  ? s.selectedKey
                  : undefined
              }
              onClick={() =>
                setSelectedKey({ key: enochianKey.key, subkey: subkey.subkey })
              }
            >
              {subkey.enochianLatin}
            </span>{" "}
          </React.Fragment>
        ))}
      </div>
    );

  if (lang === "both")
    return (
      <table>
        <tbody>
          {enochianKey.subkeys.map(
            (subkey) =>
              subkey.subkey > 0 && (
                <tr
                  key={subkey.subkey}
                  style={
                    selectedKey &&
                    selectedKey.key === enochianKey.key &&
                    selectedKey.subkey === subkey.subkey
                      ? s.selectedKey
                      : undefined
                  }
                  onClick={() =>
                    setSelectedKey({
                      key: enochianKey.key,
                      subkey: subkey.subkey,
                    })
                  }
                >
                  <td>
                    {enochianKey.key}.{subkey.subkey}
                  </td>
                  <td style={enochianFont ? EnochianFont.style : {}}>
                    {subkey.enochianLatin}
                  </td>
                  <td>{subkey.english}</td>
                </tr>
              ),
          )}
        </tbody>
      </table>
    );

  return <div></div>;
}

type EnochianLang = "enochian" | "english" | "both";

export default function Keys() {
  const [lang, setLang] = React.useState<EnochianLang>("english");
  const { enochianFont, EnochianFontToggle } = useEnochianFont();
  const [selectedKey, setSelectedKey] = React.useState<{
    key: number;
    subkey: number;
  } | null>(null);

  return (
    <>
      <Container sx={{ background: "#fafafa" }}>
        <FormControl>
          {/*
          <FormLabel id="demo-radio-buttons-group-label">Gender</FormLabel>
          */}
          <RadioGroup
            aria-labelledby="demo-radio-buttons-group-label"
            defaultValue="female"
            name="radio-buttons-group"
            value={lang}
            onChange={(e) => setLang(e.target.value as EnochianLang)}
            row
          >
            <FormControlLabel
              value="english"
              control={<Radio />}
              label="English"
            />
            <FormControlLabel
              value="enochian"
              control={<Radio />}
              label="Enochian"
            />
            <FormControlLabel value="both" control={<Radio />} label="Both" />
            {["enochian", "both"].includes(lang) && <EnochianFontToggle />}
          </RadioGroup>
        </FormControl>
      </Container>

      <Container sx={{ background: "#fafafa" }}>
        {keys.map(
          (key) =>
            key.key > 0 && (
              <Accordion key={key.key}>
                <AccordionSummary
                  expandIcon={<ExpandMore />}
                  aria-controls="panel1a-content"
                  id="panel1a-header"
                >
                  <Typography>Key {key.key}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <KeyText
                    enochianKey={key}
                    lang={lang}
                    enochianFont={enochianFont}
                    selectedKey={selectedKey}
                    setSelectedKey={setSelectedKey}
                  />
                </AccordionDetails>
              </Accordion>
            ),
        )}
      </Container>
      {selectedKey && (
        <Box
          sx={{
            p: 1,
            position: "sticky",
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            color: "#fafafa",
          }}
          onClick={() => setSelectedKey(null)}
        >
          <Dictionary selectedKey={selectedKey} />
        </Box>
      )}
    </>
  );
}
