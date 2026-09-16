import { describe, expect, it } from "vitest";
import { sigilFromSearchParams } from "./sigilState";

describe("shared sigil links", () => {
  it("restores validated text and the rose setting", () => {
    expect(
      sigilFromSearchParams(new URLSearchParams("text=שלום&rose=false")),
    ).toEqual({ text: "שלומ", rose: false });
    expect(sigilFromSearchParams(new URLSearchParams("text=גדי"))).toEqual({
      text: "גדי",
      rose: true,
    });
  });

  it("falls back to the page default for missing or invalid text", () => {
    for (const query of ["", "rose=false", "text=", "text=abc", "text=a&x=1"])
      expect(sigilFromSearchParams(new URLSearchParams(query))).toEqual({
        text: "גדי",
        rose: true,
      });
    // Unrelated keys such as campaign tags do not invalidate the shared text.
    expect(sigilFromSearchParams(new URLSearchParams("text=א&x=1"))).toEqual({
      text: "א",
      rose: true,
    });
  });
});
