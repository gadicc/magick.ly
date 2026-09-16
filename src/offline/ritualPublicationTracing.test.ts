import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { RITUAL_PUBLICATION_STATIC_PATHS } from "../files/ritualPublicationStaticPaths";

const publicationRoutes = [
  "/api/rituals/publication",
  "/api/rituals/publication/backfill",
] as const;
const treeRoutes = ["/api/treeOfLife"] as const;
const rendererRoutes = ["/api/render/*"] as const;
const linkedWasm = "./node_modules/@resvg/resvg-wasm/index_bg.wasm";
const tracedWasm = `./${path
  .relative(process.cwd(), realpathSync(linkedWasm))
  .split(path.sep)
  .join("/")}`;
const trace = (file: string) =>
  `./${path.relative(process.cwd(), realpathSync(file)).split(path.sep).join("/")}`;
const cssTreeDirectory = path.dirname(
  realpathSync(path.join(process.cwd(), "node_modules/css-tree/package.json")),
);
const cssTreeData = path.join(cssTreeDirectory, "data/patch.json");
const mdnDirectory = realpathSync(path.join(cssTreeDirectory, "../mdn-data"));
const sourceMapDirectory = realpathSync(
  path.join(cssTreeDirectory, "../source-map-js"),
);
const mdnData = ["at-rules.json", "properties.json", "syntaxes.json"].map(
  (file) => path.join(mdnDirectory, "css", file),
);
const tracedCssData = [cssTreeData, ...mdnData].map(trace);
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
    // Publication and the legacy alias only render the Tree, so they need the
    // public base fonts; the generic render route also needs the server-only
    // component fonts.
    const baseResources = ["./public/fonts/*.ttf", tracedWasm];
    const rendererResources = [
      "./public/fonts/*.ttf",
      "./assets/fonts/*.ttf",
      tracedWasm,
    ];
    const publicationResources = [
      ...RITUAL_PUBLICATION_STATIC_PATHS.map(
        (pathname) => `./public${pathname}`,
      ),
      ...baseResources,
      ...tracedCssData,
    ];
    expect(config.serverExternalPackages).toContain("css-tree");
    for (const route of treeRoutes)
      expect(config.outputFileTracingIncludes?.[route]).toEqual(baseResources);
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
    for (const file of ["EnochianPlain.ttf", "NotoEmoji-Variable.ttf"])
      expect(existsSync(path.join(process.cwd(), "assets/fonts", file))).toBe(
        true,
      );
    for (const file of tracedCssData) {
      expect(path.resolve(file)).toBe(realpathSync(path.resolve(file)));
      expect(existsSync(path.resolve(file))).toBe(true);
    }
  });

  it("loads the complete external CSS parser from an isolated package graph", () => {
    const root = mkdtempSync(path.join(tmpdir(), "magickli-css-tree-runtime-"));
    const modules = path.join(root, "node_modules");
    const cssDestination = path.join(modules, "css-tree");
    const mdnDestination = path.join(modules, "mdn-data");
    const sourceMapDestination = path.join(modules, "source-map-js");
    try {
      mkdirSync(path.join(cssDestination, "data"), { recursive: true });
      cpSync(
        path.join(cssTreeDirectory, "package.json"),
        path.join(cssDestination, "package.json"),
      );
      cpSync(
        path.join(cssTreeDirectory, "cjs"),
        path.join(cssDestination, "cjs"),
        {
          recursive: true,
        },
      );
      cpSync(cssTreeData, path.join(cssDestination, "data/patch.json"));
      mkdirSync(path.join(mdnDestination, "css"), { recursive: true });
      cpSync(
        path.join(mdnDirectory, "package.json"),
        path.join(mdnDestination, "package.json"),
      );
      for (const file of mdnData)
        cpSync(file, path.join(mdnDestination, "css", path.basename(file)));
      mkdirSync(sourceMapDestination, { recursive: true });
      cpSync(
        path.join(sourceMapDirectory, "package.json"),
        path.join(sourceMapDestination, "package.json"),
      );
      cpSync(
        path.join(sourceMapDirectory, "lib"),
        path.join(sourceMapDestination, "lib"),
        { recursive: true },
      );

      const isolatedRequire = createRequire(path.join(root, "probe.cjs"));
      expect(isolatedRequire.resolve("css-tree").startsWith(root)).toBe(true);
      const css = isolatedRequire("css-tree") as typeof import("css-tree");
      expect(css.parse("a { color: red }").type).toBe("StyleSheet");
      expect(css.lexer.matchProperty("color", "red").matched).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
