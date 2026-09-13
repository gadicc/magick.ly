# Remaining ritual image acquisition

Read-only findings from September 13, 2026. These are acquisition/renderer
evidence, not deployed fixes, durable asset receipts or complete download bundles.
See [the offline contract](006-private-offline.md) for the implemented static and
inline resolution plan and the required permission/lifecycle integration.

## Implemented legacy public-image reader

`createLegacyRitualImageCatalog` accepts trusted current file/archive pairs and
explicit R2 configuration. Before any GET, it bounds the entire input and
reconstructs each import using the existing BSON/EJSON planner. Exact archive
serialization, typed identity, file ID, digest, size, served MIME, location and
public/null-owner/nondeleted state must agree. Batch collisions and sparse or
malformed rows fail before I/O. Later descriptive metadata changes are allowed.

The reader uses only recorded keys; it never infers a prefix from the bucket or
endpoint. SDK retries/region redirects are disabled. Successful bodies and SDK
error XML have bounded allocations, with per-request and whole-catalog deadlines,
abort cleanup and late-body disposal. A failed request produces safe incomplete
evidence. The default compressed budget is 64 MiB, with 128 inputs, 1 MiB of EJSON
per input and 4 MiB total; limits can only tighten. Native raster and closed SVG
validation retain their existing per-image bounds. These are capture limits, not
a total process-memory or SVG-paint guarantee.

Actual read-only acceptance passed all ten legacy objects: three JPEGs and seven
SVGs, exactly 7,790,234 bytes. Captured sizes/digests and the historically served
Mongo MIME values agree; storage MIME headers remain irrelevant to byte identity.
Owned copies, disposal and metadata exclusion of archived source/provider
locations were verified. All 21 backup fingerprints are unchanged. No object
bytes, private references, credentials, durable aliases or database writes were
retained. Evidence: `/tmp/magickli-legacy-catalog-acceptance.json`.

The static and legacy catalogs now share the unchanged validation identity
`cd11c8765f14de5253e312c69be35cf9a55193c237b4afc811a3d29044a0957c`.
The optional legacy capability is now integrated into
[ritual asset plan v2](006-private-offline.md#legacy-public-images-in-plan-v2).
All six archived legacy occurrences resolve without changing their references.
The live file route and new private attachments remain separate; durable
manifests and authenticated bundle delivery are still required.

## Existing external images

The four exact external references were extracted in memory from the verified
backup. Requests used HTTPS certificate verification, public IPv4 DNS checks with
a pinned address, no redirects, a 20-second request deadline and a 20 MiB body
limit. No credentials, cookies or referrers were forwarded. Only metadata and
digests were retained; no full URLs, source text or image bodies were written.
All 21 backup fingerprints remained unchanged.

| Existing host | Outcome | Fully decoded raster |
| --- | --- | --- |
| `churchofgod.wiki` | HTTP 200 | JPEG, 94,196 bytes, 1,000 × 700 |
| `i.pinimg.com` | HTTP 200 | JPEG, 178,364 bytes, 736 × 1,060 |
| `hermeticgoldendawn.org` | HTTP 200 | GIF, 11,891 bytes, 129 × 285, one frame |
| `upload.wikimedia.org` | Old 800px thumbnail fails | See replacement below |

Wikimedia first returned 403 to a request without a User-Agent. After checking
its [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy),
one honest identified-client retry returned HTTP 400. The saved URL uses an 800px
Commons thumbnail, with a matching original filename and no query. Wikimedia
now [requires standard thumbnail widths](https://www.mediawiki.org/wiki/Common_thumbnail_sizes);
its [rollout record](https://phabricator.wikimedia.org/T414805) documents HTTP 400
for nonstandard widths. This explains the observed result; no browser spoofing or
access-control workaround was attempted.

One read of the same file at 960px returned HTTP 200: JPEG, 47,084 bytes,
960 × 530, one frame. Digest:
`1a0c0d8f0edc4d60c92f0118db05b497eef5d1e9d19e19c1194496a747c8858f`.
This is a replacement representation, not byte parity with the unavailable 800px
thumbnail. The original ritual reference remains unchanged. Future acquisition
must retain both references and replacement provenance, and preserve any explicit
display dimensions; thumbnail width alone is not an HTML display width.

Reports: `/tmp/magickli-external-images-initial.json`,
`/tmp/magickli-external-images-wikimedia.json` and
`/tmp/magickli-external-images-wikimedia-standard.json`. The client identifies as
`MagicklyOfflineMigrationBot/1.0 (+https://magick.ly)`.

This preflight is not a production fetching service. DNS resolution has no
separate overall timeout; the request deadline starts after DNS. Production
acquisition needs an overall deadline, approved exact references, durable
byte/digest/provenance records and current authorization. Do not turn these four
hostnames into a generic URL proxy or promise their future availability.

### Implemented fixed-reference external reader

`createExternalRitualImageCatalog` now captures the four reviewed originals by
exact reference fingerprint and pinned acquired size/SHA/MIME. Unknown hashes
never trigger DNS or HTTP. It does not accept caller-defined policies, transport
callbacks or replacement URLs. Only the pinned Wikimedia original permits the
verified 800px-to-960px same-file transformation; metadata binds both original
and acquired reference fingerprints and explicitly names the representation.
Raw references are not stored in catalog metadata, and archived JSON is unchanged.

Acquisition uses a private DNS resolver with explicit timeout/tries and an overall
request deadline that includes DNS. Every returned A address must pass IPv4 syntax
and conservative public-address checks; one checked IP is pinned for a fresh
HTTPS connection while hostname/SNI and certificate verification are preserved.
No redirects, cookies, credentials, referrers or connection pool are used. The
honest User-Agent above remains unchanged. Header size is capped at 16 KiB;
non-200 bodies are destroyed without collection. Successful bodies use one
pre-budgeted exact allocation, check Content-Length when supplied, and must match
the expected actual size/SHA before native
full-frame validation and expected-MIME agreement. The 64-reference/16 KiB-input,
1 MiB-capture, 20-second-request and 90-second-catalog maxima can only tighten.
Late DNS answers, response callbacks and data cannot populate a finished capture.

The network design follows the [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
on strict destinations and address validation. The default
[Node HTTPS agent](https://nodejs.org/api/https.html#httpsglobalagent) has pooling;
an independent Node 24.19.0 no-network probe verified that `agent: false` creates
a separate connection without inheriting ambient proxy configuration. The owned
[DNS resolver](https://nodejs.org/api/dns.html#class-dnspromisesresolver) is canceled
with the request rather than left running after a timed-out promise.

Actual read-only acceptance captures all four expected raster representations,
331,535 bytes total, with their pinned hashes and MIME values. Copy ownership,
disposal and all 21 unchanged backup fingerprints pass. No image bytes or raw
references were retained. Evidence: `/tmp/magickli-external-catalog-acceptance.json`.
Catalog SHA: `31884a5183b0c6425e272eb43ea8d45adabc3207f577b26cb170ba550b433944`;
policy SHA: `e223e1728f39f4598a890154bb19fdca6301c76d1dcc94728abf4b2a942f1a17`.
The shared validator identity remains unchanged. The optional capture capability
is integrated into [plan v3](006-private-offline.md#external-images-in-plan-v3),
resolving all four archived external occurrences and both public occurrences.
Durable publication and private offline activation remain separate gates.

## Generated Tree of Life fonts

The current route emits SVG with external Noto font declarations. A probe used
the existing public `2=9.jade` query against the local production build and created
a separate in-memory derivative. Only the two known font URLs changed to inline
font data, and `local(...)` alternatives were removed from that derivative.
The original route, component, source and font files were unchanged.

The original SVG is 32,186 bytes; the derivative is 675,935 bytes. Diagram geometry
and text are unchanged. Embedded fonts intentionally change text pixels from the
existing image-context fallback. Original and derivative digests:

- Original: `6343d71fd423d1afa7574764fe64f80a5e804e5e4d59905a25e19179eef8c93b`
- Derivative: `83b5665fbd7826da89ef7ccae30849ead890128d51b77d23e78c6c05c2b0f838`

Chromium 152 rendered the derivative offline, with service workers blocked and
the HTTP cache cleared/disabled, without external requests or page errors.
The first probe compared immediately after `image.decode()` and failed:
consecutive images had different text pixels while embedded fonts loaded.
Repeating after a bounded 500ms settle produced identical derivative pixels.
This establishes feasibility and exposes a readiness race. A fixed delay is not
a production readiness protocol or cross-browser guarantee.

The screenshot was visually inspected; labels and Hebrew text remain readable.
Evidence: `/tmp/magickli-tree-font-probe-initial.json`,
`/tmp/magickli-tree-font-probe.json` and the ignored public-only screenshot
`output/playwright/tree-font-probe/fonts.png`.

### Shared component-image renderer

The canonical `/api/render/tree-of-life` route and legacy `/api/treeOfLife` now
delegate to one closed renderer. Only this component is registered. Source field
names come from the interactive page and actual grade/ritual callers; ordered
comma lists and explicit empty top/bottom labels are preserved. The parser
converts true/false explicitly, accepts known highlights and King/Queen colors,
and separates output format from component props. Arbitrary labels, callbacks,
unknown/repeated keys, unsupported formats and unbounded dimensions return 400.
Da'at has no King-scale color in the existing data; that combination also returns
400 rather than inventing a color or crashing. Direct component callers retain
their existing props and CSS dimensions.

`@resvg/resvg-wasm` 2.6.2 outlines the trusted JSX output into the versioned
`magickli-tree-image-outlines-v1` representation. It receives explicit bundled
font bytes with default size 16, matching the browser's inherited path-letter
size. It does not receive uploaded SVG or fetch fonts. Next's private bundled
converter was rejected after it silently dropped text with supplied fonts.
Embedding font data alone was also rejected for image output: neither
`Image.decode()` nor parent-document font readiness reliably waited for fonts
inside an SVG image.

The representation retains the original centered viewBox and outer sizing.
Normalization changes curve/antialiasing details slightly; it is not a claim of
pixel equality with browser text. Independent review found all 52 labels,
including 20 curved labels, within the known ritual's viewport with no observed
Hebrew reordering or clipping. It removes inert duplicate link IDs and expresses
hidden text-path carrier geometry as `display="none"`. Independent comparison
found zero differing pixel channels for that visibility adjustment. The shared
SVG validator remains unchanged. Flip uses an SVG reflection around the centered
coordinates, after outlining, instead of unsupported CSS 3D transforms.

Devanagari, Symbols and Symbols 2 join the existing Sans/Hebrew fonts. All three
are required to cover the existing chakra and grade field glyphs; their source
URLs, hashes and upstream OFL notices are committed under `public/fonts`.
The service returns normalized request props, source SVG digest, font/WASM
provenance and the final representation's byte size/digest. SVG remains SVG;
PNG explicitly rasterizes that same outlined image. URL images contain outlined
text and no navigation links. The interactive component and live-DOM export
controls retain their existing editable text and links.

Width/height are positive integer pixels, at most 4,096 on either axis and
4,194,304 effective pixels, including the derived dimension when one is omitted.
Font size is 1–128 with up to two decimal places. These replace accidental
unbounded query forwarding. Source data and saved ritual references are not
rewritten. The route no longer changes global Fontconfig state or logs local
font configuration. WASM and fonts are included in both route traces as server
assets; the package stays outside the webpack bundle. The first build exposed
webpack interpreting `require.resolve` as a WASM import, so loading now uses the
explicit traced runtime path instead of a build-machine source path.

Actual production-build acceptance passes 38 valid cases, five refused cases,
identical legacy/canonical/repeated SVG bytes in the same process, all SVG
compatibility checks, and decoded PNG dimensions. The known ritual image is
142,962 bytes, 229 elements, SHA-256
`00c82f49fa8318986a278ec4f3f3ea49520f9ecdae797c12d011e53475ebfef9`.
Chromium 152 cold/offline acceptance compares five actual component fixtures:
the ritual, Devanagari chakra names, elemental symbols, planetary symbols and
GradeTree. Each has 30 identical immediate/animation-frame samples across three
fresh Blob images, with zero HTTP requests or page errors. Original intrinsic
86×150 image sizing is retained; comparisons draw at 341×598. The font-loaded
source and outlined image screenshots were visually inspected. This is local
Chromium evidence, not an iOS device test or a Vercel latency measurement.

Evidence: `/tmp/magickli-tree-api-acceptance.json`,
`/tmp/magickli-tree-browser-acceptance.json`, the ignored public screenshot
`output/playwright/tree-render/comparison.png`, and independent review/probes in
`/tmp/magickli-tree-render-review/`. The permanent tests pin all five fonts and
accepted outline fingerprints for each script/symbol group; a generic nonempty
Latin fixture alone would miss partial glyph loss.

Generated catalog/plan integration and durable authorized publication remain
pending. The other clipboard/download widgets also remain a separate unit:
several export completed client-side state, so adding their slugs without a
server rendering contract would produce incomplete output.
