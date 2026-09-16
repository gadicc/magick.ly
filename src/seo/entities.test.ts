import { describe, expect, it } from "vitest";
import {
  entityIds,
  entityPages,
  gradePage,
  pathPage,
  planetPage,
  sephirahPage,
} from "./entities";
import { PUBLIC_PAGES } from "./pages";

describe("entity pages", () => {
  it("describes a planet with the correspondences that fit", () => {
    expect(planetPage("saturn")).toEqual({
      path: "/astrology/planet/saturn",
      title: "Saturn ♄ Correspondences",
      description:
        "Correspondences of Saturn (Hebrew שַׁבְּתַאי, Shabbathai): symbol ♄, " +
        "letter Tav, god name YHVH Elohim, archangel Kassiel, intelligence " +
        "Agiel, spirit Zazel.",
    });
    expect(planetPage("luna")?.description).toBe(
      "Correspondences of Luna (Hebrew לבנה, Levanah): symbol ☾, letter " +
        "Gimel, archangel Gavriel, intelligence Shelachel, spirit Chasmodai.",
    );
    expect(planetPage("primum-mobile")).toMatchObject({
      title: "Primum Mobile Correspondences",
      description:
        "Correspondences of Primum Mobile (Hebrew ראשית הגלגולים, Roshit HaGilgulim).",
    });
    expect(planetPage("earth")?.description).toBe(
      "Correspondences of Earth: symbol ♁.",
    );
  });

  it("describes grades with and without a Sephirah", () => {
    expect(gradePage("1=10")).toEqual({
      path: "/gd/grade/1=10",
      title: "Zelator 1=10 Grade",
      description:
        "The Zelator 1=10 grade of the Golden Dawn, attributed to Malchut on " +
        "the Tree of Life and the element of Earth, with its correspondences.",
    });
    expect(gradePage("portal")).toMatchObject({
      title: "Portal Grade",
      description:
        "The Portal grade of the Golden Dawn and the element of Spirit, with " +
        "its correspondences.",
    });
    expect(gradePage("0=0")?.description).toBe(
      "The Neophyte 0=0 grade of the Golden Dawn, with its correspondences.",
    );
  });

  it("describes Sephiroth, including Da'at", () => {
    // Keter's row spells its archangel key `archangelIdId`, so no archangel.
    expect(sephirahPage("keter")).toEqual({
      path: "/kabbalah/sephirah/keter",
      title: "Keter (Crown) on the Tree of Life",
      description:
        'Keter (כתר), "Crown", is Sephirah 1 of the Tree of Life: god name ' +
        "Ehiyeh, angelic host Chayot Hakodesh, King and Queen scale colours.",
    });
    expect(sephirahPage("daat")).toMatchObject({
      path: "/kabbalah/sephirah/daat",
      description:
        'Da\'at (דעת), "Knowledge", is Sephirah 11 of the Tree of Life: god ' +
        "name YHVH Elohim, King and Queen scale colours.",
    });
  });

  it("drops the fields that would overflow a snippet", () => {
    // The colours would take Binah's description past 160 characters.
    expect(sephirahPage("binah")?.description).toBe(
      'Binah (בינה), "Understanding", is Sephirah 3 of the Tree of Life: god ' +
        "name YHVH Elohim, archangel Tzaphkiel, angelic host Ar'aleem.",
    );
  });

  it("describes Hermetic and Hebrew-only paths", () => {
    expect(pathPage("1_2")).toEqual({
      path: "/kabbalah/path/1_2",
      title: "Tree of Life Path 11: Keter–Chochmah",
      description:
        "Path 11 of the Tree of Life joins Keter and Chochmah. Hermetic " +
        "attribution: the letter Aleph and The Fool; Hebrew attribution: He.",
    });
    expect(pathPage("8_10")?.description).toBe(
      "Path 31 of the Tree of Life joins Hod and Malchut. Hermetic " +
        "attribution: the letter Shin and Judgement.",
    );
    expect(pathPage("2_5")).toEqual({
      path: "/kabbalah/path/2_5",
      title: "Tree of Life Path Chochmah–Gevurah",
      description:
        "The path joining Chochmah and Gevurah exists only on the Hebrew " +
        "Tree of Life, where it carries the letter Zayin; the Hermetic tree " +
        "omits it.",
    });
  });

  it("rejects unknown and inherited ids", () => {
    for (const lookup of [planetPage, gradePage, sephirahPage, pathPage]) {
      expect(lookup("missing")).toBeNull();
      expect(lookup("constructor")).toBeNull();
    }
  });

  it("lists one page per row with unique, sized copy", () => {
    const pages = entityPages();
    const routes = ["planet", "gdGrade", "sephirah", "tolPath"] as const;
    expect(pages).toHaveLength(
      routes.reduce((sum, kind) => sum + entityIds(kind).length, 0),
    );
    const publicTitles = Object.values(PUBLIC_PAGES).map((page) => page.title);
    const titles = new Set([
      ...pages.map((page) => page.title),
      ...publicTitles,
    ]);
    expect(titles.size).toBe(pages.length + publicTitles.length);
    expect(new Set(pages.map((page) => page.path)).size).toBe(pages.length);
    for (const page of pages) {
      expect(page.title.length, page.path).toBeLessThanOrEqual(48);
      expect(page.description.length, page.path).toBeLessThanOrEqual(160);
      expect(page.description, page.path).not.toMatch(/undefined/);
    }
  });

  it("exposes static params by data set", () => {
    expect(entityIds("gdGrade")).toContainEqual({ id: "portal" });
    expect(entityIds("sephirah")).toHaveLength(11);
    expect(entityIds("tolPath")).toHaveLength(24);
  });
});
