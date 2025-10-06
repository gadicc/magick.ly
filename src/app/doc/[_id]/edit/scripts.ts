import type { ScriptProps } from "./DocEdit";

const caps = (s: string) =>
  s
    .split(",")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(",");

const scripts: Record<string, (props: ScriptProps) => void> = {
  unshortcut({ value, view, onChange }) {
    let transformed = value;
    const transforms: [
      RegExp,
      (substring: string, ...args: string[]) => string,
    ][] = [
      [/^say\(role="(.*)"\)/gm, (_, role) => caps(role) + ":"],
      [/^do\(role="(.*)"\)/gm, (_, role) => "* " + caps(role)],
    ];
    for (const [regexp, replacer] of transforms) {
      transformed = transformed.replaceAll(regexp, replacer);
    }

    view.dispatch({
      changes: { from: 0, to: value.length, insert: transformed },
    });
    onChange(transformed);
  },
};

export default scripts;
