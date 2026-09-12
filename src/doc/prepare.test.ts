import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepare } from "./prepare";

interface JrtNode {
  type?: string;
  children?: JrtNode[];
  name?: string;
  grade?: string;
  text?: string;
  value?: string;
}

function descendants(node: JrtNode): JrtNode[] {
  return [node, ...(node.children || []).flatMap(descendants)];
}

function nodesOfType(document: JrtNode, type: string) {
  return descendants(document).filter((node) => node.type === type);
}

describe("ritual source to JRT", () => {
  it("preserves speech/action roles and Unicode instructions", () => {
    expect(prepare("Hierophant,Keryx: שלום ✊\n* All-officers Rise")).toEqual({
      children: [
        {
          type: "task",
          say: true,
          role: "hierophant,keryx",
          children: [{ type: "text", value: "שלום ✊" }],
        },
        {
          type: "task",
          do: true,
          role: "all-officers",
          children: [{ type: "text", value: "Rise" }],
        },
      ],
    });
  });

  it("keeps declaration options and boolean attributes as document data", () => {
    expect(
      prepare(
        'declareVar(name="myRole", default="member", collapsable=false)\n' +
          '  option(value="member", selected) Member\n' +
          '  option(value="hierophant") Hierophant',
      ),
    ).toEqual({
      children: [
        {
          type: "declareVar",
          name: "myRole",
          default: "member",
          collapsable: false,
          children: [
            {
              type: "option",
              value: "member",
              selected: true,
              children: [{ type: "text", value: "Member" }],
            },
            {
              type: "option",
              value: "hierophant",
              children: [{ type: "text", value: "Hierophant" }],
            },
          ],
        },
      ],
    });
  });

  it("preserves nested reader constructs, links, images and text entities", () => {
    const document = prepare(
      'title(text="Opening")\n' +
        '  summary(summary="Explanation")\n' +
        "    note\n" +
        "      b A &amp; B — שלום 𐌀\n" +
        '      img(src="/api/file2?sha256=example")\n' +
        "      footnote\n" +
        '        a(href="https://example.com") Reference',
    );

    expect(document.children[0]).toMatchObject({
      type: "title",
      text: "Opening",
      children: [
        {
          type: "summary",
          summary: "Explanation",
          children: [
            {
              type: "note",
              children: [
                {
                  type: "b",
                  children: [{ type: "text", value: "A &amp; B — שלום 𐌀" }],
                },
                { type: "img", src: "/api/file2?sha256=example" },
                {
                  type: "footnote",
                  children: [{ type: "a", href: "https://example.com" }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("expands plain and bold variables together with multiple grade tokens", () => {
    const document = prepare(
      "Hierophant: ${candidateName}, welcome ${candidateMotto;b} from 0=0 to 1=10.",
    );
    expect(nodesOfType(document, "var").map((node) => node.name)).toEqual([
      "candidateName",
      "candidateMotto",
    ]);
    expect(nodesOfType(document, "b")).toEqual([
      {
        type: "b",
        children: [{ type: "var", name: "candidateMotto", children: [] }],
      },
    ]);
    expect(nodesOfType(document, "grade").map((node) => node.grade)).toEqual([
      "0=0",
      "1=10",
    ]);
    expect(nodesOfType(document, "text").at(-1)?.value).toBe(".");
  });

  it("keeps inline variables and grades within a nested text block", () => {
    const document = prepare("note\n  | Enter ${templeName} at 2=9.");
    const note = document.children[0];
    expect(note.type).toBe("note");
    expect(note.children).toContainEqual({
      type: "var",
      name: "templeName",
      children: [],
    });
    expect(note.children).toContainEqual({
      type: "grade",
      grade: "2=9",
      children: [],
    });
  });

  it("does not expand grade text inside double-quoted attributes", () => {
    const document = prepare('p(title="Grade 1=10") Grade 2=9');
    expect(document.children[0].title).toBe("Grade 1=10");
    expect(nodesOfType(document, "grade").map((node) => node.grade)).toEqual([
      "2=9",
    ]);
  });

  it("treats non-boolean attribute expressions as strings, without evaluation", () => {
    expect(
      prepare('p(count=2, enabled=false, visible=true, title="Opening")'),
    ).toEqual({
      children: [
        {
          type: "p",
          count: "2",
          enabled: false,
          visible: true,
          title: "Opening",
          children: [],
        },
      ],
    });
  });

  it("returns an empty root for an empty editor", () => {
    expect(prepare("")).toEqual({ children: [] });
  });

  it("rejects malformed Pug rather than returning a partial ritual", () => {
    expect(() => prepare('p(role="missing)')).toThrow(
      "no closing bracket ) found",
    );
  });

  it("currently rejects an unfinished action shortcut", () => {
    // Live editing must tolerate this compiler failure without saving the last
    // valid preview as if it represented the unfinished source.
    expect(() => prepare("*")).toThrow("Cannot overwrite a zero-length range");
  });

  it.each([
    ["0=0", "Opening of the Hall of the Neophytes", 411, 7],
    ["1=10", "Opening of the 1 = 10 Grade", 218, 21],
    ["2=9", "Opening of the 2 = 9 Grade", 214, 13],
  ])(
    "compiles the complete built-in %s ritual without losing tasks or grades",
    (name, opening, tasks, grades) => {
      const source = readFileSync(
        new URL(`./${name}.jade`, import.meta.url),
        "utf8",
      );
      const document = prepare(source);
      expect(nodesOfType(document, "title")[0].text).toBe(opening);
      expect(nodesOfType(document, "task")).toHaveLength(tasks);
      expect(nodesOfType(document, "grade")).toHaveLength(grades);
      expect(nodesOfType(document, "declareVar")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "myRole", default: "member" }),
        ]),
      );
    },
  );
});
