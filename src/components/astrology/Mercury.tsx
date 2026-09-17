"use client";

import retrogrades from "@magick-data/astrology/Retrograde";
import { DateTime } from "luxon";
import Image from "next/image";
import useHydrated from "@/useHydrated";

const NARROW_CHARACTER =
  /[\p{sc=Latin}\p{sc=Cyrillic}\p{sc=Greek}\p{sc=Hebrew}\p{sc=Arabic}\p{sc=Common}\p{sc=Inherited}]/u;

/**
 * How many em a date label needs: 0.5 per character in the scripts above
 * (digits and punctuation included) and 1 per other character. In Chromium
 * no retrograde label in 79 locales was wider, though CJK and Indic labels
 * come out smaller than they could be. Emoji or full-width characters would
 * be wider, but the labels have none.
 */
function emWidth(text: string) {
  let em = 0;
  for (const char of text) em += NARROW_CHARACTER.test(char) ? 0.5 : 1;
  return em;
}

/** The retrograde in progress at `now`, or else the next one. */
function nextRetrograde(now: Date) {
  for (const [[y1, m1, d1], [y2, m2, d2]] of retrogrades.mercury) {
    // Local midnights; the data's months count from 1.
    const start = new Date(y1, m1 - 1, d1);
    const end = new Date(y2, m2 - 1, d2);

    if (now < end) return { start, end };
  }
}

/*
function MercuryDrawing({ phase, width, height, }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      viewBox="0 0 170 162"
      width={width}
      height={height}
      transform={`rotate(${inclination})`}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        className="back"
        d="m85,5 a20,20 0 1,1 0,150 a20,20 0 1,1 0,-150"
        style={{ fill: "white", filter: "url(#glow)" }}
      />
      <path
        className="back"
        d="m85,5 a20,20 0 1,1 0,150 a20,20 0 1,1 0,-150"
        style={{ fill: "black" }}
      />
      <path
        className="moon"
        d={`m85,5 a${mag},20 0 1,${sweep[0]} 0,150 a20,20 0 1,${sweep[1]} 0,-150`}
        style={{ fill: "#ebc815" }}
      />
    </svg>
  );
}
*/

function MercuryWidget({ padding = "10px 0 2px 0" }) {
  // The page is prerendered at build time, so the server knows neither
  // today's date nor the viewer's date format. Hydrate with a blank label,
  // then fill in the dates.
  const hydrated = useHydrated();
  const retrograde = hydrated ? nextRetrograde(new Date()) : undefined;
  if (hydrated && !retrograde)
    return "Could not find next retrograde, sorry; please report.";

  const d = (d) =>
    DateTime.fromJSDate(d).toLocaleString({
      month: "short",
      day: "2-digit",
    });
  const label = retrograde
    ? `Retro ${d(retrograde.start)} – ${d(retrograde.end)}`
    : "\u00a0"; // keeps the label's line height
  const fitCqi = Math.floor(1000 / emWidth(label)) / 10;

  return (
    <div
      style={{
        textAlign: "center",
        background: "url(/night-sky.jpg)",
        backgroundSize: "cover",
        height: "100%",
        containerType: "inline-size",
      }}
    >
      <div style={{ padding }}>
        {/* Decorative: the tile's title already names the planet. */}
        <Image src="/pics/mercury.webp" height={85} width={85} alt="" />
      </div>
      {/* One line in any locale: 1rem, or smaller when the tile is narrow. */}
      <div
        style={{
          color: "#cc5",
          fontSize: `min(1rem, ${fitCqi}cqi)`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

export { nextRetrograde };
export default MercuryWidget;
