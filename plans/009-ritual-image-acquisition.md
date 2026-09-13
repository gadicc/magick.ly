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

The generated-image adapter still needs a versioned, closed query/props contract,
explicit font provenance, rendering/settling acceptance and durable output bytes.
The route's arbitrary query forwarding and PNG/fontconfig path also need
consolidation with the future whitelisted component-render route. Do not broaden
the preserved SVG validator to accept arbitrary external fonts, silently rewrite
compiled archives, or substitute PNG for an SVG reference.
