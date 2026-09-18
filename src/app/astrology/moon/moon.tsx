"use client";
import useHydrated from "@magick-components/hooks/useHydrated";
import lune from "lune";
import { DateTime } from "luxon";
import MoonDrawing from "@/components/astrology/Moon";

/*
// https://www.unicode.org/L2/L2017/17304-moon-var.pdf
function uniMoon(moon, north = true, invert = true) {
  switch (moon) {
    case "full-moon":
      return invert ? "🌑" : "🌕";
    default:
  }
}
*/

export default function Moon() {
  // The page is prerendered at build time and the dates are shown in the
  // viewer's time zone, so hydrate without them.
  const hydrated = useHydrated();
  const now = new Date();
  const hunt = lune.phase_hunt(now);
  const huntNext = lune.phase_hunt(
    new Date(hunt.nextnew_date.getTime() + 24 * 3600000),
  );
  const dateFmt = (d) =>
    DateTime.fromJSDate(d).toLocaleString(DateTime.DATETIME_FULL);

  const data = [
    { title: "🌑 Last New Moon 🌑", date: hunt.new_date },
    { title: "🌓 First Quarter 🌓", date: hunt.q1_date },
    { title: "🌕 Full Moon 🌕", date: hunt.full_date },
    { title: "🌗 Third Quarter 🌗", date: hunt.q3_date },
    { title: "🌑 Next New Moon 🌑", date: hunt.nextnew_date },
    { title: "🌕 Next Full Moon 🌕", date: huntNext.full_date },
  ].map((row) => ({ ...row, inPast: row.date < now }));

  return (
    <>
      <style jsx>{`
        #page {
          background: url(/night-sky.jpg);
          background-size: cover;
          height: 100%;
        }
        .group {
          margin-bottom: 1em;
          padding: 5px;
          background: rgba(0, 0, 0, 0.7);
        }
        .past {
          opacity: 0.5;
        }
        .group > .title {
          color: #cc5;
        }
        .group > .date {
          color: white;
        }
      `}</style>

      <div id="page">
        <div style={{ height: "155px" }}>
          <MoonDrawing moonPadding="20px 0 10px 0" />
        </div>

        <br />

        <div id="dates" style={{ textAlign: "center" }}>
          {data.map((row) => (
            <div
              key={row.title}
              className={"group" + (hydrated && row.inPast ? " past" : "")}
            >
              <div className="title">{row.title}</div>
              <div className="date">
                {hydrated ? dateFmt(row.date) : "\u00a0"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
