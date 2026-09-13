/** Reachability/classification contract for the current app blocks plus JRT 1.3.1. */
export const RITUAL_ASSET_INVENTORY_PROFILE = "magickli-jrt-assets-v2";
export const RITUAL_ASSET_INVENTORY_LIMITS = Object.freeze({
  jsonBytes: 4 * 1024 * 1024,
  nodes: 20_000,
  depth: 128,
  occurrences: 512,
  referenceBytes: 1024 * 1024,
  styleBytes: 16 * 1024,
  issues: 512,
} as const);
/** Explicit server/build configuration. Catalog membership is not proof of bytes or permission. */
export interface RitualAssetInventoryOptions {
  knownAppOrigins: readonly string[];
  staticPaths: readonly string[];
  /** May tighten the fixed maxima only. */
  limits?: Partial<Record<keyof typeof RITUAL_ASSET_INVENTORY_LIMITS, number>>;
}
/** Classification only; each kind still needs its reviewed byte/dependency resolver. */
export type RitualAssetReference =
  | { kind: "legacy-file2"; sha256: string }
  | { kind: "local-static"; pathname: string }
  | { kind: "generated-tree-of-life" }
  | { kind: "inline-image"; mediaType: string }
  | { kind: "external" }
  | { kind: "unresolved"; reason: string }
  | { kind: "invalid"; reason: string };
/** One source occurrence. Identical URLs in different child paths stay separate. */
export interface RitualAssetOccurrence {
  path: number[];
  src: string;
  /** Exact src minus only its first literal # and following display fragment. Not a fetch instruction. */
  networkReference: string;
  /** Includes the original #; no decoding or normalization. */
  displayFragment: string;
  reference: RitualAssetReference;
}
/** Safe diagnostics never echo unrelated text, source metadata or unsupported attribute values. */
export interface RitualAssetInventoryIssue {
  code: string;
  path: number[];
  field?: string;
}
/** Enumeration is separate from resolution: even an exhaustive inventory never means a bundle is Ready. */
export interface RitualAssetInventory {
  profile: typeof RITUAL_ASSET_INVENTORY_PROFILE;
  occurrences: RitualAssetOccurrence[];
  issues: RitualAssetInventoryIssue[];
  enumerationComplete: boolean;
}
type Row = Record<string, unknown>;
type Info = {
  row: Row;
  path: number[];
  type: string;
  parent: Info | null;
  children: Info[];
};
const encoder = new TextEncoder();
const plain = (value: unknown): value is Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return false;
  return Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" &&
      (() => {
        const d = Object.getOwnPropertyDescriptor(value, key);
        return !!d?.enumerable && "value" in d;
      })(),
  );
};
const resourceFields = new Set([
  "src",
  "srcSet",
  "srcset",
  "href",
  "xlinkHref",
  "poster",
  "data",
  "background",
  "dangerouslySetInnerHTML",
]);
const safeSpanFields = new Set([
  "type",
  "children",
  "style",
  "className",
  "id",
  "title",
  "lang",
  "dir",
  "role",
  "hidden",
  "forMe",
]);
const safeStyleFields = new Set([
  "color",
  "backgroundColor",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "lineHeight",
  "textAlign",
  "textDecoration",
  "textIndent",
  "whiteSpace",
  "verticalAlign",
  "display",
  "position",
  "float",
  "clear",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "top",
  "right",
  "bottom",
  "left",
  "opacity",
  "overflow",
  "border",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderRadius",
]);
const suppress = new Set([
  "declareVar",
  "img",
  "grade",
  "br",
  "hr",
  "text",
  "var",
  "stylesheet",
  "cursor",
]);
function empty(): RitualAssetInventory {
  return {
    profile: RITUAL_ASSET_INVENTORY_PROFILE,
    occurrences: [],
    issues: [],
    enumerationComplete: true,
  };
}
function configuration(options: RitualAssetInventoryOptions) {
  if (
    !plain(options) ||
    !Array.isArray(options.knownAppOrigins) ||
    !Array.isArray(options.staticPaths)
  )
    throw new Error();
  const limits = { ...RITUAL_ASSET_INVENTORY_LIMITS } as Record<
    keyof typeof RITUAL_ASSET_INVENTORY_LIMITS,
    number
  >;
  if (options.limits !== undefined) {
    if (!plain(options.limits)) throw new Error();
    for (const [key, value] of Object.entries(options.limits)) {
      if (
        !Object.hasOwn(limits, key) ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > limits[key as keyof typeof limits]
      )
        throw new Error();
      limits[key as keyof typeof limits] = value;
    }
  }
  const origins = new Set<string>();
  for (const value of options.knownAppOrigins) {
    if (typeof value !== "string") throw new Error();
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== value ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
    origins.add(value);
  }
  const paths = new Set<string>();
  for (const value of options.staticPaths) {
    if (
      typeof value !== "string" ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[?#\\\s]/.test(value) ||
      new URL(value, "https://inventory.invalid").pathname !== value
    )
      throw new Error();
    paths.add(value);
  }
  return { limits, origins, paths };
}
function classify(
  src: string,
  origins: Set<string>,
  paths: Set<string>,
): RitualAssetOccurrence["reference"] {
  if (!src || !src.isWellFormed() || src.includes("\0"))
    return { kind: "invalid", reason: "invalid-reference" };
  if (/^data:/i.test(src)) {
    const match = /^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?,(.+)$/is.exec(src);
    return match
      ? { kind: "inline-image", mediaType: match[1].toLowerCase() }
      : { kind: "invalid", reason: "invalid-data-image" };
  }
  if (src.trim() !== src || /[\u0000-\u0020\u007f]/.test(src))
    return { kind: "invalid", reason: "invalid-reference" };
  if (src.includes("\\")) return { kind: "invalid", reason: "ambiguous-url" };
  if (src.startsWith("//"))
    return { kind: "unresolved", reason: "protocol-relative-origin" };
  if (!src.startsWith("/") && !/^https?:\/\//i.test(src))
    return {
      kind: "unresolved",
      reason: "unsupported-reference-scheme-or-base",
    };
  let url: URL;
  try {
    url = new URL(src, "https://inventory.invalid");
  } catch {
    return { kind: "invalid", reason: "invalid-url" };
  }
  if (url.username || url.password)
    return { kind: "invalid", reason: "url-credentials" };
  const local = src.startsWith("/") || origins.has(url.origin);
  if (!local) return { kind: "external" };
  // URL is for classification only. Never use its serialized/normalized value as identity.
  const rawPath = src.startsWith("/")
    ? src.split("?", 1)[0]
    : (/^https?:\/\/[^/]+(\/[^?]*)?/i.exec(src)?.[1] ?? "/");
  if (rawPath !== url.pathname)
    return { kind: "unresolved", reason: "normalized-local-path" };
  if (url.pathname === "/api/file2") {
    const pairs = [...url.searchParams.entries()];
    if (
      pairs.length !== 1 ||
      pairs[0][0] !== "sha256" ||
      !/^[a-f0-9]{64}$/.test(pairs[0][1])
    )
      return { kind: "unresolved", reason: "unsupported-legacy-file-query" };
    return { kind: "legacy-file2", sha256: pairs[0][1] };
  }
  if (
    url.pathname === "/api/treeOfLife" ||
    url.pathname === "/api/render/tree-of-life"
  )
    return { kind: "generated-tree-of-life" };
  if (paths.has(rawPath)) return { kind: "local-static", pathname: rawPath };
  return { kind: "unresolved", reason: "unrecognized-local-reference" };
}

/**
 * Inspect a decoded selected-render tree without running JRT/React or changing it.
 * Only children edges establish occurrences. Metadata strings never become assets.
 * Call the JSON entry point at transport boundaries for a whole-document byte bound.
 */
export function inventoryRitualAssets(
  tree: unknown,
  options: RitualAssetInventoryOptions,
): RitualAssetInventory {
  const result = empty();
  let issueLimit: number = RITUAL_ASSET_INVENTORY_LIMITS.issues;
  const issue = (code: string, path: readonly number[], field?: string) => {
    result.enumerationComplete = false;
    if (result.issues.length < issueLimit)
      result.issues.push({
        code,
        path: [...path],
        ...(field ? { field } : {}),
      });
    else
      result.issues[issueLimit - 1] = { code: "issue-limit", path: [...path] };
  };
  try {
    const { limits, origins, paths } = configuration(options);
    issueLimit = limits.issues;
    let nodes = 0,
      steps = 0;
    const ancestors = new Set<object>();
    const visited = new Set<object>();
    const build = (
      value: unknown,
      path: number[],
      parent: Info | null,
    ): Info => {
      if (++nodes > limits.nodes || path.length > limits.depth) {
        issue("tree-limit", path);
        throw new Error();
      }
      if (!plain(value) || ancestors.has(value)) {
        issue(
          ancestors.has(value as object) ? "child-cycle" : "malformed-node",
          path,
        );
        throw new Error();
      }
      if (visited.has(value)) {
        issue("shared-child-node", path);
        throw new Error();
      }
      visited.add(value);
      if (
        value.type !== undefined &&
        (typeof value.type !== "string" ||
          !value.type ||
          Object.hasOwn(Object.prototype, value.type))
      ) {
        issue("malformed-type", path);
        throw new Error();
      }
      if (
        value.children !== undefined &&
        (!Array.isArray(value.children) ||
          Reflect.ownKeys(value.children).length !== value.children.length + 1)
      ) {
        issue("malformed-children", path);
        throw new Error();
      }
      const info: Info = {
        row: value,
        path,
        type: typeof value.type === "string" ? value.type : "node",
        parent,
        children: [],
      };
      ancestors.add(value);
      for (
        let i = 0;
        i < ((value.children as unknown[] | undefined)?.length ?? 0);
        i++
      ) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value.children,
          String(i),
        );
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          issue("malformed-children", path);
          throw new Error();
        }
        info.children.push(build(descriptor.value, [...path, i], info));
      }
      ancestors.delete(value);
      return info;
    };
    const root = build(tree, [], null),
      seenOccurrences = new Set<Info>(),
      queues = new Map<Info, Info[]>(),
      renderedHosts = new Set<Info>(),
      expanding = new Set<Info>();
    const style = (info: Info) => {
      const value = info.row.style;
      if (
        info.type === "span" &&
        value !== undefined &&
        value !== null &&
        !value
      ) {
        issue("malformed-style", info.path, "style");
        return;
      }
      if (!value) return;
      if (
        typeof value !== "string" ||
        encoder.encode(value).length > limits.styleBytes
      ) {
        issue("unsupported-style", info.path, "style");
        return;
      }
      try {
        const parsed = JSON.parse(
          info.type === "span"
            ? value.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ')
            : value,
        );
        if (
          !plain(parsed) ||
          Object.entries(parsed).some(
            ([key, v]) =>
              !safeStyleFields.has(key) ||
              (typeof v !== "string" && typeof v !== "number") ||
              (typeof v === "string" && /[\\()]|\/\*|@/i.test(v)),
          )
        )
          issue("unsupported-style", info.path, "style");
      } catch {
        issue("malformed-style", info.path, "style");
      }
    };
    const render = (info: Info) => {
      if (++steps > limits.nodes * 4) {
        issue("render-limit", info.path);
        return;
      }
      const { row, type, path, children } = info;
      if (
        (type === "title" && typeof row.text !== "string") ||
        (type === "grade" && typeof row.grade !== "string") ||
        (type === "text" &&
          typeof row.value !== "string" &&
          row.value !== undefined)
      )
        issue("malformed-render-value", path);

      if (type === "footnote") {
        let host: Info | undefined;
        for (let parent = info.parent; parent; parent = parent.parent) {
          host = parent.children.find((child) => child.type === "footnotes");
          if (host) break;
          if (parent.type === "task") {
            host = parent;
            break;
          }
        }
        if (!host || renderedHosts.has(host) || expanding.has(host)) {
          issue("unresolved-footnote-host", path);
          return;
        }
        const queue = queues.get(host) ?? [];
        if (!queue.includes(info)) queue.push(info);
        queues.set(host, queue);
        return;
      }
      const expand = (host: Info) => {
        const queue = queues.get(host);
        renderedHosts.add(host);
        if (!queue?.length) {
          issue("uninitialized-footnotes", host.path);
          return;
        }
        expanding.add(host);
        for (const footnote of [...queue])
          for (const child of footnote.children) render(child);
        expanding.delete(host);
      };
      if (type === "footnotes") {
        expand(info);
        return;
      }
      if (type === "task") {
        if (typeof row.role !== "string" || !Object.hasOwn(row, "children"))
          issue("malformed-task", path);
        // Both branches can render the same child twice. Identity is its one source
        // path; a resolver applies the same substitution to both DOM instances.
        if (row.say || row.do)
          for (const child of children)
            if (child.type !== "footnotes") render(child);
        const explicit = children.find((child) => child.type === "footnotes");
        if (explicit) render(explicit);
        else if (queues.has(info)) expand(info);
        return;
      }
      if (type === "img") {
        style(info);
        for (const field of resourceFields)
          if (field !== "src" && Object.hasOwn(row, field))
            issue("unsupported-render-reference", path, field);
        if (typeof row.src !== "string") {
          issue("missing-image-src", path, "src");
          return;
        }
        if (encoder.encode(row.src).length > limits.referenceBytes) {
          issue("reference-limit", path, "src");
          return;
        }
        if (!seenOccurrences.has(info)) {
          if (result.occurrences.length >= limits.occurrences) {
            issue("occurrence-limit", path);
            return;
          }
          seenOccurrences.add(info);
          const hash = row.src.indexOf("#"),
            networkReference = hash < 0 ? row.src : row.src.slice(0, hash),
            displayFragment = hash < 0 ? "" : row.src.slice(hash);
          const reference: RitualAssetReference =
            !row.src.isWellFormed() || row.src.includes("\0")
              ? { kind: "invalid", reason: "invalid-reference" }
              : classify(networkReference, origins, paths);
          result.occurrences.push({
            path: [...path],
            src: row.src,
            networkReference,
            displayFragment,
            reference,
          });
          if (reference.kind === "invalid" || reference.kind === "unresolved")
            issue(reference.reason, path, "src");
        }
        return;
      }
      if (type === "stylesheet") {
        issue("unsupported-stylesheet", path, "href");
        return;
      }
      if (type === "cursor") {
        issue("unsupported-editor-cursor", path);
        return;
      }
      if (suppress.has(type)) return;
      if (type === "span") {
        style(info);
        for (const field of Object.keys(row))
          if (
            !safeSpanFields.has(field) &&
            !field.startsWith("aria-") &&
            !field.startsWith("data-")
          )
            issue("unsupported-span-attribute", path, "attributes");
      } else
        for (const field of resourceFields)
          if (Object.hasOwn(row, field) && !(type === "a" && field === "href"))
            issue("unsupported-render-reference", path, field);
      for (const child of children) render(child);
    };
    render(root);
    result.occurrences.sort((a, b) => {
      for (let i = 0; i < Math.min(a.path.length, b.path.length); i++)
        if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
      return a.path.length - b.path.length;
    });
  } catch {
    if (!result.issues.length) issue("invalid-inventory-input", []);
  }
  return result;
}

/** Bounded JSON parsing leaves exact contentJson/hash ownership with the selected-render descriptor. */
export function inventoryRitualAssetJson(
  contentJson: unknown,
  options: RitualAssetInventoryOptions,
): RitualAssetInventory {
  try {
    const { limits } = configuration(options);
    if (
      typeof contentJson !== "string" ||
      contentJson.length > limits.jsonBytes ||
      encoder.encode(contentJson).length > limits.jsonBytes
    )
      throw new Error();
    return inventoryRitualAssets(JSON.parse(contentJson), options);
  } catch {
    return {
      ...empty(),
      enumerationComplete: false,
      issues: [{ code: "invalid-or-oversized-content-json", path: [] }],
    };
  }
}
