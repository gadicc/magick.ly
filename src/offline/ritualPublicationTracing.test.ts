import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { RITUAL_PUBLICATION_STATIC_PATHS } from "../files/ritualPublicationStaticPaths";

const routes = [
  "/api/rituals/publication",
  "/api/rituals/publication/backfill",
] as const;
const wasm = "./node_modules/@resvg/resvg-wasm/index_bg.wasm";
const fonts = [
  "NotoSans-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansSymbols-Regular.ttf",
  "NotoSansSymbols2-Regular.ttf",
];

describe("ritual publication route tracing", () => {
  it("binds both server routes to every reviewed static and renderer artifact", async () => {
    const config = await nextConfig("phase-ritual-publication-test");
    const expected = [
      ...RITUAL_PUBLICATION_STATIC_PATHS.map(
        (pathname) => `./public${pathname}`,
      ),
      "./public/fonts/*.ttf",
      wasm,
    ];
    for (const route of routes)
      expect(config.outputFileTracingIncludes?.[route]).toEqual(expected);
    for (const pathname of RITUAL_PUBLICATION_STATIC_PATHS)
      expect(existsSync(path.join(process.cwd(), "public", pathname))).toBe(
        true,
      );
    for (const file of fonts)
      expect(existsSync(path.join(process.cwd(), "public/fonts", file))).toBe(
        true,
      );
    expect(existsSync(path.resolve(wasm))).toBe(true);
  });
});
