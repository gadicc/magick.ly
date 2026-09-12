import {
  Decoration,
  MatchDecorator,
  RangeSet,
  ViewPlugin,
} from "@uiw/react-codemirror";
import { shortcutPatterns } from "@/doc/shortcuts";
import SourceMapConsumer from "./SourceMapConsumer";

export { transformAndMapShortcuts } from "@/doc/shortcuts";

const roleSpec = { attributes: { style: "color: #aaf" } };
const restSpec = { attributes: { style: "color: #98c379" } }; // theme string color
const nonSpec = { attributes: { style: "color: rgb(171, 178, 191)" } };

const shortcuts = [
  {
    name: "say",
    regexp: shortcutPatterns.say,
    decorate(add, from, to, match, view) {
      add(from, from + match[1].length, Decoration.mark(roleSpec));
      add(
        from + match[1].length,
        from + match[1].length + 1,
        Decoration.mark(nonSpec),
      );
      add(
        from + match[1].length + 1,
        from + match.input.length,
        Decoration.mark(restSpec),
      );
    },
  },
  {
    name: "do",
    regexp: shortcutPatterns.do,
    decorate(add, from, to, match, view) {
      const { groups } = match;
      if (!groups) return;
      add(
        from + groups.skip.length,
        Math.min(to, from + groups.role.length + 2),
        Decoration.mark(roleSpec),
      );
    },
  },
  {
    name: "var",
    regexp: shortcutPatterns.var,
    decorate(add, from, to, match, view) {
      const { groups } = match;
      if (!groups) return;
      add(
        from,
        to,
        // theme "var" token color
        Decoration.mark({ attributes: { style: "color: #c678dd" } }),
      );
    },
  },
];

export async function trace(sourceMaps, line, column) {
  let pos = { line, column };
  const reversedSourceMaps = [...sourceMaps].reverse();
  for (const sourceMap of reversedSourceMaps /*.toReversed()*/) {
    const consumer = await new SourceMapConsumer(sourceMap);
    pos = consumer.originalPositionFor(pos);
  }
  return pos;
}

const reversedShortcuts = [...shortcuts].reverse();
const shortcutDecorators = reversedShortcuts
  // .toReversed()
  .filter(({ decorate }) => decorate)
  .map(({ regexp, decorate }) => new MatchDecorator({ regexp, decorate }))
  .concat([
    new MatchDecorator({
      regexp: /role="([A-Za-z,-]+)"/g,
      decorate(add, from, to, match, view) {
        add(from + 6, to - 1, Decoration.mark(roleSpec));
      },
    }),
  ]);

export const shortcutHighlighters = shortcutDecorators.map((decorator) =>
  ViewPlugin.fromClass(
    class {
      decorations: RangeSet<Decoration>;

      constructor(view) {
        this.decorations = decorator.createDeco(view);
      }
      update(update) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  ),
);
