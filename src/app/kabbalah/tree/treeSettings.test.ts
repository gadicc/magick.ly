import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_SETTINGS,
  treeImageLink,
  treeSettings,
} from "./treeSettings";

describe("treeSettings", () => {
  it("uses the page defaults without a query", () => {
    expect(DEFAULT_TREE_SETTINGS).toEqual({
      field: "name.roman",
      topText: "index",
      bottomText: "name.en",
      colorScale: "queen",
      letterAttr: "hermetic",
      flip: false,
      showDaat: false,
      fontSize: 10,
    });
    expect(treeSettings(new URLSearchParams())).toEqual(DEFAULT_TREE_SETTINGS);
    // Empty values fall back as the page always did.
    expect(treeSettings(new URLSearchParams("field=&fontSize="))).toEqual(
      DEFAULT_TREE_SETTINGS,
    );
  });

  it("reads a shared query", () => {
    expect(
      treeSettings(
        new URLSearchParams(
          "field=godName.name.roman&topText=planet.name.en.en&bottomText=" +
            "&colorScale=queen&letterAttr=hebrew&flip=true&showDaat=true&fontSize=12",
        ),
      ),
    ).toEqual({
      field: "godName.name.roman",
      topText: "planet.name.en.en",
      bottomText: "name.en",
      colorScale: "queen",
      letterAttr: "hebrew",
      flip: true,
      showDaat: true,
      fontSize: "12",
    });
  });

  it("only draws Da'at in the Queen scale and only for exact true", () => {
    expect(
      treeSettings(new URLSearchParams("colorScale=king&showDaat=true")),
    ).toMatchObject({ colorScale: "king", showDaat: false });
    expect(
      treeSettings(new URLSearchParams("flip=1&showDaat=yes")),
    ).toMatchObject({ flip: false, showDaat: false });
  });
});

describe("treeImageLink", () => {
  it("links the defaults with the page's explicit font size", () => {
    expect(treeImageLink(DEFAULT_TREE_SETTINGS)).toEqual({
      slug: "tree-of-life",
      props: expect.objectContaining({
        field: "name.roman",
        bottomText: "name.en",
        fontSize: 10,
        flip: false,
        showDaat: false,
      }),
    });
  });

  it("has no link for settings the server contract rejects", () => {
    expect(
      treeImageLink({ ...DEFAULT_TREE_SETTINGS, colorScale: "sepia" }),
    ).toBeUndefined();
  });
});
