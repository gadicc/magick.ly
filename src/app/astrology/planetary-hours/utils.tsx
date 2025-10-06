import { differenceInMinutes, format, getDay } from "date-fns";
import SunCalc from "suncalc";

// Useful Resources:
// https://plentifulearth.com/calculate-planetary-hours/
// https://www.lunarium.co.uk/planets/hours.jsp
// https://www.lunarium.co.uk/articles/planetary-hours-and-days.jsp
// https://en.wikipedia.org/wiki/Planetary_hours

const start = ["sol", "luna", "mars", "mercury", "jupiter", "venus", "saturn"];
export const DAY_IN_MS = 60_000 * 60 * 24;
export const chaldean = [
  "saturn", // ♄
  "jupiter", // ♃
  "mars", // ♂
  "sol", // ☉
  "venus", // ♀
  "mercury", // ☿
  "luna", // ☽
];

interface PlanetaryHour {
  date: Date;
  planet: string;
}

interface PlanetaryHoursMeta {
  sunrise: Date;
  sunset: Date;
  dayHourInMinutes: number;
  nightHourInMinutes: number;
}

type PlanetaryHours = PlanetaryHour[] & { meta: PlanetaryHoursMeta };

export function calcPlanetaryHoursForDayAndLocation(date, geo) {
  const solar = SunCalc.getTimes(date, geo.latitude, geo.longitude);
  const nextDay = new Date(date.getTime() + DAY_IN_MS);
  const solarNext = SunCalc.getTimes(nextDay, geo.latitude, geo.longitude);
  const dayOfWeek = getDay(date); // 0-6 where 0=Sunday.
  const chaldeanStartPos = chaldean.indexOf(start[dayOfWeek]);

  // Daytime Hours
  const daytimeMinutes = differenceInMinutes(solar.sunset, solar.sunrise);
  const dayHourInMinutes = daytimeMinutes / 12;

  // Nighttime Hours
  const nighttimeMinutes = differenceInMinutes(solarNext.sunrise, solar.sunset);
  const nightHourInMinutes = nighttimeMinutes / 12;

  const hours = new Array(24) as PlanetaryHours;

  hours.meta = {
    sunrise: solar.sunrise,
    sunset: solar.sunset,
    dayHourInMinutes,
    nightHourInMinutes,
  };

  for (let hour = 0; hour < 12; hour++) {
    const minutesSinceSunrise = dayHourInMinutes * hour;
    hours[hour] = {
      date: new Date(solar.sunrise.getTime() + minutesSinceSunrise * 60_000),
      planet: chaldean[(chaldeanStartPos + hour) % 7],
    };
  }

  for (let hour = 12; hour < 24; hour++) {
    const minutesSinceSunset = nightHourInMinutes * (hour - 12);
    hours[hour] = {
      date: new Date(solar.sunset.getTime() + minutesSinceSunset * 60_000),
      planet: chaldean[(chaldeanStartPos + hour) % 7],
    };
  }

  return hours;
}

export function upcomingHoursForPlanetAtLocation(planet, geo) {
  const now = new Date();
  const week = [0, 1, 2, 3, 4, 5, 6].map(
    (d, i) => new Date(now.getTime() + d * DAY_IN_MS),
  );

  const hours = [] as { from: Date; to: Date }[];
  for (const date of week) {
    const dayHours = calcPlanetaryHoursForDayAndLocation(date, geo);
    for (let i = 0; i < 24; i++) {
      const entry = dayHours[i];
      if (entry.planet === planet && now < entry.date) {
        hours.push({
          from: entry.date,
          to: new Date(
            entry.date.getTime() +
              (i < 12
                ? dayHours.meta.dayHourInMinutes
                : dayHours.meta.nightHourInMinutes) *
                60_000,
          ),
        });
      }
    }
  }

  return hours;
}

export const formatFromTo = (from, to) =>
  format(from, "ccc LLL do h:mm") + " - " + format(to, "h:mm aaa");

export const UpcomingHours = ({ hours }) => {
  return (
    <ul>
      {hours.map(({ from, to }, i) => (
        <li key={i}>{formatFromTo(from, to)}</li>
      ))}
    </ul>
  );
};
