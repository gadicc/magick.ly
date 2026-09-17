// @vitest-environment jsdom
import { DateTime, Settings } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateAt, renderAt } from "../../../../tests/hydration";
import Moon from "./moon";

// The page is prerendered at build time and viewed in a later lunation.
const buildTime = new Date("2026-09-17T10:16:00Z");
const visitTime = new Date("2026-10-20T12:00:00Z");
const { defaultLocale } = Settings;

const dates = (container: HTMLElement) =>
  [...container.querySelectorAll(".date")].map((date) => date.textContent);
const pastTitles = (container: HTMLElement) =>
  [...container.querySelectorAll(".past .title")].map(
    (title) => title.textContent,
  );

beforeEach(() => {
  // The GeoIP lookup never answers; the moon's hemisphere is not under test.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  Settings.defaultLocale = "en-GB";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Settings.defaultZone = "system";
  Settings.defaultLocale = defaultLocale;
});

describe("Moon page", () => {
  it("prerenders the lunation without dates", () => {
    Settings.defaultZone = "UTC";
    const html = renderAt(buildTime, <Moon />);

    expect(html).toContain("Last New Moon");
    expect(html).not.toContain("2026");
    expect(html).not.toContain(" past");
  });

  it("hydrates a later visit in another time zone without mismatches", async () => {
    Settings.defaultZone = "UTC";
    const html = renderAt(buildTime, <Moon />);

    Settings.defaultZone = "Pacific/Auckland";
    const { container, problems, unmount } = await hydrateAt(
      visitTime,
      html,
      <Moon />,
    );

    expect(problems).toEqual([]);
    expect(dates(container)).toEqual(
      [
        "2026-10-10T15:50:11.601Z",
        "2026-10-18T16:13:37.090Z",
        "2026-10-26T04:13:07.602Z",
        "2026-11-01T20:30:02.522Z",
        "2026-11-09T07:02:30.192Z",
        "2026-11-24T14:55:02.514Z",
      ].map((iso) =>
        DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_FULL),
      ),
    );
    expect(dates(container)[0]).toContain("11 October 2026");
    expect(pastTitles(container)).toEqual([
      "🌑 Last New Moon 🌑",
      "🌓 First Quarter 🌓",
    ]);

    await unmount();
  });
});
