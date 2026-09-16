import { describe, expect, it } from "vitest";
import {
  InvalidComponentImageRequest,
  parseComponentImageRequest,
  TREE_IMAGE_FIELDS,
} from "./componentImageRequest";

const parse = (query = "", slug: "tree-of-life" = "tree-of-life") =>
  parseComponentImageRequest(slug, new URLSearchParams(query));
const parseSlug = (slug: string, query = "") =>
  parseComponentImageRequest(slug, new URLSearchParams(query));

describe("component image requests", () => {
  it("retains the old API defaults, distinct from the interactive page", () => {
    expect(parse()).toEqual({
      slug: "tree-of-life",
      format: "svg",
      props: {
        field: "index",
        topText: "index",
        bottomText: "",
        colorScale: "queen",
        letterAttr: "hermetic",
        flip: false,
        showDaat: false,
      },
    });
    expect(parse("fmt=&field=&colorScale=&letterAttr=")).toEqual(parse());
  });

  it("preserves the exact ritual's ordered mixed Hebrew/number labels", () => {
    expect(
      parse(
        "field=name.roman&topText=godName.name.he&bottomText=angelicOrder.name.he,index,archangel.name.he",
      ).props,
    ).toMatchObject({
      field: "name.roman",
      topText: "godName.name.he",
      bottomText: "angelicOrder.name.he,index,archangel.name.he",
    });
  });

  it.each(TREE_IMAGE_FIELDS)("allows the exposed scalar field %s", (field) => {
    expect(
      parse(
        new URLSearchParams({
          field,
          topText: field,
          bottomText: field,
        }).toString(),
      ).props,
    ).toMatchObject({ field, topText: field, bottomText: field });
  });

  it("keeps explicit empty top/bottom text and grade-field order", () => {
    expect(parse("topText=&bottomText=").props).toMatchObject({
      topText: "",
      bottomText: "",
    });
    expect(
      parse(
        "bottomText=gdGrade.element.symbol,gdGrade.orderId,gdGrade.planet.symbol",
      ).props.bottomText,
    ).toBe("gdGrade.element.symbol,gdGrade.orderId,gdGrade.planet.symbol");
  });

  it("parses true and false without string truthiness", () => {
    expect(
      parse("flip=false&showDaat=false&colorScale=king&letterAttr=hebrew")
        .props,
    ).toMatchObject({
      flip: false,
      showDaat: false,
      colorScale: "king",
      letterAttr: "hebrew",
    });
    expect(parse("flip=true&showDaat=true").props).toMatchObject({
      flip: true,
      showDaat: true,
    });
  });

  it("admits all existing path highlights and correctly spelled sephirot", () => {
    for (const active of [
      "keter",
      "chochmah",
      "binah",
      "hesed",
      "gevurah",
      "tiferet",
      "netzach",
      "hod",
      "yesod",
      "malchut",
      "daat",
    ]) {
      expect(parse(`active=${active}`).props.active).toBe(active);
    }
    for (const activePath of ["1_2", "2_5", "3_4", "7_10", "8_10"]) {
      expect(parse(`activePath=${activePath}`).props.activePath).toBe(
        activePath,
      );
    }
    expect(parse("active=&activePath=")).toEqual(parse());
  });

  it.each([
    "fmt=png&width=200&height=300",
    "width=1",
    "height=2000",
    "width=4096&height=1",
    "width=2000&height=2000",
    "fontSize=1",
    "fontSize=128",
    "fontSize=12.25",
  ])("admits bounded render sizing %s", (query) => {
    expect(parse(query)).toMatchObject({ slug: "tree-of-life" });
  });

  it.each([
    "unknown=1",
    "labels=custom",
    "pathHref=https://example.com",
    "sephirahHref=x",
    "field=index&field=name.en",
    "fmt=svg&fmt=png",
    "width=1&width=2",
    "field=__proto__",
    "field=constructor",
    "field=name",
    "topText=name.en,",
    "bottomText=index,index,index,index,index",
    "field=name.en, name.he",
    "fmt=jpg",
    "colorScale=emperor",
    "letterAttr=other",
    "flip=0",
    "flip=",
    "showDaat=False",
    "showDaat=true&colorScale=king",
    "active=chesed",
    "activePath=1_11",
    "width=0",
    "width=-1",
    "width=NaN",
    "width=1.2",
    "width=20px",
    "width=1e3",
    "width=0200",
    "width=4097",
    "width=4096",
    "height=4097",
    "height=4096",
    "height=",
    "width=2049&height=2049",
    "fontSize=0",
    "fontSize=129",
    "fontSize=-2",
    "fontSize=1e1",
    "fontSize=Infinity",
    "fontSize=1.234",
    "fontSize=",
    `field=${"x".repeat(4097)}`,
  ])("rejects malformed/unbounded requests: %s", (query) => {
    expect(() => parse(query)).toThrow(InvalidComponentImageRequest);
  });

  it.each([
    "TreeOfLife",
    "RoseSigil",
    "table-of-shewbread",
    "../tree-of-life",
    "__proto__",
    "constructor",
    "https://example.com",
    "",
  ])("does not dynamically import or fetch slug %s", (slug) => {
    expect(() => parseSlug(slug)).toThrow(
      "Unsupported component image request",
    );
  });
});
