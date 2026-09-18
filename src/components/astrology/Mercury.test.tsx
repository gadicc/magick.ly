// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { Settings } from "luxon";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateAt, renderAt } from "../../../tests/hydration";
import MercuryWidget from "./Mercury";

const defaultLocale = Settings.defaultLocale;
const defaultZone = Settings.defaultZone;

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("./mercuryRetrograde");
  Settings.defaultLocale = defaultLocale;
  Settings.defaultZone = defaultZone;
});

/** Lets the widget's dynamic import and its state update settle. */
async function settle(container: HTMLElement) {
  for (let tries = 0; tries < 50; tries++) {
    if (container.textContent?.trim()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("The widget's label stayed blank for 500ms");
}

describe("MercuryWidget", () => {
  it("hydrates a prerendered page, then fills in the dates", async () => {
    // Built by an en-US machine in New York months before the visit.
    Settings.defaultLocale = "en-US";
    Settings.defaultZone = "America/New_York";
    const html = renderAt(new Date("2026-07-01T12:00:00Z"), <MercuryWidget />);
    expect(html).not.toContain("Retro");
    expect(html).toContain(">\u00a0</div>");

    Settings.defaultLocale = "en-GB";
    Settings.defaultZone = "Europe/London";
    const { container, problems, unmount } = await hydrateAt(
      new Date("2026-10-30T12:00:00Z"),
      html,
      <MercuryWidget />,
    );

    expect(problems).toEqual([]);
    await settle(container);
    const label = within(container).getByText(/^Retro /);
    expect(label.textContent).toBe("Retro 24 Oct – 13 Nov");
    // 1rem, down to 9.5% of the tile's width, keeps it on one line.
    expect(label.style.fontSize).toBe("min(1rem, 9.5cqi)");

    await unmount();
  });

  it("says so when no retrograde comes back", async () => {
    vi.doMock("./mercuryRetrograde", () => ({
      currentOrNextRetrograde: () => undefined,
    }));

    const html = renderAt(new Date("2026-10-30T12:00:00Z"), <MercuryWidget />);
    const { container, problems, unmount } = await hydrateAt(
      new Date("2026-10-30T12:00:00Z"),
      html,
      <MercuryWidget />,
    );

    expect(problems).toEqual([]);
    await settle(container);
    const label = within(container).getByText(/^Retro /);
    expect(label.textContent).toBe("Retro dates unknown");
    expect(container.querySelector("img")).not.toBeNull();

    await unmount();
  });
});
