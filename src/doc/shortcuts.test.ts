import pugLex from "pug-lexer";
import pugParse from "pug-parser";
import { SourceMapConsumer } from "source-map";
import { describe, expect, it } from "vitest";
import { transformAndMapShortcuts } from "./shortcuts";

function positionAt(source: string, offset: number) {
  return {
    line: source.slice(0, offset).split("\n").length,
    column: offset - (source.lastIndexOf("\n", offset - 1) + 1),
  };
}

describe("ritual shortcuts", () => {
  it.each([
    ["Hierophant: Speak", 'say(role="hierophant") Speak'],
    ["PastHierophant,Keryx: Speak", 'say(role="pastHierophant,keryx") Speak'],
    ["All-officers: Speak", 'say(role="all-officers") Speak'],
    [
      "All-except-hierophant,hegemon: Speak",
      'say(role="all-except-hierophant,hegemon") Speak',
    ],
    ["* Hierophant Rise", 'do(role="hierophant") Rise'],
    ["*Keryx ✊", 'do(role="keryx") ✊'],
    ["* All-officers Rise", 'do(role="all-officers") Rise'],
  ])("expands %s without changing the instruction", (source, expected) => {
    expect(transformAndMapShortcuts(source).transformed).toBe(expected);
  });

  it("only lowercases the first letter of each comma-separated role", () => {
    // This preserves existing case-sensitive role expressions, including the
    // capital inside a prefixed exclusion. Role validation is a separate step.
    expect(
      transformAndMapShortcuts(
        "* All-officers-except-Hierophant,PastHierophant Rise",
      ).transformed,
    ).toBe('do(role="all-officers-except-Hierophant,pastHierophant") Rise');
  });

  it.each([
    "note\n  Hierophant: indented speech",
    "note\n  * Keryx indented action",
    "p Hierophant: ordinary text",
    "p A * Keryx ordinary text",
    'say(role="hierophant") explicit speech',
    'do(role="keryx") explicit action',
  ])("leaves non-shortcut source unchanged: %s", (source) => {
    expect(transformAndMapShortcuts(source).transformed).toBe(source);
  });

  it.each([
    'grade(grade="1=10")',
    'title(text="Opening of the 1=10 Grade")',
    "p x1=10 1=10x 123=45 1=100 1 = 10",
  ])("does not expand literal or nonmatching grade syntax: %s", (source) => {
    expect(transformAndMapShortcuts(source).transformed).toBe(source);
  });

  it("compiles each call independently, without leaking regexp positions", () => {
    const source = "Hierophant: ${name;b} has reached 1=10.\n* Keryx ✊";
    const first = transformAndMapShortcuts(source);
    transformAndMapShortcuts("Keryx: Greetings at 2=9.");
    const repeated = transformAndMapShortcuts(source);
    expect(repeated.transformed).toBe(first.transformed);
    expect(repeated.sourceMap.toString()).toBe(first.sourceMap.toString());
  });

  it("maps roles, variables, grades and surrounding Unicode text to the source", async () => {
    const source =
      "Hierophant: שלום ✊ ${candidateName;b}, enter 1=10 now.\n* Keryx closes.";
    const { transformed, sourceMap } = transformAndMapShortcuts(source);

    await SourceMapConsumer.with(sourceMap.toString(), null, (consumer) => {
      for (const text of ["candidateName", "1=10", "now.", "closes."]) {
        const generated = positionAt(transformed, transformed.indexOf(text));
        expect(consumer.originalPositionFor(generated)).toMatchObject({
          source: "source.pug",
          ...positionAt(source, source.indexOf(text)),
        });
      }
      expect(
        consumer.originalPositionFor(
          positionAt(transformed, transformed.indexOf("hierophant")),
        ),
      ).toMatchObject({ source: "source.pug", line: 1, column: 0 });
    });
  });

  it("maps a parser error back after shortcuts have inserted generated lines", async () => {
    const source = "Hierophant: Greetings ${name} at 1=10.\n  p one\n p bad";
    const { transformed, sourceMap } = transformAndMapShortcuts(source);
    let diagnostic: { code: string; line: number; column: number } | undefined;

    try {
      pugParse(pugLex(transformed), { src: transformed });
    } catch (error) {
      diagnostic = error as typeof diagnostic;
    }

    expect(diagnostic).toMatchObject({ code: "PUG:INCONSISTENT_INDENTATION" });
    if (!diagnostic) throw new Error("Expected a Pug indentation diagnostic");
    expect(diagnostic.line).toBeGreaterThan(3);
    const generated = {
      line: diagnostic.line,
      // Pug columns are one-based; source-map columns are zero-based.
      column: diagnostic.column - 1,
    };
    await SourceMapConsumer.with(sourceMap.toString(), null, (consumer) => {
      expect(consumer.originalPositionFor(generated)).toMatchObject({
        source: "source.pug",
        line: 3,
        column: 0,
      });
    });
  });
});
