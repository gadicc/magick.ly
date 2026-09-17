// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GradeTree from "./gd/GradeTree";
import Tiles from "./Tiles";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Tiles", () => {
  it("keeps a preview's own links out of the tile link", () => {
    // /gd's Grades tile previews the grade tree, whose sephirot link to
    // their grades. React reports nested links with console.error.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <Tiles
        tiles={[
          {
            Component: () => <GradeTree height="120%" />,
            title: "Grades",
            to: "/gd/grades",
          },
          { img: "/pics/about.png", title: "About", to: "/about" },
        ]}
      />,
    );

    expect(error).not.toHaveBeenCalled();
    expect(container.querySelectorAll("a a")).toHaveLength(0);

    const previewLinks = container.querySelectorAll("svg a[*|href]");
    expect(previewLinks).toHaveLength(10);
    for (const link of previewLinks) {
      expect(link.closest("[inert]")).not.toBeNull();
    }

    const tile = screen.getByRole("link", { name: "Grades" });
    expect(tile.getAttribute("href")).toBe("/gd/grades");
    // The link covers the preview, so the whole tile stays clickable.
    expect(getComputedStyle(tile).position).toBe("absolute");
    expect(tile.closest("[inert]")).toBeNull();
    expect(tile.nextElementSibling?.hasAttribute("inert")).toBe(true);
    expect(tile.parentElement?.className).toContain("MuiGrid-grid-md-3");
    const about = screen.getByRole("link", { name: "About" });
    expect(about.nextElementSibling?.querySelector("img")).not.toBeNull();
  });

  it("leaves an informative preview readable, after its title", () => {
    render(
      <Tiles
        size={{ xs: 6 }}
        tiles={[
          {
            Component: () => <div>Waxing Crescent</div>,
            title: "Moon ☾",
            to: "/astrology/moon",
            informative: true,
          },
        ]}
      />,
    );

    const tile = screen.getByRole("link", { name: "Moon ☾" });
    const preview = tile.nextElementSibling;
    expect(preview?.textContent).toBe("Waxing Crescent");
    expect(preview?.hasAttribute("inert")).toBe(false);
    expect(tile.parentElement?.className).toContain("MuiGrid-grid-xs-6");
    expect(tile.parentElement?.className).not.toContain("MuiGrid-grid-md");
  });
});
