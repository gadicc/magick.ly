import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  compileRitualSource,
  RITUAL_COMPILER_COMPONENTS,
  RITUAL_COMPILER_VERSION,
} from "./compileContract";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const hash = (source: string) =>
  createHash("sha256").update(source, "utf8").digest("hex");
it("records the actual reviewed prepare/shortcut sources and installed compiler/renderer package versions", () => {
  expect(hash(readFileSync(resolve(here, "prepare.js"), "utf8"))).toBe(
    RITUAL_COMPILER_COMPONENTS.prepareSha256,
  );
  expect(hash(readFileSync(resolve(here, "shortcuts.ts"), "utf8"))).toBe(
    RITUAL_COMPILER_COMPONENTS.shortcutsSha256,
  );
  for (const name of [
    "pug-lexer",
    "pug-parser",
    "magic-string",
    "@ampproject/remapping",
    "json-rich-text",
  ] as const) {
    const path =
      name === "json-rich-text"
        ? resolve(here, "../../node_modules/json-rich-text/package.json")
        : require.resolve(name + "/package.json");
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(
      RITUAL_COMPILER_COMPONENTS[name],
    );
  }
  expect(RITUAL_COMPILER_VERSION).toBe(
    JSON.stringify(RITUAL_COMPILER_COMPONENTS),
  );
});
it("preserves exact source hash and explicit untransformed output identity", () => {
  const source = "p(forMe=true) Synthetic α\r\n";
  const result = compileRitualSource(source)!;
  expect(result.sourceSha256).toBe(hash(source));
  expect(result.contentSha256).toBe(hash(result.contentJson));
  expect(result.transformations).toEqual([]);
  expect(JSON.parse(result.contentJson)).toMatchObject({
    children: [
      { forMe: true, children: [{ type: "text", value: "Synthetic α" }] },
    ],
  });
});
it("returns no partial output or compiler details for an invalid source", () => {
  expect(compileRitualSource('p(title="unclosed)')).toBeNull();
});
