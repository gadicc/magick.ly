import remapping from "@ampproject/remapping";
import MagicString from "magic-string";

// Keep source transformation usable without loading CodeMirror or browser WASM.
// The editor imports the same patterns for its shortcut decorations.
function lowerCaseFirstLetter(string) {
  return string
    .split(",")
    .map((s) => s.charAt(0).toLowerCase() + s.slice(1))
    .join(",");
}

export const shortcutPatterns = {
  say: /^\b([\w,-]+):/gm,
  do: /^(?<skip>\* ?)(?<role>[\w,-]*)/gm,
  grade: /\b(?<grade>\d{1,2}=\d{1,2})\b(?<space> )?/gm,
  var: /\$\{(?<varName>\w+);?(?<args>[\w,=]*)\}(?<space> )?/gm,
};

const shortcuts = [
  {
    name: "say",
    regexp: shortcutPatterns.say,
    transform(input: string, s: MagicString, source: string) {
      const matches = input.matchAll(this.regexp);
      for (const match of matches) {
        const offset = match.index;
        const [_match, role] = match;
        // 0 2 4 6 8 10 13 16 19
        // Hiero: hi there
        //    \......,\......,
        // say(role="hiero") hi there
        const pre = 'say(role="';
        const post = '")';
        // const replacement = pre + lowerCaseFirstLetter(role) + post;

        s.update(offset, offset + role.length, lowerCaseFirstLetter(role));
        s.remove(offset + role.length, offset + role.length + 1); // ":"
        s.appendRight(offset + role.length, post);
        s.prependLeft(offset, pre);
      }
      return s.toString();
    },
  },
  {
    name: "do",
    regexp: shortcutPatterns.do,
    transform(input: string, s: MagicString, source: string) {
      const matches = input.matchAll(this.regexp);
      for (const match of matches) {
        const offset = match.index;
        const [_match, skip, role] = match;
        // 0 2 4 6 8 10 13 16 19
        // * Hiero does something.
        //   \......,\.......
        // do(role="hiero") does something
        const pre = 'do(role="';
        const post = '")';

        s.update(
          offset + skip.length,
          offset + skip.length + role.length,
          lowerCaseFirstLetter(role),
        );
        s.appendRight(offset + skip.length + role.length, post);
        s.remove(offset, offset + skip.length);
        s.prependLeft(offset, pre);
      }
      return s.toString();
    },
  },
  {
    name: "grade",
    regexp: shortcutPatterns.grade,
    transform(input: string, s: MagicString, source: string) {
      const matches = input.matchAll(this.regexp);
      for (const match of matches) {
        const offset = match.index;
        const [_match, grade, space] = match;

        const gradePre = 'grade(grade="';
        if (input.substring(offset - gradePre.length, offset) === gradePre) {
          continue;
        }

        const lineStartIdx = input.lastIndexOf("\n", offset) + 1;
        const lineStart = input.substring(lineStartIdx, offset);

        // if (pre.match(/["(]+/)) continue;
        const quotesCount = (lineStart.match(/"/g) || []).length;
        if (quotesCount % 2) continue;

        const indent = lineStart.match(/^( *)/)?.[0] || "";

        s.appendRight(
          offset + grade.length,
          ['")', space && "|", "|"]
            .filter(Boolean)
            .join("\n" + (indent || "  ")),
        );
        s.prependLeft(
          offset,
          ["", "|", 'grade(grade="'].join("\n" + (indent || "  ")),
        );
      }
      return s.toString();
    },
  },
  {
    name: "var",
    regexp: shortcutPatterns.var,
    transform(input: string, s: MagicString, source: string) {
      const matches = input.matchAll(this.regexp);
      for (const match of matches) {
        const offset = match.index;
        const [_match, varName, args, space] = match;
        const lineStartIdx = input.lastIndexOf("\n", offset) + 1;
        const lineStart = input.substring(lineStartIdx, offset);
        const indent = lineStart.match(/^( *)/)?.[0] || "";

        s.remove(
          // }
          offset + varName.length + 2,
          offset + varName.length + (args.length ? args.length + 1 : 0) + 3,
        );
        s.appendRight(
          offset + varName.length + 2,
          ['")', space && "|", "| "]
            .filter(Boolean)
            .join("\n" + (indent || "  ")),
        );
        s.prependLeft(
          offset,
          (args === "b"
            ? ["", "|", "b", '  var(name="']
            : ["", "|", 'var(name="']
          ).join("\n" + (indent || "  ")),
        );

        s.remove(offset, offset + 2); // ${
      }
      return s.toString();
    },
  },
];

/** Expand ritual shortcuts and compose mappings back to the original Pug source. */
export function transformAndMapShortcuts(input: string) {
  let transformed = input;

  let prev;
  const sourceMaps: string[] = [];
  for (let i = 0; i < shortcuts.length; i++) {
    const file = "result" + i + ".pug";
    if (!prev) prev = "source.pug";
    const s = new MagicString(transformed);
    transformed = shortcuts[i].transform(transformed, s, prev);
    // console.log("transformed", transformed);
    sourceMaps.push(
      s.generateMap({ source: prev, file, hires: true }).toString(),
    );
    prev = file;
  }

  // NB: reverse() mutates, in case we need it again.
  // toReversed() not common in older node versions.
  const remapped = remapping(sourceMaps.reverse(), () => null);
  return {
    transformed,
    sourceMap: remapped,
    // sourceMaps,
  };
}
