import { describe, expect, it } from "vitest";
import { parseComponentImageRequest } from "../componentImageRequest";
import { componentImageQuery } from "../componentImageUrl";
import {
  DEFAULT_MOTHERS,
  mothersFromString,
  mothersToString,
} from "./astroGeomancyChart";
import {
  COMPONENT_IMAGE_SLUGS,
  CONTRACTS,
  type ComponentImageSlug,
  InvalidComponentImageRequest,
  isComponentImageSlug,
} from "./index";
import { rectifySigilText, SIGIL_MAX_LETTERS } from "./roseSigil";
import { DIMENSION_LIMITS, parseDimensions } from "./types";

const parse = <S extends ComponentImageSlug>(slug: S, query = "") =>
  parseComponentImageRequest(slug, new URLSearchParams(query)).props;

describe("component image contracts", () => {
  it("keys the registry by each contract's own slug with a valid viewBox", () => {
    for (const slug of COMPONENT_IMAGE_SLUGS) {
      const contract = CONTRACTS[slug];
      expect(contract.slug).toBe(slug);
      expect(contract.viewBox).toHaveLength(4);
      expect(contract.viewBox[2]).toBeGreaterThan(0);
      expect(contract.viewBox[3]).toBeGreaterThan(0);
      expect(contract.keys).not.toContain("fmt");
      expect(contract.keys).not.toContain("width");
      expect(contract.keys).not.toContain("download");
      expect(isComponentImageSlug(slug)).toBe(true);
    }
    expect(isComponentImageSlug("toString")).toBe(false);
    expect(isComponentImageSlug("__proto__")).toBe(false);
  });

  const samples: Record<ComponentImageSlug, string[]> = {
    "tree-of-life": [
      "",
      "field=name.roman&topText=godName.name.he&bottomText=angelicOrder.name.he,index,archangel.name.he",
      "topText=&bottomText=name.en&colorScale=king&letterAttr=hebrew&flip=true",
      "showDaat=true&fontSize=10&active=daat&activePath=2_5&width=200",
      "fontSize=12.25&height=300",
    ],
    "astro-geomancy-chart": [
      "",
      "m=2222111122221111",
      "m=1111111111111111&width=512",
    ],
    "enochian-tablet": [
      "",
      "id=air",
      "id=earth&height=600",
      "font=enochian",
      "id=air&font=enochian&width=420",
    ],
    "seven-branched-candlestick": ["", "width=300", "width=100&height=100"],
    "table-of-shewbread": ["", "width=300"],
    "rose-sigil": ["text=גדי", "text=אבג&rose=false", "text=שלום&width=50"],
  };

  it.each(Object.entries(samples))(
    "round-trips %s props through canonical queries",
    (slug, queries) => {
      for (const query of queries) {
        const props = parse(slug as ComponentImageSlug, query);
        for (const format of ["svg", "png"] as const) {
          const canonical = componentImageQuery(
            { slug: slug as ComponentImageSlug, props } as never,
            { format },
          );
          const again = parseComponentImageRequest(slug, canonical);
          expect(again.props).toEqual(props);
          expect(again.format).toBe(format);
          expect(JSON.stringify(again.props)).toBe(JSON.stringify(props));
          for (const key of canonical.keys())
            expect([
              "fmt",
              "width",
              "height",
              ...CONTRACTS[slug].keys,
            ]).toContain(key);
        }
      }
    },
  );

  it("omits defaults so equivalent requests share one URL", () => {
    expect(
      componentImageQuery({
        slug: "tree-of-life",
        props: parse("tree-of-life"),
      }).toString(),
    ).toBe("");
    expect(
      componentImageQuery({
        slug: "tree-of-life",
        props: parse(
          "tree-of-life",
          "field=index&topText=index&bottomText=&flip=false",
        ),
      }).toString(),
    ).toBe("");
    expect(
      componentImageQuery({
        slug: "tree-of-life",
        props: parse("tree-of-life", "topText="),
      }).toString(),
    ).toBe("topText=");
    expect(
      componentImageQuery({
        slug: "astro-geomancy-chart",
        props: parse("astro-geomancy-chart", `m=${DEFAULT_MOTHERS}`),
      }).toString(),
    ).toBe("");
    expect(
      componentImageQuery({
        slug: "enochian-tablet",
        props: parse("enochian-tablet", "id=earth&font=latin"),
      }).toString(),
    ).toBe("");
    expect(
      componentImageQuery({
        slug: "enochian-tablet",
        props: parse("enochian-tablet", "font=enochian"),
      }).toString(),
    ).toBe("font=enochian");
    expect(
      componentImageQuery(
        { slug: "seven-branched-candlestick", props: {} },
        { format: "png", download: true },
      ).toString(),
    ).toBe("fmt=png&download=1");
  });

  it("decodes and encodes the geomancy mothers exactly", () => {
    expect(mothersFromString(DEFAULT_MOTHERS)).toEqual([
      [1, 2, 1, 1],
      [1, 1, 1, 2],
      [2, 1, 1, 1],
      [1, 2, 1, 2],
    ]);
    expect(mothersToString(mothersFromString("2121212121212121"))).toBe(
      "2121212121212121",
    );
    for (const bad of ["", "121", "1211111221111213", "12111112211112120"])
      expect(() => mothersFromString(bad)).toThrow(
        InvalidComponentImageRequest,
      );
  });

  it("canonicalises sigil final letters and bounds the text", () => {
    expect(rectifySigilText("שלום")).toBe("שלומ");
    expect(parse("rose-sigil", "text=שלום").text).toBe("שלומ");
    expect(
      parse("rose-sigil", "text=" + "א".repeat(SIGIL_MAX_LETTERS)).text,
    ).toHaveLength(SIGIL_MAX_LETTERS);
    for (const query of [
      "",
      "text=",
      "text=abc",
      "text=א ב",
      "text=א,ב",
      `text=${"א".repeat(SIGIL_MAX_LETTERS + 1)}`,
      "text=א&rose=0",
      "text=א&debug=true",
      "text=א&animate=true",
    ])
      expect(() => parse("rose-sigil", query)).toThrow(
        InvalidComponentImageRequest,
      );
    expect(CONTRACTS["rose-sigil"].personal).toBe(true);
    expect(CONTRACTS["astro-geomancy-chart"].personal).toBe(true);
    expect(CONTRACTS["tree-of-life"].personal).toBe(false);
    expect(
      CONTRACTS["rose-sigil"].filename(parse("rose-sigil", "text=גדי")),
    ).toBe("rose-sigil-גדי");
  });

  it("never accepts download as a render key, so saved references cannot carry it", () => {
    for (const slug of COMPONENT_IMAGE_SLUGS) {
      const query = slug === "rose-sigil" ? "text=א&download=1" : "download=1";
      expect(() => parse(slug, query)).toThrow(InvalidComponentImageRequest);
    }
  });

  it("rejects unknown tablets and keys on the new slugs", () => {
    for (const [slug, query] of [
      ["enochian-tablet", "id=water"],
      ["enochian-tablet", "id=Earth"],
      ["enochian-tablet", "font=Enochian"],
      ["enochian-tablet", "font=hebrew"],
      ["table-of-shewbread", "font=enochian"],
      ["seven-branched-candlestick", "id=earth"],
      ["astro-geomancy-chart", "m=1211111221111212&m=1211111221111212"],
      ["astro-geomancy-chart", "mothers=1211111221111212"],
    ] as const)
      expect(() => parse(slug, query)).toThrow(InvalidComponentImageRequest);
  });

  it("derives the missing raster axis from each viewBox inside the pixel limit", () => {
    const box = [-50, -50, 100, 100] as const;
    expect(parseDimensions(new URLSearchParams("width=300"), box)).toEqual({
      width: 300,
    });
    expect(parseDimensions(new URLSearchParams(""), box)).toEqual({});
    expect(
      parseDimensions(new URLSearchParams("width=2048&height=2048"), box),
    ).toEqual({ width: 2048, height: 2048 });
    expect(() =>
      parseDimensions(new URLSearchParams("width=2049&height=2049"), box),
    ).toThrow(InvalidComponentImageRequest);
    // A square box derives the same size for the other axis.
    expect(() =>
      parseDimensions(new URLSearchParams("width=2049"), box),
    ).toThrow(InvalidComponentImageRequest);
    // A tall box derives a narrow width: 1024 by 4096 is exactly the pixel limit.
    expect(
      parseDimensions(new URLSearchParams("height=4096"), [0, 0, 1, 4]),
    ).toEqual({ height: 4096 });
    expect(() =>
      parseDimensions(new URLSearchParams("height=4096"), [0, 0, 1, 2]),
    ).toThrow(InvalidComponentImageRequest);
    expect(() =>
      parseDimensions(new URLSearchParams("width=4096"), [0, 0, 1, 2]),
    ).toThrow(InvalidComponentImageRequest);
    expect(DIMENSION_LIMITS).toEqual({ axis: 4096, pixels: 4_194_304 });
  });
});
