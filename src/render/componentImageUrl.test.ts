import { describe, expect, it } from "vitest";
import {
  componentImageFilename,
  componentImagePath,
  contentDisposition,
} from "./componentImageUrl";

const tree = {
  field: "name.roman",
  topText: "index",
  bottomText: "name.en",
  colorScale: "queen" as const,
  letterAttr: "hermetic" as const,
  flip: true,
  showDaat: false,
  fontSize: 10,
};

describe("component image URLs", () => {
  it("builds stable site-relative paths in contract order", () => {
    expect(componentImagePath({ slug: "tree-of-life", props: tree })).toBe(
      "/api/render/tree-of-life?field=name.roman&bottomText=name.en&flip=true&fontSize=10",
    );
    expect(
      componentImagePath(
        { slug: "tree-of-life", props: tree },
        { format: "png", download: true },
      ),
    ).toBe(
      "/api/render/tree-of-life?fmt=png&field=name.roman&bottomText=name.en&flip=true&fontSize=10&download=1",
    );
    expect(
      componentImagePath({ slug: "seven-branched-candlestick", props: {} }),
    ).toBe("/api/render/seven-branched-candlestick");
    expect(
      componentImagePath({
        slug: "rose-sigil",
        props: { text: "גדי", rose: true },
      }),
    ).toBe("/api/render/rose-sigil?text=%D7%92%D7%93%D7%99");
  });

  it("names downloads from the contract", () => {
    expect(componentImageFilename({ slug: "tree-of-life", props: tree })).toBe(
      "tree-of-life",
    );
    expect(
      componentImageFilename({
        slug: "astro-geomancy-chart",
        props: { mothers: "1111111111111111" },
      }),
    ).toBe("astro-geomancy-chart-1111111111111111");
    expect(
      componentImageFilename({
        slug: "enochian-tablet",
        props: { id: "air", font: "enochian" },
      }),
    ).toBe("enochian-air-tablet-glyphs");
    expect(
      componentImageFilename({
        slug: "enochian-tablet",
        props: { id: "earth", font: "latin" },
      }),
    ).toBe("enochian-earth-tablet");
    expect(
      componentImageFilename({ slug: "table-of-shewbread", props: {} }),
    ).toBe("table-of-shewbread");
    expect(
      componentImagePath(
        { slug: "table-of-shewbread", props: { height: 300 } },
        { download: true },
      ),
    ).toBe("/api/render/table-of-shewbread?height=300&download=1");
    expect(
      componentImageFilename({
        slug: "seven-branched-candlestick",
        props: { width: 300 },
      }),
    ).toBe("seven-branched-candlestick");
    expect(
      componentImagePath({
        slug: "seven-branched-candlestick",
        props: { width: 300, height: 300 },
      }),
    ).toBe("/api/render/seven-branched-candlestick?width=300&height=300");
  });

  it("encodes non-ASCII file names with an ASCII fallback", () => {
    expect(contentDisposition("inline", "tree-of-life.svg")).toBe(
      'inline; filename="tree-of-life.svg"',
    );
    expect(contentDisposition("attachment", "rose-sigil-גדי.png")).toBe(
      "attachment; filename=\"rose-sigil-___.png\"; filename*=UTF-8''rose-sigil-%D7%92%D7%93%D7%99.png",
    );
    expect(contentDisposition("inline", 'a"b\\c.svg')).toBe(
      "inline; filename=\"a_b_c.svg\"; filename*=UTF-8''a%22b%5Cc.svg",
    );
  });
});
