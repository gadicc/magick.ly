// @vitest-environment node
import { Node, Render } from "json-rich-text/lib/esm/index.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Published declarations require all arguments even though they are optional at runtime.
const getNode = (block: unknown) =>
  Node.getBlockNode(block, undefined, undefined, undefined);

const tree = () => ({
  type: "div",
  children: [
    { type: "p", children: [{ type: "text", value: "First" }] },
    { type: "p", children: [{ type: "text", value: "Second" }] },
  ],
});
const markup = (doc: unknown) =>
  renderToStaticMarkup(createElement(Render, { doc, onChange: undefined }));

describe("installed JRT node identity and mutations", () => {
  it("preserves live object identity and observes an in-place text edit", () => {
    const doc = tree(),
      root = getNode(doc),
      leaf = root.children[0].children[0];
    expect(getNode(doc)).toBe(root);
    expect(getNode(doc.children[0].children[0])).toBe(leaf);
    expect(getNode(structuredClone(doc))).not.toBe(root);
    leaf.block.value = "Changed";
    expect(getNode(leaf.block)).toBe(leaf);
    expect(markup(doc)).toBe(
      "<div><p><span>Changed</span></p><p><span>Second</span></p></div>",
    );
  });

  it("rekeys replaceWith and ancestors while delivering one exact Render callback", () => {
    const doc = tree(),
      updates: unknown[] = [];
    renderToStaticMarkup(
      createElement(Render, {
        doc,
        onChange: (next: unknown) => updates.push(next),
      }),
    );
    const root = getNode(doc),
      parent = root.children[0],
      leaf = parent.children[0];
    const oldLeaf = leaf.block,
      oldParent = parent.block;
    const replacement = { type: "text", value: "Replacement" };
    leaf.replaceWith(replacement);
    expect(getNode(replacement)).toBe(leaf);
    expect(getNode(oldLeaf)).not.toBe(leaf);
    expect(parent.block).not.toBe(oldParent);
    expect(root.block).not.toBe(doc);
    expect(getNode(parent.block)).toBe(parent);
    expect(getNode(root.block)).toBe(root);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(root.toJSON());
    expect(root.block.children[0].children[0]).toBe(replacement);
    expect(markup(root.block)).toBe(
      "<div><p><span>Replacement</span></p><p><span>Second</span></p></div>",
    );
  });

  it("keeps a moved node and its parent links through detach and appendTo", () => {
    const root = getNode(tree()),
      first = root.children[0],
      second = root.children[1];
    const leaf = first.children[0];
    expect(first.next()).toBe(second);
    expect(second.prev()).toBe(first);
    expect(leaf.detach()).toBe(leaf);
    expect(leaf.parent).toBe(null);
    leaf.appendTo(second);
    expect(leaf.parent).toBe(second);
    expect(second.children.at(-1)).toBe(leaf);
    expect(getNode(leaf.block)).toBe(leaf);
    expect(getNode(root.block)).toBe(root);
    expect(root.block.children[0].children).toEqual([]);
    expect(root.block.children[1].children[1]).toBe(leaf.block);
    expect(markup(root.block)).toBe(
      "<div><p></p><p><span>Second</span><span>First</span></p></div>",
    );
  });

  it("supports frozen and null-prototype blocks without attaching cache fields", () => {
    const frozen = Object.freeze({ type: "text", value: "Frozen" });
    const plain = Object.assign(Object.create(null), {
      type: "text",
      value: "Plain",
    });
    for (const block of [frozen, plain]) {
      const before = Reflect.ownKeys(block),
        node = getNode(block);
      expect(getNode(block)).toBe(node);
      expect(markup(block)).toBe(`<span>${block.value}</span>`);
      expect(Reflect.ownKeys(block)).toEqual(before);
    }
  });

  it("uses registered classes for new nodes and retains live nodes for unchanged registration", () => {
    const type = "magickli-cache-registration-regression";
    class Registered extends Node {
      render() {
        return "Registered";
      }
    }
    class Replacement extends Node {
      render() {
        return "Replacement";
      }
    }
    Node.registerBlockType(type, Registered);
    const block = { type },
      node = getNode(block);
    expect(node).toBeInstanceOf(Registered);
    Node.registerBlocks({ [type]: Registered });
    expect(getNode(block)).toBe(node);
    Node.registerBlockType(type, Replacement);
    expect(getNode({ type })).toBeInstanceOf(Replacement);
    // Browser FastRefresh reclassification is exercised separately; this is the Node contract.
  });
});
