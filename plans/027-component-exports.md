# Component export consolidation

Research, design and implementation record, 16 September 2026. Read
[current status](000-current-status.md) first; the ritual image renderer
background is in [plan 009](009-ritual-image-acquisition.md#shared-component-image-renderer).
The decisions taken on 16 September: sigils get a full server contract with
`noindex` responses; feedback moves to an MUI Snackbar inside the wrapper; the
Enochian glyph font joins the server contract only once a TTF and its licence
are supplied; geomancy readings get an opt-in share link that restores state.

## Scope and boundaries

- Six pages share `src/copyPasteExport.tsx`, a live-DOM SVG/PNG copy/download
  widget. One component, the Tree of Life, also has a closed server renderer at
  `/api/render/tree-of-life` (legacy alias `/api/treeOfLife`).
- Goal: one export UI, a direct-link option for components with a validated,
  deterministic server rendering contract, and stable public URLs the separate
  whole-site SEO task can build on.
- Preserve: ritual publication, private/offline access and image acquisition
  flows, the two Tree URLs, saved ritual references, and the generated-catalog
  identities. No production backfill or republishing.
- The concurrent dependency-upgrade task (see [its ledger](026-dependency-upgrades.md))
  has uncommitted changes in `src/components/kabbalah/TreeOfLife.tsx`,
  `src/files/ritualImageValidationIdentity.ts`,
  `src/offline/sqlRitualBundlePublications.ts`, `package.json` and a temporary
  toast harness that imports `ToastContainer` from `@/copyPasteExport`. Export
  work branches from that result and keeps the `ToastContainer` re-export until
  the harness is gone.

## Inventory and export readiness

| Component (page) | State that shapes the image | Fonts / assets | Browser-only or nondeterministic inputs | Animation | URL can reproduce the displayed result? |
| --- | --- | --- | --- | --- | --- |
| TreeOfLife (`/kabbalah/tree`) | field, topText, bottomText, colorScale, letterAttr, flip, showDaat, fontSize (page always passes 10) | Noto Sans, Noto Sans Hebrew via `@font-face` in the SVG, plus Devanagari/Symbols server-side | none | none | Yes, already in the URL; the server contract exists. Page defaults differ from API defaults (`field=name.roman`/`bottomText=name.en`/`fontSize=10` vs `index`/empty/field-based), so a link must serialize every prop explicitly |
| AstroGeomancyChart (`/geomancy/reading`) | the four mothers only (16 rows of 1/2); house, planet and thumbs are page state, not chart state | planetary/zodiac symbols (Noto Sans Symbols), Roboto inherited | dice use `crypto.getRandomValues` client-side; planetary hours use GeoIP and the clock, neither affects the chart | none | Yes, if the mothers are serialized (16 characters). A reading must never be regenerated server-side |
| Tablet (`/enochian/tablets`) | id (earth, air), enochianFont | `next/font/local` Enochian Plain (woff/woff2, Font Squirrel kit, license unrecorded); grid letters are Latin transliterations that the font maps to Enochian glyphs | none | none | Yes, but server output with the Enochian font needs a TTF/OTF the renderer can load and a recorded license |
| SevenBranchedCandleStick (`/gd/symbols/candlestick`) | none | Hebrew text on `textPath`, planetary symbols; no font-family (inherits Roboto) | none | none | Yes; could even be a static file |
| TableOfShewbread (`/gd/symbols/shewbread`) | none | Hebrew, zodiac symbols, and four colour emoji (👨🦁🦅🐂) | none | none | Yes for geometry and text; the emoji need a bundled emoji font (monochrome) or a substitute |
| RoseSigil (`/gd/sigils`) | sigilText (Hebrew letters, personal), showRose, animate, debug | Hebrew rose letters (inherited font) | nlopt WASM optimisation runs in a client effect; the drawn path is the optimised result, so a server render would have to run the same optimiser | stroke-dash draw-on animation; the export strips the inline dash styles to show the finished sigil | Technically possible; not recommended (personal text in URLs, server optimisation cost) |

Sigil text and geomancy readings are user state. A link that carries them puts
that state into browser history, server logs, CDN caches and anything the link
is pasted into; it must be an explicit user action with visible wording, never
an automatic URL rewrite, and such responses should carry `X-Robots-Tag: noindex`.

## Findings: the wrapper (`src/copyPasteExport.tsx`)

Verified in Chromium 152 against a local dev server unless marked otherwise.

1. **Global element IDs.** The four controls use fixed `id`s and `getElementById`.
   A second wrapper on a page would write its download URLs into the first
   wrapper's anchors. No page has two wrappers today, but the design forbids it.
2. **PNG download needs two clicks and leaks.** The anchor has `href="#"`; the
   handler awaits canvas rasterisation and only then sets `href`/`download`.
   The first click navigates to `#`; the second downloads the previous render,
   which is stale if the state changed. `URL.createObjectURL` is never revoked.
3. **Clipboard.** `copyPNG` awaits rasterisation before `navigator.clipboard.write`,
   which loses the user gesture in Safari (NotAllowedError); Safari needs
   `new ClipboardItem({ "image/png": promiseOfBlob })` created synchronously.
   `copyPNG` has no try/catch, so a rejection is an unhandled promise with no
   feedback. `copySVG` matches error message text to choose a fallback and uses
   deprecated `document.execCommand("copy")` through a temporary textarea;
   `navigator.clipboard.writeText` is the supported path (Safari 13.1+).
   Chromium 152 reports `ClipboardItem.supports("image/svg+xml") === true`;
   Safari and Firefox do not support SVG on the async clipboard, so text
   fallback is the normal path there. `ClipboardItem` is undefined in insecure
   contexts and older browsers; the code throws on `new ClipboardItem` before
   its own fallback runs.
4. **Canvas sizing depends on Chromium behaviour.** The SVGs have no
   `width`/`height`, so `Image` reports 150×150 (candlestick) or 86×150 (tree).
   The code sizes the canvas from that but calls `drawImage(img, 0, 0)` with no
   destination size. Chromium draws intrinsic-size-less SVG at the canvas size
   (measured: content fills 974 of 1080 px), so it works there; WebKit sizes
   such images differently, so the same call can draw a 150 px image into a
   1080 px canvas. The fix is explicit destination sizing. There is no canvas
   area guard (Safari caps 16,777,216 px) and the height is fixed at 1080.
5. **Serialisation.** `outerHTML` plus string replacement injects `xmlns:xlink`;
   `XMLSerializer` does this correctly. Beautifying the SVG before download
   inserts whitespace into mixed content, which can change text rendering; it
   needs a regression check or removal. Inline `<style jsx>` blocks (RoseSigil,
   candlestick, shewbread) are hoisted to the document by styled-jsx, so the
   exported SVG carries `class="jsx-…"` attributes and no style; the Tree's plain
   `<style>` is exported with its `@font-face` rules.
6. **Dash stripping is currently correct.** The regex removes only inline
   `stroke-dasharray`/`stroke-dashoffset` declarations, which only the RoseSigil
   draw-on animation sets (`stroke-dasharray: 58.4974; stroke-dashoffset: 58.4974;`).
   Without stripping, the exported path is invisible. Attribute dash arrays
   (Da'at's dashed circle, debug circles) are untouched. This should become an
   explicit "animation end state" step rather than a regex on every export.
7. **Fonts.** PNG rasterisation happens in an `<img>` from a Blob, which cannot
   use the page's `@font-face` rules or `next/font` families. The Tree export
   resolves `local('Noto Sans')` only where those fonts are installed (they are
   on this machine, which is why local checks look right). The Enochian export
   references a `next/font` family that exists only in the page; this machine
   has a system "Enochian" font, so the pixel check passed here and would fail
   elsewhere. Candlestick, shewbread and geomancy exports carry no font-family,
   so viewers use their default serif instead of Roboto.
8. **Feedback and accessibility.** Copy actions toast on success and some
   failures; downloads give no feedback and no failure path. Controls are
   `href="#"` anchors used as buttons. Each page mounts its own
   `ToastContainer`; two pages (candlestick, shewbread) mount none, so their
   toasts never appear.
9. **Tree component details.** The DOM has 97 `id` attributes with 75 unique
   values: each path anchor `id` is repeated in the letters group, so exported
   SVGs have duplicate IDs (the server outline strips IDs for this reason).
   `flip` is a CSS `rotateY(180deg)` rule; Chromium applies it inside `<img>`
   (36,212 pixels change when the rule is removed) but most SVG tools ignore
   CSS 3D transforms, so the exported file is unflipped elsewhere; the server
   uses `scale(-1 1)`. The flip and Da'at checkboxes bind `value` instead of
   `checked`, so they show unchecked when the URL says `flip=true`. The chart
   component logs `tetragramPlanets` twelve times per render.

## Findings: routes and renderer

- `componentImageResponse` returns `public, max-age=0, must-revalidate`, no
  `ETag`, no `Content-Disposition`, no `X-Robots-Tag`; every request re-renders
  through WASM. Bad requests are 400 with `no-store`; renderer failures throw
  (500) and stay distinguishable. Both routes and the generated-image catalog
  share `renderComponentImage`; the catalog binds the renderer identity
  (`magickli-tree-image-outlines-v1`, WASM and font hashes), the normalised
  request, the source SVG digest and the output digest into plan v5 metadata,
  and the publication request hash covers the plan hash.
- Consequence for changes: outlined **output bytes** must stay identical for
  existing references (pin the known ritual image, SHA-256
  `00c82f49fa8318986a278ec4f3f3ea49520f9ecdae797c12d011e53475ebfef9`,
  142,962 bytes, as a golden test). Changing the Tree JSX (for example unique
  IDs) changes only `sourceSha256`, which alters catalog metadata and therefore
  a rebuilt plan's request hash while the manifest stays the same; the
  dependency task's `initiate` relaxation replays such retries. Land Tree JSX
  changes after that commit and do not bump the outline profile unless bytes
  change.
- `ritualAssetInventory` recognises only the two Tree paths as generated
  references. New slugs will not become ritual assets; that stays deliberate.
- Deployment tracing already includes `public/fonts/*.ttf` and the WASM for
  `/api/render/*`; new fonts must live in `public/fonts` to be traced.
- Next 16.3.5 route handlers are dynamic when they read `request.url`; CDN
  caching is via standard `Cache-Control` (`s-maxage`, `stale-while-revalidate`);
  `opengraph-image.tsx` files are the framework's own social-preview mechanism
  and can call `renderComponentImage` in process.

## Architecture options

1. **Explicit registry (recommended).** Pure per-slug contract modules
   (`src/render/contracts/*.ts`: parse, canonicalise, defaults, filename,
   viewBox, privacy flag) shared by the client link builder and the server; a
   `server-only` registry (`src/render/registry.tsx`) mapping slug to component
   and outline profile. A test asserts contracts and registry entries match and
   every entry renders the declared viewBox. No dynamic import by request path
   is possible: slugs are object keys checked before any rendering.
2. **Colocated definitions discovered at build time.** Spreads server concerns
   into component files that ship in client bundles, and needs a generator or
   convention scanner for five components. Rejected.
3. **Wrapper only, no links.** Keeps the status quo; loses stable URLs for the
   SEO task and the ritual-style reuse the Tree already has. Rejected.

## Recommended design

- **Wrapper.** Replace `copyPasteExport.tsx` with `src/components/export/ExportControls.tsx`
  taking `target` (SVG ref), `filename`, optional `link` (`{ slug, props }`
  typed against the contract registry) and optional `share` (page URL builder).
  Buttons, `useId`, `XMLSerializer`, explicit animation-end-state step,
  explicit canvas sizing with an area guard, `ClipboardItem` promise values,
  `writeText` fallback, object-URL revocation, disabled state while rendering,
  and one feedback channel. Keep current filenames. `copyPasteExport.tsx`
  remains a thin re-export until the temporary harness is deleted.
- **Direct link meanings.** Image URL: `/api/render/<slug>?<canonical query>`,
  inline `Content-Disposition` with a filename. Download URL: same plus
  `download=1` (attachment). Page link: the interactive page with its state in
  the query (Tree already; geomancy opt-in via `m=`). Controls read "Download",
  "Copy", "Image link" and "Share this page"; the query is canonical (sorted
  keys, defaults omitted, explicit empty values kept where they mean
  something, as `topText=` does).
- **Server.** Generic route over the registry, unchanged Tree bytes, `ETag`
  (output SHA-256) with `If-None-Match` → 304, `Cache-Control:
  public, max-age=0, must-revalidate, s-maxage=86400, stale-while-revalidate=604800`
  (bytes change only on deploy, which purges the edge), `X-Robots-Tag: noindex`
  on personal-state slugs, existing limits and 400 behaviour retained.
- **Fidelity policy.** Live-DOM exports keep editable text and links; server
  images keep outlined glyphs (offline-stable, validator-compatible). Each new
  slug ships with glyph-coverage fixtures and a documented DOM-vs-server visual
  comparison; Safari behaviour is stated as untested where no device is
  available.

## Implemented

- `src/components/export/ExportControls.tsx` replaces the old wrapper on all
  six pages, with `svgExport.ts` (serialisation, animation end state, unique
  ids, raster sizing) and `exportRuntime.ts` (canvas, downloads, clipboard).
  Verified in Chromium 152: SVG and PNG downloads carry one namespace
  declaration and 98 unique Tree ids, the PNG decodes at 1168×2048, and both
  clipboard writes hand the right MIME types to the browser. The automation
  sandbox refuses clipboard permission, which exercised the error message;
  a Safari device check is still outstanding. The old `copyPasteExport.tsx`
  module is removed; its only remaining importer was the dependency task's
  temporary toast harness, which has since been deleted.
- `src/render/contracts/` holds the pure per-slug contracts (`tree-of-life`,
  `astro-geomancy-chart`, `enochian-tablet`, `seven-branched-candlestick`,
  `rose-sigil`); `src/render/registry.tsx` is the server-only slug-to-JSX map;
  `componentImageUrl.ts` builds canonical links. The generic route keeps the
  Tree's bytes: the published ritual reference still produces 142,962 bytes
  with SHA-256 `00c82f49fa8318986a278ec4f3f3ea49520f9ecdae797c12d011e53475ebfef9`
  under the unchanged `magickli-tree-image-outlines-v1` identity, and the
  generated catalog's request type is now explicitly the Tree's.
- Responses add `ETag` with `If-None-Match` → 304, `Content-Disposition`
  (`download=1` for attachments, RFC 8187 names for Hebrew sigil text),
  `Cache-Control: public, max-age=0, must-revalidate, s-maxage=86400,
  stale-while-revalidate=604800`, and `X-Robots-Tag: noindex` for the two
  personal slugs. Bad requests stay 400/`no-store`; renderer failures still throw.
- The sigil layout optimiser moved to `roseSigilGeometry.ts` with a fixed
  evaluation cap; the server passes the optimised points into a hook-free
  `RoseSigilImage` that both sides draw. Each side is deterministic, but the
  two are not bit-identical: for `גדי`, Chromium 152 and Node 25 place the
  points within about one unit of each other on the 100-unit canvas because
  COBYLA's floating-point trajectory differs between engines. A sigil link
  therefore reproduces the same sigil, not the same pixels as the page. The reading and sigil pages
  restore shared state from the query through Suspense wrappers and only
  write URLs when the reader copies a link. The Tree page fixes its flip and
  Da'at checkboxes and serialises `fontSize=10` explicitly.
- Deferred until fonts arrive: Enochian glyphs on the server (contract accepts
  `id` only) and the table of shewbread (four colour emoji need a bundled
  monochrome emoji font; without one they render as empty boxes).

## Adversarial review

An independent review (web-application profile) found no defects in the
constrained areas: Tree request parsing was fuzzed against the previous parser
over 40,000 queries with identical JSON and errors, no request input reaches a
dynamic import, file path or unbounded allocation, and the clipboard chain
stays inside the user gesture. Its findings were applied:

- The share-link pages resolve the query on the server (`page.tsx` reads
  `searchParams` and passes initial state), so their HTML carries the shared
  state instead of an empty Suspense shell. The Tree page keeps its older
  client-side `useSearchParams` shape; its prerendered HTML is therefore still
  empty, which the SEO task should address alongside its metadata work.
- The personal-state warning derives only from the linked contract; the Tree
  page explains the one state without a link (Da'at in the King scale).
- All export buttons disable while any action is pending; unexpected errors
  report "Export failed." rather than a PNG message; an unobserved raster
  promise is caught when the clipboard is unavailable.
- Loading the sigil optimiser removes the process-wide abort handlers that
  its Emscripten glue installs, which would otherwise replace later server
  diagnostics with a WASM abort message; the outline resource cache no longer
  pins a failed load; sigil animation names are scoped per instance.
- Tests now cover React's literal `xmlns` attribute, `download` as a rejected
  render key, attachment/inline ETag parity, glyph-coverage path floors for
  each new slug, two linked instances, and the share-only page.

Residual risks: `/api/render/rose-sigil` costs roughly 60–330 ms of CPU per
distinct text (3 to 32 letters) with no rate limiting anywhere in the app, and
the ETag is computed after rendering, so 304 responses save bandwidth only.
Explicit `width` and `height` with a different aspect ratio crop (`fit: cover`),
as the Tree route always did. Links to the new slugs pasted into rituals stay
unrecognised by the asset inventory by design; the editor does not yet say so.

## Phases

1. Wrapper rewrite and page migration; jsdom tests for multiple instances,
   clipboard failures and fallbacks, download anchors and revocation, canvas
   guard, feedback; browser verification in Chromium.
2. Contracts and registry refactor with the golden Tree byte test, generic
   route headers, canonical URL builder, Tree page link controls, the flip
   and Da'at checkbox fix, unique IDs (after the dependency commit).
3. New slugs by decision: geomancy chart (plus reading-state restore and
   share link), Enochian tablet, candlestick, shewbread; fixtures, visual
   comparison, tracing of any new fonts.
4. SEO handoff: canonical image URLs, indexing policy, `og:image` reuse
   guidance, no sitemap or robots changes here.

## SEO handoff

- Canonical image URLs are `/api/render/<slug>` plus the contract's canonical
  query (defaults omitted, contract key order, `fmt=png` first for PNG);
  `componentImagePath` produces them and tests round-trip every sample.
  `/api/treeOfLife` remains an alias with identical bytes and headers; new
  content should reference `/api/render/tree-of-life`.
- Indexing policy: images for `tree-of-life`, `enochian-tablet` and
  `seven-branched-candlestick` are public and cacheable; `astro-geomancy-chart`
  and `rose-sigil` responses carry `X-Robots-Tag: noindex` because their query
  is user state. Nothing changes in `robots.txt` or the sitemap; the route is
  not a page and needs no sitemap entry.
- Social previews: `renderComponentImage` can be called in process from an
  `opengraph-image.tsx`, or a page's `openGraph.images` can point at a canonical
  PNG URL with explicit `width`/`height` (the renderer keeps the viewBox aspect,
  so a 1200×630 card needs padding by the caller). Keep `og:image` URLs free of
  personal state.
- The pages for the tree, tablets, candlestick and shewbread are already in the
  sitemap; the geomancy reading and sigil pages are too and now accept state in
  the query, which should stay excluded from canonical page URLs.

Each phase runs `pnpm check`, `pnpm typecheck`, `pnpm test` (new render
modules join the per-file coverage list), `pnpm build`, `loom check`, and an
adversarial review before its commit.
