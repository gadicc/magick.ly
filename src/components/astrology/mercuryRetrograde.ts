import {
  type AstroTime,
  Body,
  Ecliptic,
  GeoVector,
  MakeTime,
  Search,
} from "astronomy-engine";
import { DateTime } from "luxon";

/** Half the interval the longitude's speed is measured over, in days. */
const HALF_STEP = 1 / 1440; // one minute

/**
 * Mercury turns retrograde and direct at a station, where its apparent
 * longitude stops and turns back. The dates come out within ten minutes of
 * JPL Horizons over 2020-2035, so a station this close to local midnight
 * could belong to either date; the wider date is used.
 */
const MARGIN_MINUTES = 15;

/** Apparent geocentric ecliptic longitude of Mercury, in degrees. */
function longitude(time: AstroTime) {
  // GeoVector corrects for light travel time and aberration, and Ecliptic
  // rotates to the true equinox and ecliptic of date.
  return Ecliptic(GeoVector(Body.Mercury, time, true)).elon;
}

/** How fast that longitude changes, in degrees a day. */
function speed(time: AstroTime) {
  let change =
    longitude(time.AddDays(HALF_STEP)) - longitude(time.AddDays(-HALF_STEP));
  if (change > 180) change -= 360;
  else if (change < -180) change += 360;
  return change / (2 * HALF_STEP);
}

export type Station = {
  /** "retrograde" where Mercury starts moving backwards, "direct" where it stops. */
  type: "retrograde" | "direct";
  time: Date;
};

/** Mercury's stations between `from` and `to`, in time order. */
export function mercuryStations(from: Date, to: Date, stepDays = 2): Station[] {
  const stations: Station[] = [];
  const end = MakeTime(to);
  let time = MakeTime(from);
  let value = speed(time);

  while (time.ut < end.ut) {
    const next = time.AddDays(stepDays);
    const nextValue = speed(next);
    // A station is where the speed crosses zero, so search for that root.
    const options = { dt_tolerance_seconds: 1 };
    if (value >= 0 && nextValue < 0) {
      // Search answers null where it cannot bracket the root. Dropping a
      // station would pair the wrong ones, so fail instead of misdating.
      const found = Search((t) => -speed(t), time, next, options);
      if (!found) throw new Error(`No station by ${next.date.toISOString()}`);
      stations.push({ type: "retrograde", time: found.date });
    } else if (value < 0 && nextValue >= 0) {
      const found = Search(speed, time, next, options);
      if (!found) throw new Error(`No station by ${next.date.toISOString()}`);
      stations.push({ type: "direct", time: found.date });
    }
    time = next;
    value = nextValue;
  }

  return stations;
}

/** A retrograde as the dates the viewer's own zone puts its stations on. */
export type Retrograde = { start: DateTime; end: DateTime };

/** The start of the local date `minutes` after `time`. */
function localDate(time: Date, minutes: number) {
  return DateTime.fromJSDate(time).plus({ minutes }).startOf("day");
}

/**
 * The retrograde Mercury is in, or else its next one. A retrograde counts as
 * running until the end of its end date, so a viewer sees it all of that day.
 */
export function currentOrNextRetrograde(now: Date): Retrograde | undefined {
  const day = 86400_000;
  // Retrogrades last under 25 days and start about every 116 days.
  const stations = mercuryStations(
    new Date(now.getTime() - 40 * day),
    new Date(now.getTime() + 200 * day),
  );

  for (const [index, station] of stations.entries()) {
    const next = stations[index + 1];
    if (station.type !== "retrograde" || next?.type !== "direct") continue;

    const end = localDate(next.time, MARGIN_MINUTES);
    if (now.getTime() <= end.endOf("day").toMillis())
      return { start: localDate(station.time, -MARGIN_MINUTES), end };
  }
}
