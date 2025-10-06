"use client";

import { TextField } from "@mui/material";
import React from "react";
import dictionary from "@/../data/enochian/Dictionary";
import EnochianFont from "../../../components/enochian/enochianFont";

const enochianWords = Object.keys(dictionary);

const s = {
  searchDiv: {
    background: "white",
    padding: "10px 20px",
    position: "sticky" as const,
    top: 0,
    width: "100%",
    boxShadow: "0px 0px 10px rgba(0,0,0,0.5)",
  },
  searchTextField: {
    width: "45%",
  },
  searchTextFieldRight: {
    width: "45%",
    float: "right" as const,
  },
  resultsDiv: {
    padding: "10px 0 10px 0",
    background: "#aaa",
    minHeight: "500px",
  },
  resultsRow: {
    padding: "0px 20px",
  },
  resultsRowSelected: {
    padding: "0px 20px",
    background: "#ccc",
  },
  dictionary: {
    padding: 22,
    background: "#111", //'rgba(0,0,0,0.9)',
    color: "white",
    position: "fixed" as const,
    bottom: 0,
    width: "100%",
  },
  floatRight: {
    float: "right" as const,
  },
};

function WordBar({ word }) {
  const dict = dictionary[word];
  return (
    <table width="100%">
      <tbody>
        <tr>
          <td style={{ width: "33%", textAlign: "left" }}>{word}</td>
          <td style={{ width: "33%", textAlign: "center" }}>
            {dict.pronounciations.length
              ? dict.pronounciations[0].pronounciation
              : null}
          </td>
          <td
            style={{ width: "33%", textAlign: "right", ...EnochianFont.style }}
          >
            {word}
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
          <td></td>
          <td></td>
          <td style={{ textAlign: "right" }}>
            {dict.gematria?.length
              ? "Gematria " + dict.gematria.join(", ")
              : ""}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const resultRowRightStyle = { ...s.floatRight, ...EnochianFont.style };
const ResultRow = React.memo(function ResultRow({
  word,
  onClick,
  selected,
}: {
  word: string;
  onClick: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
  selected: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={selected ? s.resultsRowSelected : s.resultsRow}
    >
      <span>{word}</span>
      <span style={resultRowRightStyle}>{word}</span>
    </div>
  );
});

export default function Dictionary() {
  const [text, setText] = React.useState("");
  const [selected, setSelected] = React.useState("");
  const matches = text
    ? enochianWords.filter((x) => x.match(text))
    : enochianWords;

  const onClick = React.useCallback((event) => {
    setSelected(event.target.innerText);
  }, []);

  return (
    <>
      <div style={s.searchDiv}>
        <TextField
          placeholder="ABC"
          margin="normal"
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          type="search"
          style={s.searchTextField}
          size="small"
          variant="standard"
        />
        <TextField
          // since no way to apply placeholder pseudo-selector CSS currently.
          // placeholder="ABC"
          placeholder="CBA"
          margin="normal"
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          style={s.searchTextFieldRight}
          /*
          InputProps={{
            sx: {
              "&::-moz-placeholder": { unicodeBidi: "bidi-override" },
              "&::-ms-input-placeholder": { unicodeBidi: "bidi-override" },
              "&::-webkit-input-placeholder": { unicodeBidi: "bidi-override" },
            },
          }}
          */
          inputProps={{
            // unicode-bidi prop MUST be in style, can't be via CSS class.
            style: EnochianFont.style,
          }}
          type="search"
          size="small"
          variant="standard"
        />
      </div>
      <div style={s.resultsDiv}>
        {matches &&
          matches.map((word) => (
            <ResultRow
              key={word}
              word={word}
              selected={word === selected}
              onClick={onClick}
            />
          ))}
      </div>
      {dictionary[selected || text] ? (
        <div style={s.dictionary}>
          <WordBar word={selected || text} />
        </div>
      ) : null}
    </>
  );
}
