"use client";
import React from "react";
import { DateTime } from "luxon";
import Image from "next/legacy/image";

import retrogrades from "@magick-data/astrology/Retrograde";

function find() {
  const now = new Date();

  for (const row of retrogrades.mercury) {
    const start = new Date(row[0]);
    const end = new Date(row[1]);

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
  const retrograde = find();
  if (!retrograde)
    return "Could not find next retrograde, sorry; please report.";

  const d = (d) =>
    DateTime.fromJSDate(d).toLocaleString({
      month: "short",
      day: "2-digit",
    });

  return (
    <div
      style={{
        textAlign: "center",
        background: "url(/night-sky.jpg)",
        backgroundSize: "cover",
        height: "100%",
      }}
    >
      <style jsx>{``}</style>
      <div style={{ padding }}>
        <Image src="/pics/mercury.webp" height="85" width="85" alt="Mercury" />
      </div>
      <div style={{ color: "#cc5" }}>
        Retro {d(retrograde.start)} - {d(retrograde.end)}
      </div>
    </div>
  );
}

export default MercuryWidget;
