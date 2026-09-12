import { createHash } from "node:crypto";
import { prepare } from "./prepare";

/** Exact reviewed compiler inputs. Changing code/dependencies requires a new identity and parity review. */
export const RITUAL_COMPILER_COMPONENTS = {
  prepareSha256:
    "4ec62e63052bcc32d9726e44d6acb867b4834fa931843e07269e093ca5219748",
  shortcutsSha256:
    "8b0998938b29d737339f5ad4924f41da4149188dcb9b9e22b5ca171dfe429486",
  "pug-lexer": "5.0.1",
  "pug-parser": "6.0.0",
  "magic-string": "0.30.10",
  "@ampproject/remapping": "2.3.0",
  "json-rich-text": "1.3.1",
} as const;
export const RITUAL_COMPILER_VERSION = JSON.stringify(
  RITUAL_COMPILER_COMPONENTS,
);
export const RITUAL_SOURCE_FORMAT = "magickli-pug-shortcuts";
export const RITUAL_SOURCE_FORMAT_VERSION = "1";
export const RITUAL_OUTPUT_FORMAT = "json-rich-text";
/** JRT node-shape compatibility profile, independent of the renderer's npm version. */
export const RITUAL_OUTPUT_FORMAT_VERSION = "1";

/** Exact source/output hashes; compilation errors never echo private source or compiler diagnostics. */
export function compileRitualSource(source: string) {
  try {
    const contentJson = JSON.stringify(prepare(source));
    return {
      sourceSha256: createHash("sha256").update(source, "utf8").digest("hex"),
      sourceFormat: RITUAL_SOURCE_FORMAT,
      sourceFormatVersion: RITUAL_SOURCE_FORMAT_VERSION,
      compilerVersion: RITUAL_COMPILER_VERSION,
      outputFormat: RITUAL_OUTPUT_FORMAT,
      outputFormatVersion: RITUAL_OUTPUT_FORMAT_VERSION,
      transformations: [] as string[],
      contentJson,
      contentSha256: createHash("sha256")
        .update(contentJson, "utf8")
        .digest("hex"),
    };
  } catch {
    return null;
  }
}
