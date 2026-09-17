// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateAt, renderAt } from "../../../tests/hydration";
import MercuryWidget, { nextRetrograde } from "./Mercury";

const defaultLocale = Settings.defaultLocale;

afterEach(() => {
  vi.useRealTimers();
  Settings.defaultLocale = defaultLocale;
});

describe("nextRetrograde", () => {
  it("finds the retrograde in progress, or else the next one", () => {
    const at = (time: string) => nextRetrograde(new Date(time));

    expect(at("2026-07-01T12:00")).toEqual({
      start: new Date(2026, 5, 29),
      end: new Date(2026, 6, 23),
    });
    // A retrograde is over from the start of its end date.
    expect(at("2026-07-23T00:00")).toEqual({
      start: new Date(2026, 9, 24),
      end: new Date(2026, 10, 13),
    });
    expect(at("2100-01-01T00:00")).toBeUndefined();
  });
});

describe("MercuryWidget", () => {
  it("hydrates a later visit in another locale without mismatches", async () => {
    // Built during one retrograde by an en-US machine, viewed after it in
    // an en-GB browser.
    Settings.defaultLocale = "en-US";
    const html = renderAt(new Date("2026-07-01T12:00:00Z"), <MercuryWidget />);
    expect(html).not.toContain("Retro");
    expect(html).toContain(">\u00a0</div>");

    Settings.defaultLocale = "en-GB";
    const { container, problems, unmount } = await hydrateAt(
      new Date("2026-08-01T12:00:00Z"),
      html,
      <MercuryWidget />,
    );

    expect(problems).toEqual([]);
    const label = within(container).getByText(/^Retro /);
    expect(label.textContent).toBe("Retro 24 Oct – 13 Nov");
    // 1rem, down to 9.5% of the tile's width, keeps it on one line.
    expect(label.style.fontSize).toBe("min(1rem, 9.5cqi)");

    await unmount();
  });

  it("says so inside the widget when the dates run out", async () => {
    const html = renderAt(new Date("2100-01-01T12:00:00Z"), <MercuryWidget />);
    const { container, problems, unmount } = await hydrateAt(
      new Date("2100-01-01T12:00:00Z"),
      html,
      <MercuryWidget />,
    );

    expect(problems).toEqual([]);
    const label = within(container).getByText(/^Retro /);
    expect(label.textContent).toBe("Retro dates unknown");
    expect(container.querySelector("img")).not.toBeNull();

    await unmount();
  });
});
