import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  inventoryRitualAssetJson as fromJson,
  inventoryRitualAssets as inventory,
  RITUAL_ASSET_INVENTORY_LIMITS as limits,
} from "./ritualAssetInventory";

const options = {
  knownAppOrigins: ["https://magick.ly"],
  staticPaths: ["/pics/synthetic.svg", "/pics/other.png"],
};
const img = (src = "/pics/synthetic.svg", extra = {}) => ({
  type: "img",
  src,
  ...extra,
});
const node = (children: unknown[] = [], extra = {}) => ({ children, ...extra });
const task = (children: unknown[], extra = {}) =>
  node(children, { type: "task", role: "all", say: true, ...extra });
const good = (tree: unknown) => {
  const result = inventory(tree, options);
  expect(result.issues).toEqual([]);
  expect(result.enumerationComplete).toBe(true);
  return result;
};
const codes = (
  tree: unknown,
  settings: Parameters<typeof inventory>[1] = options,
) => inventory(tree, settings).issues.map((i) => i.code);

describe("ritual asset occurrence identity", () => {
  it("preserves exact src, query order/repetition/encoding and display fragments separately", () => {
    const refs = [
      "/pics/synthetic.svg?a=1&b=2&a=3#viewBox(0,0,12,8)",
      "/pics/synthetic.svg?b=2&a=1&a=3#different",
      "https://magick.ly/pics/synthetic.svg?text=a%20b&text=a+b#%23raw",
      "/pics/synthetic.svg#",
    ];
    const result = good(node(refs.map((src) => img(src))));
    expect(result.profile).toBe("magickli-jrt-assets-v2");
    expect(result.occurrences.map((o) => o.src)).toEqual(refs);
    expect(result.occurrences.map((o) => o.path)).toEqual([[0], [1], [2], [3]]);
    expect(result.occurrences[0]).toMatchObject({
      networkReference: refs[0].split("#")[0],
      displayFragment: "#viewBox(0,0,12,8)",
      reference: { kind: "local-static", pathname: "/pics/synthetic.svg" },
    });
    expect(result.occurrences[2].networkReference).toBe(
      "https://magick.ly/pics/synthetic.svg?text=a%20b&text=a+b",
    );
    expect(result.occurrences[3].displayFragment).toBe("#");
  });
  it("keeps repeated occurrences separate and never mutates or reserializes the input", () => {
    const tree = node(
      [
        img(),
        node([img()]),
        { type: "text", value: "literal src text", children: [] },
      ],
      {
        metadata: { src: "private-unused", children: [img("private-unused")] },
      },
    );
    const raw = JSON.stringify(tree),
      hash = createHash("sha256").update(raw).digest("hex");
    const first = good(tree);
    expect(first.occurrences.map((o) => o.path)).toEqual([[0], [1, 0]]);
    expect(JSON.stringify(tree)).toBe(raw);
    expect(
      createHash("sha256").update(JSON.stringify(tree)).digest("hex"),
    ).toBe(hash);
    first.occurrences[0].path.push(99);
    first.occurrences[0].src = "changed output";
    expect(good(tree).occurrences[0]).toMatchObject({
      path: [0],
      src: "/pics/synthetic.svg",
    });
  });
  it("classifies only explicit origins and static catalog paths", () => {
    const result = good(
      node([
        img("https://other.example/pics/synthetic.svg"),
        img("https://magick.ly/pics/synthetic.svg"),
        img("/pics/other.png"),
        img("http://magick.ly/pics/synthetic.svg"),
      ]),
    );
    expect(result.occurrences.map((o) => o.reference.kind)).toEqual([
      "external",
      "local-static",
      "local-static",
      "external",
    ]);
    expect(
      inventory(node([img("/pics/unlisted.svg")]), options).occurrences[0]
        .reference,
    ).toEqual({ kind: "unresolved", reason: "unrecognized-local-reference" });
  });
  it("recognizes only strict legacy image-body queries without changing spelling", () => {
    const digest = "a".repeat(64),
      src = "/api/file2?%73ha256=" + digest + "#svgView(viewBox(1,2,3,4))";
    expect(good(node([img(src)])).occurrences[0]).toMatchObject({
      src,
      networkReference: src.split("#")[0],
      reference: { kind: "legacy-file2", sha256: digest },
    });
    for (const query of [
      "sha256=" + digest + "&return=meta",
      "return=raw&sha256=" + digest,
      "sha256=" + digest + "&sha256=" + digest,
      "sha256=" + digest + "&unknown=1",
      "sha256=" + digest.toUpperCase(),
    ])
      expect(codes(node([img("/api/file2?" + query)]))).toContain(
        "unsupported-legacy-file-query",
      );
  });
  it("classifies generated, inline and external images without claiming resolved bytes", () => {
    const generated =
      "/api/treeOfLife?field=name.roman&topText=a&topText=b&fmt=svg#node";
    const refs = [
      generated,
      "data:image/gif;base64,R0lGODlhAQABAIAAAA==",
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'> </svg>",
      "https://external.example/x.png?q=2#icon",
    ];
    const result = good(node(refs.map((src) => img(src))));
    expect(result.occurrences.map((o) => o.reference.kind)).toEqual([
      "generated-tree-of-life",
      "inline-image",
      "inline-image",
      "external",
    ]);
    expect(result).not.toHaveProperty("ready");
    expect(result).not.toHaveProperty("bundleId");
    expect(result.occurrences[0].networkReference).toBe(
      generated.split("#")[0],
    );
  });
  it("recognizes only the two local generated routes and retains their exact URL identities", () => {
    const refs = [
      "/api/treeOfLife?field=name.roman&fmt=svg#legacy",
      "/api/render/tree-of-life?fmt=svg&field=name%2Eroman#canonical",
      "https://magick.ly/api/render/tree-of-life?field=name.roman#%23raw",
    ];
    const tree = node(refs.map((src) => img(src))),
      original = JSON.stringify(tree),
      result = good(tree);
    expect(result.occurrences.map((row) => row.reference.kind)).toEqual(
      Array(3).fill("generated-tree-of-life"),
    );
    expect(result.occurrences.map((row) => row.src)).toEqual(refs);
    expect(result.occurrences.map((row) => row.networkReference)).toEqual(
      refs.map((ref) => ref.split("#")[0]),
    );
    expect(result.occurrences.map((row) => row.displayFragment)).toEqual([
      "#legacy",
      "#canonical",
      "#%23raw",
    ]);
    expect(JSON.stringify(tree)).toBe(original);
    for (const reference of [
      "/api/render/tree-of-life/",
      "/api/render/TreeOfLife",
      "/api/render/rose-sigil",
      "/api/render/../render/tree-of-life",
      "/api/render/tree%2Dof%2Dlife",
    ])
      expect(
        inventory(node([img(reference)]), options).occurrences[0].reference
          .kind,
      ).toBe("unresolved");
    expect(
      good(node([img("https://other.example/api/render/tree-of-life")]))
        .occurrences[0].reference.kind,
    ).toBe("external");
  });
  it.each([
    "/api/files/future-id",
    "blob:https://magick.ly/temporary",
    "javascript:alert(1)",
    "relative.svg",
    "//other.example/x.png",
    "/pics/../pics/synthetic.svg",
    "https://magick.ly/a/../pics/synthetic.svg",
  ])("leaves unsupported reference %s unresolved", (src) =>
    expect(
      inventory(node([img(src)]), options).occurrences[0].reference.kind,
    ).toBe("unresolved"),
  );
  it.each([
    "",
    " /pics/synthetic.svg",
    "https://bad\\host/pics/synthetic.svg",
    "https://user:password@other.example/x.png",
    "https://[invalid/x",
    "data:text/html,<h1>no</h1>",
    "data:image/png,",
    "/pics/\u0000bad.svg",
    "/pics/\ud800bad.svg",
  ])("rejects invalid reference %# safely", (src) =>
    expect(
      inventory(node([img(src)]), options).occurrences[0].reference.kind,
    ).toBe("invalid"),
  );
});

describe("actual child reachability", () => {
  it.each(["declareVar", "img", "grade", "br", "hr", "text", "var"])(
    "does not grant child occurrences under %s",
    (type) => {
      const parent = {
        type,
        src: "/pics/other.png",
        children: [img()],
        grade: "0=0",
        value: "text",
      };
      const result = good(node([parent]));
      expect(result.occurrences.map((o) => o.path)).toEqual(
        type === "img" ? [[0]] : [],
      );
    },
  );
  it("ignores metadata strings and hyperlink destinations", () => {
    const tree = node(
      [
        {
          type: "a",
          href: "https://external.example/destination",
          children: [img()],
        },
        { type: "text", value: "<img src='ignored'>" },
      ],
      { nested: { src: "/api/files/private", children: [img()] } },
    );
    expect(good(tree).occurrences.map((o) => o.path)).toEqual([[0, 0]]);
  });
  it("includes collapsed and other-role branches but suppresses tasks without say/do", () => {
    const tree = node([
      node([img()], { type: "summary", summary: "collapsed" }),
      task([img()], { role: "other-role", forMe: false }),
      task([img()], { say: false, do: false }),
    ]);
    expect(good(tree).occurrences.map((o) => o.path)).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
  it("collects automatic task footnotes and explicit later hosts, excluding host children", () => {
    const tree = node([
      task([node([img()], { type: "footnote" })]),
      node(
        [
          node([img("/pics/other.png")], { type: "footnote" }),
          node([img("hidden")], { type: "footnotes" }),
        ],
        { type: "note" },
      ),
    ]);
    expect(good(tree).occurrences.map((o) => o.path)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });
  it("does not manufacture a grant from missing, already-rendered or nested footnote hosts", () => {
    for (const tree of [
      node([node([img()], { type: "footnote" })]),
      node([
        node([], { type: "footnotes" }),
        node([img()], { type: "footnote" }),
      ]),
      task([node([node([img()], { type: "footnote" })], { type: "footnote" })]),
    ]) {
      const result = inventory(tree, options);
      expect(result.enumerationComplete).toBe(false);
      expect(result.occurrences).toEqual([]);
      expect(
        result.issues.some((i) => i.code === "unresolved-footnote-host"),
      ).toBe(true);
    }
  });
  it("flags stylesheets, resource styles, unknown resource attributes and editor nodes", () => {
    const tree = node([
      node([img("ignored")], { type: "stylesheet", href: "/x.css" }),
      img(undefined, { style: '{"backgroundImage":"url(/hidden.png)"}' }),
      node([img()], {
        type: "span",
        dangerouslySetInnerHTML: { __html: "<img src='hidden'>" },
      }),
      node([img()], { type: "audio", src: "/x.mp3" }),
      node([], { type: "cursor" }),
    ]);
    expect(codes(tree)).toEqual([
      "unsupported-stylesheet",
      "unsupported-style",
      "unsupported-span-attribute",
      "unsupported-render-reference",
      "unsupported-editor-cursor",
    ]);
  });
  it("uses actual inline style grammars and rejects unreviewed CSS", () => {
    expect(
      good(
        node([
          img(undefined, { style: '{"height":"1em"}' }),
          node([], {
            type: "span",
            style: '{fontStyle:"italic"}',
            "aria-label": "safe",
            "data-note": "safe",
          }),
        ]),
      ).occurrences,
    ).toHaveLength(1);
    for (const style of [
      '{"color":"var(--unknown)"}',
      '{"backgroundImage":"u\\\\72l(x)"}',
      "{bad",
      { width: 3 },
      '{"padding":["1em"]}',
    ])
      expect(
        inventory(node([img(undefined, { style })]), options)
          .enumerationComplete,
      ).toBe(false);
  });
  it("follows fallback Node children but flags unimplemented image resource attributes", () => {
    expect(
      good(node([node([img()], { type: "unknown-wrapper" })])).occurrences[0]
        .path,
    ).toEqual([0, 0]);
    expect(
      codes(node([img(undefined, { srcSet: "/other.png 2x" })])),
    ).toContain("unsupported-render-reference");
  });
});

describe("bounded parsing and fail-closed structures", () => {
  it("parses exact JSON and rejects malformed or oversized snapshots", () => {
    const text = JSON.stringify(node([img()]));
    expect(fromJson(text, options)).toEqual(good(JSON.parse(text)));
    expect(fromJson("{broken", options).enumerationComplete).toBe(false);
    expect(
      fromJson(text, { ...options, limits: { jsonBytes: 5 } })
        .enumerationComplete,
    ).toBe(false);
    expect(fromJson(1, options).enumerationComplete).toBe(false);
  });
  it("rejects child cycles before returning eligible occurrences, including under suppressed nodes", () => {
    const tree = node([img()]);
    tree.children.push(tree);
    const result = inventory(tree, options);
    expect(result.occurrences).toEqual([]);
    expect(result.issues[0].code).toBe("child-cycle");
    const hidden: { type: string; children: unknown[] } = {
      type: "declareVar",
      children: [],
    };
    hidden.children.push(hidden);
    expect(codes(node([hidden]))).toContain("child-cycle");
  });
  it.each([
    null,
    [],
    1,
    { children: null },
    { children: [null] },
    { children: new Array(1) },
    { children: [], type: 1 },
    { type: "" },
  ])("rejects malformed node/children %#", (tree) =>
    expect(inventory(tree, options).enumerationComplete).toBe(false),
  );
  it("does not execute accessors or use inherited fields", () => {
    const getter = vi.fn(() => [img()]);
    const tree = Object.defineProperty({}, "children", {
      enumerable: true,
      get: getter,
    });
    expect(inventory(tree, options).enumerationComplete).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(
      inventory(Object.create({ children: [img()] }), options)
        .enumerationComplete,
    ).toBe(false);
  });
  it("reports node, depth, occurrence, reference and style bounds", () => {
    expect(
      codes(node([img(), img()]), { ...options, limits: { nodes: 2 } }),
    ).toContain("tree-limit");
    expect(
      codes(node([node([img()])]), { ...options, limits: { depth: 1 } }),
    ).toContain("tree-limit");
    expect(
      codes(node([img(), img()]), { ...options, limits: { occurrences: 1 } }),
    ).toContain("occurrence-limit");
    expect(
      codes(node([img()]), { ...options, limits: { referenceBytes: 5 } }),
    ).toContain("reference-limit");
    expect(
      codes(node([img(undefined, { style: '{"width":12}' })]), {
        ...options,
        limits: { styleBytes: 3 },
      }),
    ).toContain("unsupported-style");
  });
  it.each([
    { knownAppOrigins: ["http://magick.ly"] },
    { knownAppOrigins: ["https://magick.ly/path"] },
    { staticPaths: ["/a/../b"] },
    { staticPaths: ["//example.test/a"] },
    { staticPaths: ["/pics/a.svg?x=1"] },
    { limits: { nodes: limits.nodes + 1 } },
    { limits: { depth: 0 } },
    { limits: { unknown: 3 } },
  ])("rejects invalid configuration %#", (extra) =>
    expect(
      inventory(node(), { ...options, ...extra } as never).enumerationComplete,
    ).toBe(false),
  );
  it("reports missing image src and malformed task safely", () => {
    expect(codes(node([{ type: "img" }]))).toContain("missing-image-src");
    expect(codes(node([{ type: "task", say: true }]))).toContain(
      "malformed-task",
    );
  });
});

it("rejects shared child objects because JRT caches the first parent for an object identity", () => {
  const shared = img();
  const result = inventory(node([shared, node([shared])]), options);
  expect(result.enumerationComplete).toBe(false);
  expect(result.occurrences).toEqual([]);
  expect(result.issues[0].code).toBe("shared-child-node");
});
it.each(["constructor", "__proto__", "toString"])(
  "rejects inherited JRT registry name %s",
  (type) => {
    expect(codes(node([node([img()], { type })]))).toContain("malformed-type");
  },
);
it("rejects malformed renderer values and span styles", () => {
  for (const block of [
    { type: "title", children: [img()] },
    { type: "grade", grade: null },
    { type: "text", value: { src: "not rendered" } },
    { type: "span", style: "" },
    { type: "span", style: false },
  ])
    expect(inventory(node([block]), options).enumerationComplete).toBe(false);
});
it("checks the full reference including malformed fragments", () => {
  for (const src of ["/pics/synthetic.svg#\0", "/pics/synthetic.svg#\ud800"])
    expect(codes(node([img(src)]))).toContain("invalid-reference");
});
it("caps issue output and does not allow maximum limits to be changed", () => {
  const result = inventory(
    node([
      { type: "stylesheet" },
      { type: "stylesheet" },
      { type: "stylesheet" },
    ]),
    { ...options, limits: { issues: 2 } },
  );
  expect(result.issues).toHaveLength(2);
  expect(result.issues[1].code).toBe("issue-limit");
  expect(result.enumerationComplete).toBe(false);
  expect(Object.isFrozen(limits)).toBe(true);
});
it("rejects child accessors without evaluating them", () => {
  const getter = vi.fn(() => img()),
    children: unknown[] = [];
  Object.defineProperty(children, "0", { enumerable: true, get: getter });
  expect(codes({ children })).toContain("malformed-children");
  expect(getter).not.toHaveBeenCalled();
});

it("returns one source occurrence per child path when say and do both render that child", () => {
  const tree = task(
    [img(), node([img("/pics/other.png")], { type: "footnote" })],
    { say: true, do: true },
  );
  const result = good(tree);
  expect(result.occurrences.map((o) => o.path)).toEqual([[0], [1, 0]]);
  expect(result.occurrences.map((o) => o.src)).toEqual([
    "/pics/synthetic.svg",
    "/pics/other.png",
  ]);
});
