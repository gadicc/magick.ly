import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setImmediate as yieldTask } from "node:timers/promises";
import sharp, { type Sharp } from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRitualSvgValidator,
  RITUAL_SVG_LIMITS,
  RITUAL_SVG_PROFILE,
  type RitualSvgCode,
} from "./validateRitualSvg";

const enc = new TextEncoder();
const svg = (body = "", attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
const validate = (text: string, limits = {}) =>
  createRitualSvgValidator(limits).validate(
    enc.encode(text),
    new AbortController().signal,
  );
const refused = async (text: string, code: RitualSvgCode) =>
  expect(await validate(text)).toMatchObject({ code });
const image = (bytes: Buffer, type = "image/png") =>
  `<image width="2" height="2" href="data:${type};base64,${bytes.toString("base64")}"/>`;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SVG compatibility bytes and actual corpus", () => {
  it("retains BOM, CRLF, comments, XML escapes, CDATA and original Unicode bytes", async () => {
    const source = enc.encode(
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r\n' +
        svg(
          '<title>ä &amp; &#x5D0;</title><!--keep--><desc><![CDATA[<literal>]]></desc><path d="M0 0L1 1"/>',
        ),
    );
    const snapshot = new Uint8Array(source);
    const pending = createRitualSvgValidator().validate(
      source,
      new AbortController().signal,
    );
    source.fill(0);
    const result = await pending;
    expect(result.status).toBe("validated");
    if (result.status !== "validated") throw Error("expected validation");
    expect(result.bytes).toEqual(snapshot);
    expect(result.bytes).not.toBe(source);
    expect(result.sha256).toBe(
      createHash("sha256").update(snapshot).digest("hex"),
    );
    expect(result.profile).toBe(RITUAL_SVG_PROFILE);
    expect(result.embeddedRasters).toEqual([]);
    expect(result.byteSize).toBe(snapshot.byteLength);
  });
  for (const name of [
    "candidate-hexagram",
    "neophyte",
    "theoricus1",
    "theoricus2",
    "zelator1",
    "zelator2",
  ]) {
    it(`validates exact existing ${name}.svg with fully decoded embedded PNGs`, async () => {
      const bytes = await readFile(`${process.cwd()}/public/pics/${name}.svg`);
      const before = Buffer.from(bytes);
      const result = await createRitualSvgValidator().validate(
        bytes,
        new AbortController().signal,
      );
      expect(
        result,
        result.status === "validated" ? undefined : JSON.stringify(result),
      ).toMatchObject({ status: "validated" });
      if (result.status !== "validated") throw Error("expected validation");
      expect(result.bytes).toEqual(new Uint8Array(before));
      expect(bytes).toEqual(before);
      expect(result.embeddedRasters).toHaveLength(
        name === "theoricus1" ? 1 : name === "theoricus2" ? 3 : 0,
      );
      for (const embedded of result.embeddedRasters) {
        expect(embedded.contentType).toBe("image/png");
        expect(embedded.decodedPixels).toBeGreaterThan(0);
      }
      expect(
        await readFile(`${process.cwd()}/public/pics/${name}.svg`),
      ).toEqual(before);
    });
  }
  it("supports namespace-equivalent prefixes without depending on a particular xmlns prefix", async () => {
    expect(
      await validate(
        '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:path d="M0 0"/></s:svg>',
      ),
    ).toMatchObject({ status: "validated" });
  });
  it("fully decodes percent-byte embedded PNGs and base64 with XML whitespace normalization", async () => {
    const png = await sharp({
      create: { width: 2, height: 3, channels: 4, background: "#ff8800" },
    })
      .png()
      .toBuffer();
    const percent = [...png]
      .map((b) => "%" + b.toString(16).padStart(2, "0"))
      .join("");
    const b64 = png
      .toString("base64")
      .match(/.{1,12}/g)!
      .join("\n ");
    const result = await validate(
      svg(
        `<image href="data:image/png,${percent}"/><image xlink:href="DATA:IMAGE/PNG;BASE64,${b64}"/>`,
      ),
    );
    expect(
      result,
      result.status === "validated" ? undefined : JSON.stringify(result),
    ).toMatchObject({ status: "validated" });
    if (result.status === "validated")
      expect(result.embeddedRasters).toEqual(
        [0, 1].map(() =>
          expect.objectContaining({
            byteSize: png.byteLength,
            width: 2,
            frameHeight: 3,
            decodedPixels: 6,
            frames: 1,
          }),
        ),
      );
  });
});

describe("XML and namespace refusals", () => {
  for (const [name, text, code] of [
    ["empty", "", "INVALID_SVG"],
    ["whitespace", "  \n ", "INVALID_SVG"],
    ["empty XML", '<?xml version="1.0"?>', "INVALID_SVG"],
    ["nested style element", svg("<style><g/></style>"), "UNSUPPORTED_ELEMENT"],
    ["wrong root", "<xml/>", "INVALID_SVG"],
    ["unclosed", svg().slice(0, -6), "INVALID_SVG"],
    ["unbound prefix", "<svg:svg/>", "INVALID_SVG"],
    ["duplicate attribute", svg("", 'id="a" id="b"'), "INVALID_SVG"],
    ["doctype", "<!DOCTYPE svg>" + svg(), "ACTIVE_CONTENT"],
    [
      "entity declaration",
      '<!DOCTYPE svg [<!ENTITY x "boom">]>' + svg("<text>&x;</text>"),
      "ACTIVE_CONTENT",
    ],
    ["unknown entity", svg("<text>&unknown;</text>"), "INVALID_SVG"],
    [
      "stylesheet PI",
      '<?xml-stylesheet href="https://untrusted.invalid/a.css"?>' + svg(),
      "ACTIVE_CONTENT",
    ],
    ["XML1.1", '<?xml version="1.1"?>' + svg(), "UNSUPPORTED_XML"],
    [
      "encoding",
      '<?xml version="1.0" encoding="ISO-8859-1"?>' + svg(),
      "UNSUPPORTED_XML",
    ],
    ["script", svg("<script/>"), "ACTIVE_CONTENT"],
    ["foreignObject", svg("<foreignObject/>"), "ACTIVE_CONTENT"],
    ["animate", svg('<animate attributeName="href"/>'), "ACTIVE_CONTENT"],
    ["event", svg('<path onclick="private sentinel"/>'), "ACTIVE_CONTENT"],
    [
      "namespace event",
      svg('<path xmlns:x="urn:unknown" x:onload="private sentinel"/>'),
      "ACTIVE_CONTENT",
    ],
    [
      "xml base",
      svg('<g xml:base="https://untrusted.invalid/"/>'),
      "ACTIVE_CONTENT",
    ],
    ["unknown element", svg("<meshgradient/>"), "UNSUPPORTED_ELEMENT"],
    [
      "unknown namespace",
      svg('<g xmlns="urn:unknown"/>'),
      "UNSUPPORTED_ELEMENT",
    ],
    [
      "unknown attribute",
      svg('<path src="https://untrusted.invalid/x"/>'),
      "UNSUPPORTED_ATTRIBUTE",
    ],
    [
      "unknown namespaced attr",
      svg('<path xmlns:z="urn:unknown" z:href="#x"/>'),
      "UNSUPPORTED_ATTRIBUTE",
    ],
    [
      "wrong xml space",
      svg('<text xml:space="other"/>'),
      "UNSUPPORTED_ATTRIBUTE",
    ],
    [
      "nested editor view",
      svg(
        '<g xmlns:s="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><s:namedview/></g>',
      ),
      "UNSUPPORTED_ELEMENT",
    ],
    [
      "editor child",
      svg(
        '<s:namedview xmlns:s="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><path/></s:namedview>',
      ),
      "UNSUPPORTED_ELEMENT",
    ],
    [
      "unexpected editor attr",
      svg(
        '<s:namedview xmlns:s="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" src="x"/>',
      ),
      "UNSUPPORTED_ATTRIBUTE",
    ],
    [
      "conflicting href",
      svg(
        '<defs><path id="a"/><path id="b"/></defs><use href="#a" xlink:href="#b"/>',
      ),
      "UNSUPPORTED_ATTRIBUTE",
    ],
    ["href on nonresource", svg('<path href="#a"/>'), "UNSUPPORTED_ATTRIBUTE"],
  ] as const)
    it(`refuses ${name} without leaking parser/source details`, async () => {
      const result = await validate(text);
      expect(result).toMatchObject({ code });
      expect(JSON.stringify(result)).not.toContain("private sentinel");
      expect(Object.keys(result).sort()).toEqual(["code", "status"]);
    });
  it("refuses invalid UTF8 and non-byte runtime input", async () => {
    const v = createRitualSvgValidator();
    expect(
      await v.validate(new Uint8Array([255]), new AbortController().signal),
    ).toMatchObject({ code: "INVALID_SVG" });
    expect(
      await v.validate(
        null as unknown as Uint8Array,
        new AbortController().signal,
      ),
    ).toMatchObject({ code: "INVALID_SVG" });
  });
});

describe("CSS and complete local reference graph", () => {
  for (const [name, text, code] of [
    ["raw parse fallback", svg('<path style="fill:???"/>'), "INVALID_CSS"],
    [
      "unsupported property",
      svg('<path style="background-image:url(https://untrusted.invalid/x)"/>'),
      "UNSUPPORTED_CSS",
    ],
    ["empty value", svg('<path style="fill:"/>'), "INVALID_CSS"],
    ["wrong grammar", svg('<path style="fill:red junk"/>'), "INVALID_CSS"],
    [
      "escaped function",
      svg('<path style="fill:u\\72l(&quot;#x&quot;)"/>'),
      "UNSUPPORTED_CSS",
    ],
    ["variables", svg('<path style="fill:var(--paint)"/>'), "UNSUPPORTED_CSS"],
    ["custom property", svg('<path style="--paint:red"/>'), "UNSUPPORTED_CSS"],
    [
      "URL in nonresource property",
      svg('<path style="font-family:url(#x)"/>'),
      "UNSUPPORTED_CSS",
    ],
    [
      "import",
      svg('<style>@import "https://untrusted.invalid/x";</style>'),
      "UNSUPPORTED_CSS",
    ],
    [
      "font face",
      svg(
        "<style>@font-face{font-family:x;src:url(https://untrusted.invalid/font)}</style>",
      ),
      "UNSUPPORTED_CSS",
    ],
    [
      "wrong style MIME",
      svg('<style type="text/plain">.x{fill:red}</style>'),
      "UNSUPPORTED_CSS",
    ],
    [
      "unsupported pseudo",
      svg("<style>path:hover{fill:red}</style>"),
      "UNSUPPORTED_CSS",
    ],
    [
      "unsupported combinator",
      svg("<style>g path{fill:red}</style>"),
      "UNSUPPORTED_CSS",
    ],
    [
      "unsupported selector",
      svg("<style>[href]{fill:red}</style>"),
      "UNSUPPORTED_CSS",
    ],
    [
      "unknown CSS at-rule in style",
      svg('<path style="@import url(x)"/>'),
      "UNSUPPORTED_CSS",
    ],
    [
      "external CSS URL",
      svg('<path style="fill:url(https://untrusted.invalid/x)"/>'),
      "EXTERNAL_RESOURCE",
    ],
    [
      "script URI encoded by XML",
      svg('<use href="&#x6a;avascript:private-sentinel"/>'),
      "EXTERNAL_RESOURCE",
    ],
    [
      "percent fragment",
      svg('<use href="#bad%20id"/>'),
      "INVALID_FRAGMENT_TARGET",
    ],
    ["duplicate id", svg('<path id="a"/><path id="a"/>'), "DUPLICATE_ID"],
    ["invalid ID", svg('<path id="bad id"/>'), "INVALID_FRAGMENT_TARGET"],
    ["missing target", svg('<use href="#missing"/>'), "MISSING_FRAGMENT"],
    [
      "wrong target",
      svg('<path id="x"/><path fill="url(#x)"/>'),
      "INVALID_FRAGMENT_TARGET",
    ],
    [
      "inherited pattern cycle",
      svg(
        '<g fill="url(#p)"><defs><pattern id="p"><path/></pattern></defs><path/></g>',
      ),
      "REFERENCE_CYCLE",
    ],
    [
      "use shadow inherited cycle",
      svg(
        '<defs><pattern id="p"><use href="#shape" fill="url(#p)"/></pattern><g id="shape"><path/></g></defs>',
      ),
      "REFERENCE_CYCLE",
    ],
    ["self cycle", svg('<use id="x" href="#x"/>'), "REFERENCE_CYCLE"],
    [
      "ancestor cycle",
      svg('<g id="x"><use href="#x"/></g>'),
      "REFERENCE_CYCLE",
    ],
    [
      "gradient cycle",
      svg(
        '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
      ),
      "REFERENCE_CYCLE",
    ],
    [
      "unused CSS missing target",
      svg("<style>.unused{fill:url(#missing)}</style>"),
      "MISSING_FRAGMENT",
    ],
  ] as const)
    it(`rejects ${name}`, async () => {
      await refused(text, code);
    });
  it("matches static compound/list selectors and preserves paint fallback and escaped fragments", async () => {
    const result = await validate(
      svg(
        '<defs><linearGradient id="paint"><stop offset="0" style="stop-color:rgb(1,2,3)"/></linearGradient><path id="shape" d="M0 0"/></defs><style>path.a#x,.b{fill:url("\\23 paint") red} g{opacity:0.5}</style><g><path id="x" class="a c"/><use href="#shape" xlink:href="#shape"/></g>',
      ),
    );
    expect(result).toMatchObject({ status: "validated", localReferences: 2 });
  });
  it("detects cycles introduced by matched CSS and acyclic exponential use expansion", async () => {
    expect(
      await validate(
        svg(
          '<defs><pattern id="p"><path class="a"/></pattern></defs><style>.a{fill:url(#p)}</style>',
        ),
      ),
    ).toMatchObject({ code: "REFERENCE_CYCLE" });
    const chain = Array.from(
      { length: 18 },
      (_, i) =>
        `<g id="n${i}">${i ? `<use href="#n${i - 1}"/><use href="#n${i - 1}"/>` : "<path/>"}</g>`,
    ).join("");
    expect(
      await validate(svg("<defs>" + chain + '</defs><use href="#n17"/>')),
    ).toMatchObject({ code: "LIMIT" });
  });
});

describe("limits, embedded rasters, cancellation and isolation", () => {
  for (const [name, xml, limits] of [
    ["bytes", svg(), { bytes: 8 }],
    ["elements", svg("<g/>"), { elements: 1 }],
    ["depth", svg("<g/>"), { depth: 1 }],
    ["attributes", svg('<path x="1" y="2"/>'), { attributes: 1 }],
    [
      "per element attributes",
      svg('<rect x="1" y="2"/>'),
      { attributesPerElement: 1 },
    ],
    [
      "text",
      svg("<title>" + "a".repeat(200) + "</title>"),
      { textCharacters: 100 },
    ],
    ["attribute chars", svg("", 'id="long-id"'), { textCharacters: 3 }],
    ["CSS block", svg('<path style="fill:red"/>'), { cssBlockBytes: 3 }],
    [
      "CSS total",
      svg('<path style="fill:red"/><path style="fill:red"/>'),
      { cssBytes: 12 },
    ],
    [
      "references",
      svg('<defs><path id="a"/></defs><use href="#a"/><use href="#a"/>'),
      { references: 1 },
    ],
    [
      "applied CSS references",
      svg(
        '<defs><linearGradient id="p"/></defs><style>.a{fill:url(#p)}</style><path class="a"/><path class="a"/>',
      ),
      { references: 2 },
    ],
    [
      "expanded elements",
      svg("<g><path/><path/></g>"),
      { expandedElements: 2 },
    ],
  ] as const)
    it(`bounds ${name}`, async () =>
      expect(await validate(xml, limits)).toMatchObject({ code: "LIMIT" }));
  it("rejects expanded, noninteger and unknown limits without exposing caller values", () => {
    for (const value of [
      -1,
      0,
      1.5,
      NaN,
      Infinity,
      RITUAL_SVG_LIMITS.bytes + 1,
    ])
      expect(() => createRitualSvgValidator({ bytes: value })).toThrow(
        "Invalid SVG validation limits",
      );
    expect(() => createRitualSvgValidator({ unknown: 1 } as never)).toThrow(
      "Invalid SVG validation limits",
    );
  });
  it("handles real embedded image limits, declaration mismatch, malformed data, and unsupported nested SVG", async () => {
    const png = await sharp({
      create: { width: 3, height: 2, channels: 4, background: "#f00" },
    })
      .png()
      .toBuffer();
    expect(
      await validate(svg(image(png)), { embeddedPixels: 5 }),
    ).toMatchObject({ code: "LIMIT" });
    expect(
      await validate(svg(image(png)), { embeddedBytes: png.byteLength - 1 }),
    ).toMatchObject({ code: "LIMIT" });
    expect(
      await validate(svg(image(png) + image(png)), { embeddedImages: 1 }),
    ).toMatchObject({ code: "LIMIT" });
    expect(
      await validate(svg(image(png) + image(png)), {
        embeddedBytes: png.byteLength,
      }),
    ).toMatchObject({ code: "LIMIT" });
    expect(
      await validate(svg(image(png) + image(png)), { embeddedPixels: 6 }),
    ).toMatchObject({ code: "LIMIT" });
    expect(await validate(svg(image(png, "image/jpeg")))).toMatchObject({
      code: "INVALID_EMBEDDED_IMAGE",
    });
    expect(
      await validate(svg(image(png.subarray(0, png.length - 16)))),
    ).toMatchObject({ code: "INVALID_EMBEDDED_IMAGE" });
    expect(
      await validate(svg('<image href="data:image/png;base64,%%%"/>')),
    ).toMatchObject({ code: "INVALID_EMBEDDED_IMAGE" });
    expect(
      await validate(svg(image(Buffer.from(svg()), "image/svg+xml"))),
    ).toMatchObject({
      code: "UNSUPPORTED_EMBEDDED_IMAGE",
      status: "incomplete",
    });
    expect(
      await validate(svg('<image href="https://untrusted.invalid/image"/>')),
    ).toMatchObject({ code: "EXTERNAL_RESOURCE", status: "incomplete" });
  });
  it("bounds a single embedded reference before decode", async () => {
    expect(
      await validate(
        svg(
          '<image href="data:image/png;base64,' +
            "A".repeat(1024 * 1024) +
            '"/>',
        ),
      ),
    ).toMatchObject({ code: "LIMIT" });
  });
  it("rejects an already aborted call and an abort during chunked XML parsing", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await createRitualSvgValidator().validate(
        enc.encode(svg()),
        controller.signal,
      ),
    ).toMatchObject({ code: "ABORTED" });
    const active = new AbortController();
    const work = createRitualSvgValidator().validate(
      enc.encode(svg("<path/>".repeat(10_000))),
      active.signal,
    );
    await yieldTask();
    active.abort();
    expect(await work).toMatchObject({ code: "ABORTED" });
  });
  it("returns timeout from the real whole-operation timer and releases timer/listeners", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const result = await createRitualSvgValidator({ timeoutMs: 1 }).validate(
      enc.encode(svg("<path/>".repeat(15_000))),
      controller.signal,
    );
    expect(result).toMatchObject({ code: "TIMEOUT" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("aborts the real embedded Sharp pipeline after native metadata and destroys it", async () => {
    const png = await sharp({
      create: { width: 2, height: 3, channels: 4, background: "#ff8800" },
    })
      .png()
      .toBuffer();
    const controller = new AbortController();
    const original = sharp.prototype.metadata;
    const destroyed = vi.spyOn(sharp.prototype, "destroy");
    const decodePixels = vi.spyOn(sharp.prototype, "toBuffer");
    const metadata = vi
      .spyOn(sharp.prototype, "metadata")
      .mockImplementation(async function (this: Sharp) {
        const result = await original.call(this);
        controller.abort();
        return result;
      } as typeof original);
    expect(
      await createRitualSvgValidator().validate(
        enc.encode(svg(image(png))),
        controller.signal,
      ),
    ).toEqual({ status: "refused", code: "ABORTED" });
    expect(metadata).toHaveBeenCalledOnce();
    expect(destroyed).toHaveBeenCalled();
    expect(decodePixels).not.toHaveBeenCalled();
  });
  it("propagates the whole-operation deadline into native pipeline cleanup", async () => {
    const png = await sharp({
      create: { width: 2, height: 3, channels: 4, background: "#ff8800" },
    })
      .png()
      .toBuffer();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const original = sharp.prototype.metadata;
    const destroyed = vi.spyOn(sharp.prototype, "destroy");
    const decodePixels = vi.spyOn(sharp.prototype, "toBuffer");
    vi.spyOn(sharp.prototype, "metadata").mockImplementation(async function (
      this: Sharp,
    ) {
      const result = await original.call(this);
      await vi.advanceTimersByTimeAsync(15_000);
      return result;
    } as typeof original);
    expect(await validate(svg(image(png)))).toEqual({
      status: "refused",
      code: "TIMEOUT",
    });
    expect(destroyed).toHaveBeenCalled();
    expect(decodePixels).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds inherited paint closure independently of lexical reference count", async () => {
    expect(
      await validate(
        svg(
          '<defs><pattern id="p"><path/></pattern></defs><g fill="url(#p)"><g><path/></g></g>',
        ),
        { references: 2 },
      ),
    ).toMatchObject({ code: "LIMIT" });
  });
  it("accepts SVG2 text paths on basic shapes and refuses wrong target types", async () => {
    expect(
      await validate(
        svg(
          '<defs><circle id="c" r="10"/></defs><text><textPath href="#c">text</textPath></text>',
        ),
      ),
    ).toMatchObject({ status: "validated" });
    expect(
      await validate(
        svg('<g id="c"/><text><textPath href="#c">text</textPath></text>'),
      ),
    ).toMatchObject({ code: "INVALID_FRAGMENT_TARGET" });
  });
  it("captures its limits and allows an independent later call after a failed one", async () => {
    const config = { elements: 2 };
    const validator = createRitualSvgValidator(config);
    config.elements = 1;
    expect(
      await validator.validate(
        enc.encode(svg("<g/>")),
        new AbortController().signal,
      ),
    ).toMatchObject({ status: "validated" });
    expect(
      await validator.validate(
        enc.encode(svg("<g/><g/>")),
        new AbortController().signal,
      ),
    ).toMatchObject({ code: "LIMIT" });
    expect(
      await validator.validate(enc.encode(svg()), new AbortController().signal),
    ).toMatchObject({ status: "validated" });
  });
});

describe("marker context paint dependencies", () => {
  it("retains a simple context-stroke marker and dominant-baseline presentation", async () => {
    expect(
      await validate(
        svg(
          '<defs><marker id="m"><path style="fill:context-stroke;stroke:context-stroke"/></marker></defs><path stroke="red" marker-end="url(#m)"/><text dominant-baseline="central">t</text>',
        ),
      ),
    ).toMatchObject({ status: "validated" });
  });
  it.each([
    'stroke="url(#p)" marker-end="url(#m)"',
    'marker-end="url(#m)" stroke="url(#p)"',
  ])(
    "refuses context-paint cycles regardless of declaration order: %s",
    async (attrs) => {
      expect(
        await validate(
          svg(
            '<defs><pattern id="p"><path marker-end="url(#m)"/></pattern><marker id="m"><path fill="context-stroke"/></marker></defs><path ' +
              attrs +
              "/>",
          ),
        ),
      ).toMatchObject({ code: "REFERENCE_CYCLE" });
    },
  );
});

describe("exact Unicode identifiers and CSS escapes", () => {
  it("supports XML1.0 names and CSS semantic escapes without normalizing Unicode or bytes", async () => {
    const source = svg(
      '<defs><path id="é-אב-𐀀"/><linearGradient id="painté"/></defs><style>#\\e9 -אב-𐀀{fill:url("#paint\\e9 ")}</style><use href="#é-אב-𐀀"/>',
    );
    const result = await validate(source);
    expect(result).toMatchObject({ status: "validated", localReferences: 2 });
    if (result.status === "validated")
      expect(result.bytes).toEqual(enc.encode(source));
    expect(await validate(svg('<path id="é"/><use href="#é"/>'))).toMatchObject(
      { code: "MISSING_FRAGMENT" },
    );
  });
  it("detects a cycle through CSS escaped class matching instead of silently skipping the selector", async () => {
    expect(
      await validate(
        svg(
          '<defs><pattern id="p"><path class="é"/></pattern></defs><style>.\\e9 {fill:url(#p)}</style>',
        ),
      ),
    ).toMatchObject({ code: "REFERENCE_CYCLE" });
  });
  it("decodes CSS escaped type selectors only within the closed graphics set", async () => {
    expect(
      await validate(
        svg(
          '<defs><pattern id="p"><path/></pattern></defs><style>p\\61th{fill:url(#p)}</style>',
        ),
      ),
    ).toMatchObject({ code: "REFERENCE_CYCLE" });
    expect(
      await validate(svg("<style>foreign\\4f bject{fill:red}</style>")),
    ).toMatchObject({ code: "UNSUPPORTED_CSS" });
  });
  it.each(["a b", "a\u2000b", "1name", "a%20b"])(
    "refuses invalid XML identifiers: %s",
    async (id) => {
      expect(await validate(svg('<path id="' + id + '"/>'))).toMatchObject({
        code: "INVALID_FRAGMENT_TARGET",
      });
    },
  );
});
