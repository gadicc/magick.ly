import "server-only";
import { setImmediate as yieldTask } from "node:timers/promises";
import { sha256Hex } from "@gadicc/loom/files/hash";
import * as css from "css-tree";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { NAME_RE as identifier } from "xmlchars/xml/1.0/ed5.js";
import {
  DATA_IMAGE_LIMITS,
  DataImageError,
  decodeDataImage,
} from "./dataImage";
import type { ValidatedRitualImage } from "./ritualUploadContracts";
import { RITUAL_IMAGE_LIMITS, RitualUploadError } from "./ritualUploadProtocol";
import { createSharpRitualImageValidator } from "./validateRitualImage";

/**
 * Static byte/dependency compatibility for image contexts. This does not bound
 * SVG rendering pixels, geometry/filter allocation, or establish visual parity.
 * It is deliberately separate from the raster-only new-upload policy.
 */
export const RITUAL_SVG_PROFILE = "magickli-svg-image-compatibility-v1";
export const RITUAL_SVG_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  elements: 20_000,
  depth: 128,
  attributes: 100_000,
  attributesPerElement: 128,
  textCharacters: 4 * 1024 * 1024,
  cssBytes: 256 * 1024,
  cssBlockBytes: 16 * 1024,
  references: 2_000,
  expandedElements: 100_000,
  embeddedImages: 64,
  embeddedBytes: 4 * 1024 * 1024,
  embeddedPixels: RITUAL_IMAGE_LIMITS.maxPixels,
  timeoutMs: 15_000,
});
export type RitualSvgLimits = typeof RITUAL_SVG_LIMITS;
export type RitualSvgCode =
  | "INVALID_SVG"
  | "UNSUPPORTED_XML"
  | "ACTIVE_CONTENT"
  | "UNSUPPORTED_ELEMENT"
  | "UNSUPPORTED_ATTRIBUTE"
  | "UNSUPPORTED_CSS"
  | "INVALID_CSS"
  | "EXTERNAL_RESOURCE"
  | "UNSUPPORTED_EMBEDDED_IMAGE"
  | "INVALID_EMBEDDED_IMAGE"
  | "DUPLICATE_ID"
  | "MISSING_FRAGMENT"
  | "INVALID_FRAGMENT_TARGET"
  | "REFERENCE_CYCLE"
  | "LIMIT"
  | "ABORTED"
  | "TIMEOUT";
/** No source text, full resource URLs, parser diagnostics or element IDs enter failures. */
export type RitualSvgResult =
  | { status: "refused" | "incomplete"; code: RitualSvgCode }
  | {
      status: "validated";
      profile: typeof RITUAL_SVG_PROFILE;
      contentType: "image/svg+xml";
      /** Owned snapshot: facts describe these bytes, never a subsequently mutated caller buffer. */
      bytes: Uint8Array;
      sha256: string;
      byteSize: number;
      elements: number;
      localReferences: number;
      expandedElements: number;
      embeddedRasters: Array<
        ValidatedRitualImage & { sha256: string; byteSize: number }
      >;
    };

const SVG = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";
const XML = "http://www.w3.org/XML/1998/namespace";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const INK = "http://www.inkscape.org/namespaces/inkscape";
const SOD = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";
const words = (value: string) => new Set(value.split(" "));
const active = words(
  "script foreignObject animate animateMotion animateTransform set discard iframe object embed audio video",
);
const graphics = words(
  "svg g defs symbol title desc path rect circle ellipse line polyline polygon text tspan textPath use image linearGradient radialGradient stop pattern marker clipPath mask filter feColorMatrix feComposite feFlood feGaussianBlur feMerge feMergeNode feOffset style",
);
const properties = words(
  "clip-path clip-rule color color-interpolation-filters direction display dominant-baseline fill fill-opacity fill-rule filter font-family font-size font-stretch font-style font-variant font-variation-settings font-weight letter-spacing line-height marker-start marker-mid marker-end mask opacity overflow paint-order stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-align text-anchor vector-effect word-spacing",
);
const editorProperties = words("-inkscape-font-specification -inkscape-stroke");
const common = words("id class style transform aria-label role");
const byElement: Record<string, Set<string>> = Object.fromEntries(
  Object.entries({
    svg: "width height x y viewBox version preserveAspectRatio",
    symbol: "viewBox preserveAspectRatio",
    path: "d pathLength",
    rect: "x y width height rx ry pathLength",
    circle: "cx cy r pathLength",
    ellipse: "cx cy rx ry pathLength",
    line: "x1 x2 y1 y2 pathLength",
    polyline: "points pathLength",
    polygon: "points pathLength",
    text: "x y dx dy rotate textLength lengthAdjust",
    tspan: "x y dx dy rotate textLength lengthAdjust",
    textPath: "startOffset method spacing side textLength lengthAdjust dx dy",
    use: "x y width height",
    image: "x y width height preserveAspectRatio",
    linearGradient: "x1 x2 y1 y2 gradientUnits gradientTransform spreadMethod",
    radialGradient:
      "cx cy r fx fy fr gradientUnits gradientTransform spreadMethod",
    stop: "offset",
    pattern:
      "x y width height patternUnits patternContentUnits patternTransform preserveAspectRatio viewBox",
    marker:
      "markerHeight markerWidth markerUnits orient refX refY preserveAspectRatio viewBox",
    clipPath: "clipPathUnits",
    mask: "maskUnits maskContentUnits x y width height",
    filter: "x y width height filterUnits primitiveUnits",
    feColorMatrix: "in result type values",
    feComposite: "in in2 result operator k1 k2 k3 k4",
    feFlood: "in result flood-color flood-opacity",
    feGaussianBlur: "in result stdDeviation edgeMode",
    feMerge: "result",
    feMergeNode: "in",
    feOffset: "in result dx dy",
    style: "type",
  }).map(([key, value]) => [key, words(value)]),
);
const inkAttrs = words(
  "version current-layer cx cy deskcolor document-units pagecheckerboard pageopacity showpageshadow window-height window-maximized window-width window-x window-y zoom collect label menu menu-tooltip groupmode connector-curvature flatsided randomized rounded transform-center-x transform-center-y isstock stockid",
);
const sodAttrs = words(
  "docname arg1 arg2 cx cy nodetypes r1 r2 sides type role",
);
const namedviewAttrs = words(
  "id bordercolor borderopacity pagecolor showgrid showguides",
);
const hrefTargets: Record<string, Set<string>> = {
  linearGradient: words("linearGradient radialGradient"),
  radialGradient: words("linearGradient radialGradient"),
  pattern: words("pattern"),
  textPath: words("path rect circle ellipse line polyline polygon"),
  use: words(
    "svg g symbol path rect circle ellipse line polyline polygon text tspan use image",
  ),
};
const cssTargets: Record<string, Set<string>> = {
  fill: words("linearGradient radialGradient pattern"),
  stroke: words("linearGradient radialGradient pattern"),
  filter: words("filter"),
  "clip-path": words("clipPath"),
  mask: words("mask"),
  "marker-start": words("marker"),
  "marker-mid": words("marker"),
  "marker-end": words("marker"),
};
const inheritedResources = words(
  "fill stroke marker-start marker-mid marker-end",
);
const functions = words(
  "rgb rgba hsl hsla hwb lab lch oklab oklch color calc min max clamp",
);
class Stop extends Error {
  constructor(
    readonly code: RitualSvgCode,
    readonly status: "refused" | "incomplete" = "refused",
  ) {
    super(code);
  }
}
function reject(code: RitualSvgCode, status?: "refused" | "incomplete"): never {
  throw new Stop(code, status);
}
type Node = {
  name: string;
  id?: string;
  classes: string[];
  children: number[];
  refs: Array<{
    id: string;
    targets: Set<string>;
    inherited: boolean;
    property?: string;
  }>;
  text: string;
};
type Selector = { type?: string; ids: string[]; classes: string[] };
type StyleRule = { selectors: Selector[]; refs: Node["refs"] };

/**
 * Closed, non-fetching validator. Limits may only tighten defaults. Supported
 * image bytes are retained verbatim; unknown constructs never become sanitized output.
 */
export function createRitualSvgValidator(
  overrides: Partial<Record<keyof RitualSvgLimits, number>> = {},
) {
  const limits = { ...RITUAL_SVG_LIMITS } as Record<
    keyof RitualSvgLimits,
    number
  >;
  for (const [key, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(limits, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key as keyof RitualSvgLimits]
    )
      throw new Error("Invalid SVG validation limits");
    limits[key as keyof RitualSvgLimits] = value;
  }
  return {
    async validate(
      input: Uint8Array,
      signal: AbortSignal,
    ): Promise<RitualSvgResult> {
      const controller = new AbortController();
      const started = performance.now();
      let timedOut = false;
      const onAbort = () => controller.abort();
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, limits.timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      const check = () => {
        if (signal.aborted) reject("ABORTED");
        if (timedOut || performance.now() - started >= limits.timeoutMs)
          reject("TIMEOUT");
      };
      try {
        check();
        if (!(input instanceof Uint8Array) || !input.byteLength)
          reject("INVALID_SVG");
        if (input.byteLength > limits.bytes) reject("LIMIT");
        const bytes = new Uint8Array(input);
        let xml: string;
        try {
          xml = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
        } catch {
          reject("INVALID_SVG");
        }
        const nodes: Node[] = [],
          stack: number[] = [],
          ids = new Map<string, number>();
        const styles: StyleRule[] = [],
          embedded: string[] = [],
          allRefs: Node["refs"] = [];
        let attributes = 0,
          textCharacters = 0,
          cssBytes = 0,
          references = 0;
        const addReference = (
          value: string,
          refs: Node["refs"],
          targets: Set<string>,
          inherited = false,
          property?: string,
        ) => {
          if (++references > limits.references) reject("LIMIT");
          if (!value.startsWith("#")) reject("EXTERNAL_RESOURCE", "incomplete");
          const id = value.slice(1);
          if (!identifier.test(id)) reject("INVALID_FRAGMENT_TARGET");
          const ref = { id, targets, inherited, property };
          refs.push(ref);
          allRefs.push(ref);
        };
        const parseCss = (
          text: string,
          context: "declarationList" | "stylesheet" | "value",
        ) => {
          const size = new TextEncoder().encode(text).byteLength;
          cssBytes += size;
          if (size > limits.cssBlockBytes || cssBytes > limits.cssBytes)
            reject("LIMIT");
          try {
            const ast = css.parse(text, {
              context,
              parseCustomProperty: true,
              onParseError: () => reject("INVALID_CSS"),
            });
            css.walk(ast, (node) => {
              if (node.type === "Raw") reject("INVALID_CSS");
            });
            return ast;
          } catch (error) {
            if (error instanceof Stop) throw error;
            reject("INVALID_CSS");
          }
        };
        const declaration = (
          property: string,
          value: css.CssNode,
          refs: Node["refs"],
        ) => {
          const editor = editorProperties.has(property);
          if (!properties.has(property) && !editor)
            reject("UNSUPPORTED_CSS", "incomplete");
          css.walk(value, (node) => {
            if (node.type === "Url") {
              const targets = cssTargets[property];
              if (!targets) reject("UNSUPPORTED_CSS", "incomplete");
              addReference(
                node.value,
                refs,
                targets,
                inheritedResources.has(property),
                property,
              );
            }
            if (
              node.type === "Function" &&
              !functions.has(node.name.toLowerCase())
            )
              reject("UNSUPPORTED_CSS", "incomplete");
          });
          if (!editor && css.lexer.matchProperty(property, value).error)
            reject("INVALID_CSS");
        };
        const declarations = (ast: css.CssNode, refs: Node["refs"]) => {
          if (ast.type !== "DeclarationList" && ast.type !== "Block")
            reject("INVALID_CSS");
          ast.children.forEach((node) => {
            if (node.type !== "Declaration")
              reject("UNSUPPORTED_CSS", "incomplete");
            declaration(node.property, node.value, refs);
          });
        };
        const stylesheet = (text: string) => {
          const ast = parseCss(text, "stylesheet");
          if (ast.type !== "StyleSheet") reject("INVALID_CSS");
          ast.children.forEach((rule) => {
            if (rule.type !== "Rule" || rule.prelude?.type !== "SelectorList")
              reject("UNSUPPORTED_CSS", "incomplete");
            const selectors: Selector[] = [];
            rule.prelude.children.forEach((selector) => {
              if (selector.type !== "Selector")
                reject("UNSUPPORTED_CSS", "incomplete");
              const match: Selector = { ids: [], classes: [] };
              selector.children.forEach((part) => {
                if (
                  part.type === "TypeSelector" &&
                  !match.type &&
                  graphics.has(css.ident.decode(part.name))
                )
                  match.type = css.ident.decode(part.name);
                else if (
                  part.type === "ClassSelector" &&
                  identifier.test(css.ident.decode(part.name))
                )
                  match.classes.push(css.ident.decode(part.name));
                else if (
                  part.type === "IdSelector" &&
                  identifier.test(css.ident.decode(part.name))
                )
                  match.ids.push(css.ident.decode(part.name));
                else reject("UNSUPPORTED_CSS", "incomplete");
              });
              selectors.push(match);
            });
            const refs: Node["refs"] = [];
            declarations(rule.block, refs);
            styles.push({ selectors, refs });
          });
        };
        const parser = new SaxesParser({
          xmlns: true,
          defaultXMLVersion: "1.0",
        });
        parser.on("error", () => reject("INVALID_SVG"));
        parser.on("doctype", () => reject("ACTIVE_CONTENT"));
        parser.on("processinginstruction", () => reject("ACTIVE_CONTENT"));
        parser.on("xmldecl", (decl) => {
          if (
            decl.version !== "1.0" ||
            (decl.encoding && decl.encoding.toLowerCase() !== "utf-8")
          )
            reject("UNSUPPORTED_XML", "incomplete");
        });
        parser.on("opentag", (tag: SaxesTagNS) => {
          check();
          if (nodes.length >= limits.elements || stack.length >= limits.depth)
            reject("LIMIT");
          const attrs = Object.values(tag.attributes);
          attributes += attrs.length;
          if (
            attrs.length > limits.attributesPerElement ||
            attributes > limits.attributes
          )
            reject("LIMIT");
          if (!nodes.length && (tag.uri !== SVG || tag.local !== "svg"))
            reject("INVALID_SVG");
          if (active.has(tag.local)) reject("ACTIVE_CONTENT");
          const namedview =
            tag.uri === SOD && tag.local === "namedview" && stack.length === 1;
          if (!namedview && (tag.uri !== SVG || !graphics.has(tag.local)))
            reject("UNSUPPORTED_ELEMENT", "incomplete");
          if (
            stack.length &&
            ["namedview", "style", "title", "desc"].includes(
              nodes[stack[stack.length - 1]].name,
            )
          )
            reject("UNSUPPORTED_ELEMENT", "incomplete");
          const node: Node = {
            name: tag.local,
            classes: [],
            children: [],
            refs: [],
            text: "",
          };
          const index = nodes.length;
          nodes.push(node);
          if (stack.length) nodes[stack[stack.length - 1]].children.push(index);
          stack.push(index);
          let href: string | undefined;
          for (const attr of attrs) {
            const { local: name, uri, value } = attr;
            textCharacters += value.length;
            if (textCharacters > limits.textCharacters) reject("LIMIT");
            if (/^on/i.test(name) || (uri === XML && name === "base"))
              reject("ACTIVE_CONTENT");
            if (uri === XMLNS) continue;
            if (uri === INK && inkAttrs.has(name)) continue;
            if (uri === SOD && sodAttrs.has(name)) continue;
            if (
              uri === XML &&
              name === "space" &&
              ["default", "preserve"].includes(value)
            )
              continue;
            if (!namedview && name === "href" && (!uri || uri === XLINK)) {
              if (href !== undefined && href !== value)
                reject("UNSUPPORTED_ATTRIBUTE", "incomplete");
              href = value;
              continue;
            }
            if (
              uri ||
              !(namedview
                ? namedviewAttrs.has(name)
                : common.has(name) ||
                  properties.has(name) ||
                  byElement[tag.local]?.has(name))
            )
              reject("UNSUPPORTED_ATTRIBUTE", "incomplete");
            if (name === "id") {
              if (!identifier.test(value)) reject("INVALID_FRAGMENT_TARGET");
              if (ids.has(value)) reject("DUPLICATE_ID");
              ids.set(value, index);
              node.id = value;
            } else if (name === "class")
              node.classes = value.split(/\s+/).filter(Boolean);
            else if (name === "style")
              declarations(parseCss(value, "declarationList"), node.refs);
            else if (properties.has(name))
              declaration(name, parseCss(value, "value"), node.refs);
            else if (
              tag.local === "style" &&
              name === "type" &&
              value !== "text/css"
            )
              reject("UNSUPPORTED_CSS", "incomplete");
          }
          if (href !== undefined) {
            if (node.name === "image") {
              if (
                ++references > limits.references ||
                embedded.length >= limits.embeddedImages
              )
                reject("LIMIT");
              if (!/^data:/i.test(href))
                reject("EXTERNAL_RESOURCE", "incomplete");
              embedded.push(href);
            } else {
              const targets = hrefTargets[node.name];
              if (!targets) reject("UNSUPPORTED_ATTRIBUTE", "incomplete");
              addReference(href, node.refs, targets);
            }
          }
        });
        const text = (value: string) => {
          textCharacters += value.length;
          if (textCharacters > limits.textCharacters) reject("LIMIT");
          if (stack.length && nodes[stack[stack.length - 1]].name === "style")
            nodes[stack[stack.length - 1]].text += value;
        };
        parser.on("text", text);
        parser.on("cdata", text);
        parser.on("closetag", () => {
          const node = nodes[stack.pop()!];
          if (node.name === "style") stylesheet(node.text);
        });
        for (let offset = 0; offset < xml.length; offset += 16 * 1024) {
          check();
          parser.write(xml.slice(offset, offset + 16 * 1024));
          await yieldTask();
        }
        parser.close();
        check();
        let appliedReferences = references,
          matchingWork = 0;
        for (const rule of styles)
          for (const node of nodes) {
            if (++matchingWork % 1024 === 0) {
              await yieldTask();
              check();
            }
            if (
              rule.selectors.some(
                (s) =>
                  (!s.type || s.type === node.name) &&
                  s.ids.every((id) => id === node.id) &&
                  s.classes.every((name) => node.classes.includes(name)),
              )
            ) {
              appliedReferences += rule.refs.length;
              if (appliedReferences > limits.references) reject("LIMIT");
              node.refs.push(...rule.refs);
            }
          }
        for (const ref of allRefs) {
          const target = ids.get(ref.id);
          if (target === undefined) reject("MISSING_FRAGMENT");
          if (!ref.targets.has(nodes[target].name))
            reject("INVALID_FRAGMENT_TARGET");
        }
        // Resource-valued inherited paint can reach definition descendants and
        // use shadow trees. Marker context-fill/context-stroke may also select
        // either source paint, so conservatively pass both into marker subtrees.
        // Retain ancestor possibilities even
        // when a later cascade declaration could override them; unknown cycles
        // must not be declared complete because a presentation rule hides them.
        const inherited = nodes.map(
          (node) => new Set(node.refs.filter((ref) => ref.inherited)),
        );
        const queue = nodes.flatMap((node, index) =>
          [...inherited[index]].map((ref) => ({ index, ref })),
        );
        const inherit = (index: number, ref: Node["refs"][number]) => {
          if (inherited[index].has(ref)) return;
          if (++appliedReferences > limits.references) reject("LIMIT");
          inherited[index].add(ref);
          nodes[index].refs.push(ref);
          queue.push({ index, ref });
        };
        const isPaint = (ref: Node["refs"][number]) =>
          ref.property === "fill" || ref.property === "stroke";
        const isMarker = (ref: Node["refs"][number]) =>
          ref.property?.startsWith("marker-") === true;
        for (let cursor = 0; cursor < queue.length; cursor++) {
          if (cursor % 1024 === 0) {
            await yieldTask();
            check();
          }
          const { index, ref } = queue[cursor];
          const node = nodes[index];
          const children =
            node.name === "use"
              ? [
                  ...node.children,
                  ...node.refs
                    .filter((r) => r.targets === hrefTargets.use)
                    .map((r) => ids.get(r.id)!),
                ]
              : node.children;
          for (const child of children) inherit(child, ref);
          // Process whichever half of a paint/marker pair arrived later. This
          // also covers inherited marker selectors without an unbounded cascade.
          if (isPaint(ref))
            for (const marker of node.refs.filter(isMarker))
              inherit(ids.get(marker.id)!, ref);
          if (isMarker(ref))
            for (const paint of node.refs.filter(isPaint))
              inherit(ids.get(ref.id)!, paint);
        }
        const edges = nodes.map((node) => {
          // All lexical targets were checked above, including unmatched CSS rules.
          const refs = node.refs.map((ref) => ids.get(ref.id)!);
          return [...node.children, ...refs];
        });
        const colors = new Uint8Array(nodes.length),
          costs = new Array<number>(nodes.length).fill(1);
        const walk: Array<{ index: number; next: number }> = [
          { index: 0, next: 0 },
        ];
        colors[0] = 1;
        let graphWork = 0;
        while (walk.length) {
          if (++graphWork % 1024 === 0) await yieldTask();
          check();
          const frame = walk[walk.length - 1];
          const target = edges[frame.index][frame.next];
          if (target === undefined) {
            colors[frame.index] = 2;
            walk.pop();
            continue;
          }
          if (colors[target] === 1) reject("REFERENCE_CYCLE");
          if (!colors[target]) {
            colors[target] = 1;
            walk.push({ index: target, next: 0 });
            continue;
          }
          costs[frame.index] += costs[target];
          frame.next++;
          if (costs[frame.index] > limits.expandedElements) reject("LIMIT");
        }
        const embeddedRasters: Array<
          ValidatedRitualImage & { sha256: string; byteSize: number }
        > = [];
        let embeddedBytes = 0,
          embeddedPixels = 0;
        for (const reference of embedded) {
          check();
          let decoded: ReturnType<typeof decodeDataImage>;
          const remainingBytes = limits.embeddedBytes - embeddedBytes;
          if (
            remainingBytes < 1 ||
            new TextEncoder().encode(reference).byteLength >
              Math.min(limits.bytes, DATA_IMAGE_LIMITS.maxReferenceBytes)
          )
            reject("LIMIT");
          try {
            decoded = decodeDataImage(reference, {
              maxBytes: Math.min(remainingBytes, DATA_IMAGE_LIMITS.maxBytes),
              maxReferenceBytes: Math.min(
                limits.bytes,
                DATA_IMAGE_LIMITS.maxReferenceBytes,
              ),
            });
          } catch (error) {
            if (
              error instanceof DataImageError &&
              ["REFERENCE_LIMIT", "BYTE_LIMIT"].includes(error.code)
            )
              reject("LIMIT");
            reject("INVALID_EMBEDDED_IMAGE");
          }
          if (decoded.declaredMime === "image/svg+xml")
            reject("UNSUPPORTED_EMBEDDED_IMAGE", "incomplete");
          embeddedBytes += decoded.bytes.byteLength;
          if (
            embeddedBytes > limits.embeddedBytes ||
            embeddedPixels >= limits.embeddedPixels
          )
            reject("LIMIT");
          const image = await createSharpRitualImageValidator({
            ...RITUAL_IMAGE_LIMITS,
            maxPixels: limits.embeddedPixels - embeddedPixels,
            decodeSeconds: Math.max(
              1,
              Math.min(
                RITUAL_IMAGE_LIMITS.decodeSeconds,
                Math.ceil(
                  (limits.timeoutMs - (performance.now() - started)) / 1000,
                ),
              ),
            ),
          }).validate(decoded.bytes, controller.signal);
          check();
          if (image.contentType !== decoded.declaredMime)
            reject("INVALID_EMBEDDED_IMAGE");
          embeddedPixels += image.decodedPixels;
          if (embeddedPixels > limits.embeddedPixels) reject("LIMIT");
          embeddedRasters.push({
            ...image,
            sha256: await sha256Hex(decoded.bytes),
            byteSize: decoded.bytes.byteLength,
          });
        }
        check();
        const sha256 = await sha256Hex(bytes);
        check();
        return {
          status: "validated",
          profile: RITUAL_SVG_PROFILE,
          contentType: "image/svg+xml",
          bytes,
          sha256,
          byteSize: bytes.byteLength,
          elements: nodes.length,
          localReferences: references - embedded.length,
          expandedElements: costs[0],
          embeddedRasters,
        };
      } catch (error) {
        if (signal.aborted) return { status: "refused", code: "ABORTED" };
        if (timedOut || performance.now() - started >= limits.timeoutMs)
          return { status: "refused", code: "TIMEOUT" };
        if (error instanceof Stop)
          return { status: error.status, code: error.code };
        if (error instanceof RitualUploadError)
          return {
            status: "refused",
            code:
              error.code === "TIMEOUT"
                ? "TIMEOUT"
                : error.code === "IMAGE_LIMIT"
                  ? "LIMIT"
                  : "INVALID_EMBEDDED_IMAGE",
          };
        return { status: "refused", code: "INVALID_SVG" };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        controller.abort();
      }
    },
  };
}
