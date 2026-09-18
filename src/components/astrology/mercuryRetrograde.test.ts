import { readFileSync } from "node:fs";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentOrNextRetrograde, mercuryStations } from "./mercuryRetrograde";

/**
 * Mercury's stations as NASA JPL Horizons gives them, fitted from its
 * apparent ecliptic longitudes. See tests/fixtures/README.md.
 */
const horizons: { type: "R" | "D"; date: string }[] = JSON.parse(
  readFileSync(
    new URL(
      "../../../tests/fixtures/mercuryStationsHorizons.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const defaultZone = Settings.defaultZone;

afterEach(() => {
  vi.useRealTimers();
  Settings.defaultZone = defaultZone;
});

/** Runs `body` with the clock at `now` and the zone at `zone`. */
function at(now: string, zone: string, body: () => void) {
  Settings.defaultZone = zone;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  body();
}

describe("mercuryStations", () => {
  it("matches JPL Horizons from 2020 to 2035", () => {
    const from = new Date(horizons[0].date);
    const to = new Date(horizons.at(-1)?.date ?? "");
    const stations = mercuryStations(
      new Date(from.getTime() - 86400_000),
      new Date(to.getTime() + 86400_000),
    );

    expect(stations).toHaveLength(horizons.length);
    const offsets = stations.map((station, index) => {
      expect(station.type).toBe(
        horizons[index].type === "R" ? "retrograde" : "direct",
      );
      return Math.abs(
        station.time.getTime() - Date.parse(horizons[index].date),
      );
    });
    expect(Math.max(...offsets) / 60_000).toBeLessThan(15);
  });
});

describe("currentOrNextRetrograde", () => {
  it("gives the retrograde in progress, then the next one", () => {
    // Mercury turns retrograde 24 Oct 2026 and direct on 13 Nov.
    const dates = (retrograde = currentOrNextRetrograde(new Date())) =>
      `${retrograde?.start.toISODate()} to ${retrograde?.end.toISODate()}`;

    at("2026-09-18T12:00:00Z", "Europe/London", () =>
      expect(dates()).toBe("2026-10-24 to 2026-11-13"),
    );
    at("2026-10-30T12:00:00Z", "Europe/London", () =>
      expect(dates()).toBe("2026-10-24 to 2026-11-13"),
    );
    // The end date lasts all day, although Mercury turns direct at 15:52 UTC.
    at("2026-11-13T23:30:00Z", "Europe/London", () =>
      expect(dates()).toBe("2026-10-24 to 2026-11-13"),
    );
    at("2026-11-14T00:30:00Z", "Europe/London", () =>
      expect(dates()).toBe("2027-02-09 to 2027-03-03"),
    );
  });

  it("gives each viewer the dates of their own zone", () => {
    // Mercury turns direct at 2026-11-13 15:52 UTC, the 14th in Auckland.
    at("2026-11-01T12:00:00Z", "Europe/London", () =>
      expect(currentOrNextRetrograde(new Date())?.end.toISODate()).toBe(
        "2026-11-13",
      ),
    );
    at("2026-11-01T12:00:00Z", "Pacific/Auckland", () =>
      expect(currentOrNextRetrograde(new Date())?.end.toISODate()).toBe(
        "2026-11-14",
      ),
    );
  });

  it("widens a date when a station is close to local midnight", () => {
    // Mercury turned direct at 2020-03-10 03:48 UTC, which is 23:48 on the
    // 9th in New York. Twelve minutes either way changes that date, so the
    // later one is used.
    at("2020-03-01T12:00:00Z", "America/New_York", () =>
      expect(currentOrNextRetrograde(new Date())?.end.toISODate()).toBe(
        "2020-03-10",
      ),
    );
  });

  it("always finds a retrograde", () => {
    Settings.defaultZone = "UTC";
    for (let day = 0; day < 370; day += 7) {
      const now = new Date(Date.UTC(2026, 0, 1) + day * 86400_000);
      const retrograde = currentOrNextRetrograde(now);
      expect(retrograde?.start.toMillis()).toBeLessThan(
        (retrograde?.end.toMillis() ?? 0) + 1,
      );
    }
  });
});
