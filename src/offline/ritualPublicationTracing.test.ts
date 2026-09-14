import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { RITUAL_PUBLICATION_STATIC_PATHS } from "../files/ritualPublicationStaticPaths";

const publicationRoutes = [
  "/api/rituals/publication",
  "/api/rituals/publication/backfill",
] as const;
const rendererRoutes = ["/api/treeOfLife", "/api/render/*"] as const;
const linkedWasm = "./node_modules/@resvg/resvg-wasm/index_bg.wasm";
const tracedWasm = `./${path
  .relative(process.cwd(), realpathSync(linkedWasm))
  .split(path.sep)
  .join("/")}`;
const fonts = [
  "NotoSans-Regular.ttf",
  "NotoSansHebrew-Regular.ttf",
  "NotoSansDevanagari-Regular.ttf",
  "NotoSansSymbols-Regular.ttf",
  "NotoSansSymbols2-Regular.ttf",
];

describe("server image resource tracing", () => {
  it("traces the physical WASM target for renderer and publication routes", async () => {
    const config = await nextConfig("phase-ritual-publication-test");
    const rendererResources = ["./public/fonts/*.ttf", tracedWasm];
    const publicationResources = [
      ...RITUAL_PUBLICATION_STATIC_PATHS.map(
        (pathname) => `./public${pathname}`,
      ),
      ...rendererResources,
    ];
    for (const route of rendererRoutes)
      expect(config.outputFileTracingIncludes?.[route]).toEqual(
        rendererResources,
      );
    for (const route of publicationRoutes)
      expect(config.outputFileTracingIncludes?.[route]).toEqual(
        publicationResources,
      );
    expect(realpathSync(path.resolve(tracedWasm))).toBe(
      path.resolve(tracedWasm),
    );
    expect(existsSync(path.resolve(tracedWasm))).toBe(true);

    for (const pathname of RITUAL_PUBLICATION_STATIC_PATHS)
      expect(existsSync(path.join(process.cwd(), "public", pathname))).toBe(
        true,
      );
    for (const file of fonts)
      expect(existsSync(path.join(process.cwd(), "public/fonts", file))).toBe(
        true,
      );
  });
});
