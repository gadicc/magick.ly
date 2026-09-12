import SunCalc from "suncalc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calcPlanetaryHoursForDayAndLocation,
  DAY_IN_MS,
  formatFromTo,
  upcomingHoursForPlanetAtLocation,
} from "./utils";

vi.mock("suncalc", () => ({ default: { getTimes: vi.fn() } }));

const geo = { latitude: 51.5074, longitude: -0.1278 };
const dayRulers = [
  "sol",
  "luna",
  "mars",
  "mercury",
  "jupiter",
  "venus",
  "saturn",
];

beforeEach(() => {
  vi.mocked(SunCalc.getTimes).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

function regularSolarDay(date: Date) {
  const day = date.toISOString().slice(0, 10);
  return {
    sunrise: new Date(`${day}T06:00:00Z`),
    sunset: new Date(`${day}T18:00:00Z`),
  };
}

describe("planetary hours used by astrology and geomancy", () => {
  it("keeps minute truncation and separate sunrise/sunset anchors", () => {
    const date = new Date("2024-03-20T12:00:00Z");
    const sunrise = new Date("2024-03-20T06:01:59.900Z");
    const sunset = new Date("2024-03-20T18:02:00.100Z");
    vi.mocked(SunCalc.getTimes)
      .mockReturnValueOnce({ sunrise, sunset })
      .mockReturnValueOnce({ sunrise: new Date("2024-03-21T06:03:00.300Z") });

    const hours = calcPlanetaryHoursForDayAndLocation(date, geo);
    expect(hours).toHaveLength(24);
    expect(hours.meta).toEqual({
      sunrise,
      sunset,
      dayHourInMinutes: 60,
      nightHourInMinutes: 721 / 12,
    });
    expect(hours[0].date).toEqual(sunrise);
    expect(hours[11].date).toEqual(new Date("2024-03-20T17:01:59.900Z"));
    expect(hours[12].date).toEqual(sunset);
    expect(hours[23].date).toEqual(new Date("2024-03-21T05:02:55.100Z"));
    expect(SunCalc.getTimes).toHaveBeenNthCalledWith(
      1,
      date,
      geo.latitude,
      geo.longitude,
    );
    expect(SunCalc.getTimes).toHaveBeenNthCalledWith(
      2,
      new Date("2024-03-21T12:00:00Z"),
      geo.latitude,
      geo.longitude,
    );
  });

  it.each([
    [2024, 2, 17, "sol"],
    [2024, 2, 18, "luna"],
    [2024, 2, 19, "mars"],
    [2024, 2, 20, "mercury"],
    [2024, 2, 21, "jupiter"],
    [2024, 2, 22, "venus"],
    [2024, 2, 23, "saturn"],
  ] as const)(
    "starts the local civil weekday %s/%s/%s with %s",
    (year, month, day, ruler) => {
      // Local Date construction deliberately keeps the current browser-day contract.
      const date = new Date(year, month, day, 12);
      vi.mocked(SunCalc.getTimes).mockImplementation(regularSolarDay);
      const hours = calcPlanetaryHoursForDayAndLocation(date, geo);
      expect(hours[0].planet).toBe(ruler);
      expect(hours[7].planet).toBe(ruler);
      expect(hours[14].planet).toBe(ruler);
      expect(hours[21].planet).toBe(ruler);
    },
  );

  it("continues the Chaldean cycle through sunset", () => {
    vi.mocked(SunCalc.getTimes).mockImplementation(regularSolarDay);
    const hours = calcPlanetaryHoursForDayAndLocation(
      new Date(2024, 2, 20, 12),
      geo,
    );
    expect(hours.slice(0, 7).map((hour) => hour.planet)).toEqual([
      "mercury",
      "luna",
      "saturn",
      "jupiter",
      "mars",
      "sol",
      "venus",
    ]);
    expect(hours.slice(10, 15).map((hour) => hour.planet)).toEqual([
      "jupiter",
      "mars",
      "sol",
      "venus",
      "mercury",
    ]);
  });

  it.each([
    "2024-03-30T12:00:00Z",
    "2024-10-26T12:00:00Z",
    "2024-03-09T12:00:00Z",
    "2024-11-02T12:00:00Z",
  ])("preserves the existing 24-hour next-day lookup across DST: %s", (iso) => {
    const date = new Date(iso);
    vi.mocked(SunCalc.getTimes).mockImplementation(regularSolarDay);
    calcPlanetaryHoursForDayAndLocation(date, geo);
    const nextDate = vi.mocked(SunCalc.getTimes).mock.calls[1][0];
    expect(nextDate.getTime() - date.getTime()).toBe(DAY_IN_MS);
  });

  it("returns only future occurrences in the existing seven-day window", () => {
    const now = new Date("2024-03-20T06:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(SunCalc.getTimes).mockImplementation(regularSolarDay);
    const hours = upcomingHoursForPlanetAtLocation(
      dayRulers[now.getDay()],
      geo,
    );
    expect(hours).toHaveLength(23);
    expect(hours[0]).toEqual({
      from: new Date("2024-03-20T13:00:00Z"),
      to: new Date("2024-03-20T14:00:00Z"),
    });
    expect(hours.at(-1)?.from.getTime()).toBe(
      now.getTime() + 161 * 60 * 60 * 1000,
    );
    for (const hour of hours) {
      expect(hour.from.getTime()).toBeGreaterThan(now.getTime());
      expect(hour.to.getTime() - hour.from.getTime()).toBe(60 * 60 * 1000);
    }
  });

  it("keeps local display labels and the current 12-hour notation", () => {
    expect(
      formatFromTo(new Date(2024, 2, 20, 13, 5), new Date(2024, 2, 20, 14, 10)),
    ).toBe("Wed Mar 20th 1:05 - 2:10 pm");
  });

  it("characterizes the unresolved polar-event limitation without inventing a replacement schedule", () => {
    vi.mocked(SunCalc.getTimes).mockReturnValue({
      sunrise: new Date(NaN),
      sunset: new Date(NaN),
    });
    const hours = calcPlanetaryHoursForDayAndLocation(
      new Date("2024-06-21T12:00:00Z"),
      { latitude: 69.6492, longitude: 18.9553 },
    );
    expect(hours).toHaveLength(24);
    expect(hours.meta.dayHourInMinutes).toBeNaN();
    expect(hours.meta.nightHourInMinutes).toBeNaN();
    expect(hours.every((hour) => Number.isNaN(hour.date.getTime()))).toBe(true);
    expect(() => formatFromTo(hours[0].date, hours[1].date)).toThrow(
      RangeError,
    );
  });
});
