# Durable ritual bundles

The image plan now resolves every image in the verified corpus. A prepared bundle
can bind that evidence to exact selected ritual content, but preparation does not
publish anything or grant offline access. Durable publication and the authorized
reader described below are the next implementation unit.

## Implemented preparation and wire format

`createRitualRenderDescriptor` shares the existing permission checker's exact v1
digest calculation. Its parent, current revision/version/artifact and selected
content must come from one authorized SQL snapshot. The extraction preserves the
existing digest ordering and four-field wire projection; readers receive no
revision tokens or source history through the descriptor.

`prepareRitualBundle` accepts that selected body/title/descriptor and a trusted
owned complete asset plan. It verifies the plan and content digests, rejects gaps,
maps transient asset indices to UUIDv7 keys, and rehashes every owned byte copy.
Caller-supplied reserved IDs permit an identical retry; omitted IDs start a new
preparation. A future publisher must persist the IDs before provider writes and
must never allocate replacement IDs after an uncertain acknowledgement.

Preparation returns `kind: "prepared"`, a frozen manifest, exact manifest JSON
and SHA, private plan/provenance, and a disposable byte-copy capability. The wire
manifest excludes private acquisition provenance, provider locations, account,
request and lease claims. Disposal wipes retained byte buffers; independent
returned copies survive. JavaScript metadata/text lifetime still follows retained
references and garbage collection. Abort, deadline or a failed later copy wipes
earlier retained buffers. The 30-second deadline is cooperative, including around
synchronous hashing, and may only be tightened.

Manifest v1 carries bundle/ritual UUIDv7 IDs, the opaque rendered descriptor,
exact title and rendered JSON, read-only asset entries, and every source image
occurrence. Each occurrence preserves its child path, original `src`, exact
display fragment and asset UUID. Asset entries retain the original network
reference, SHA, MIME and size. This supports repeated references and the existing
task/footnote rendering rules without rewriting the protected archive.

The manifest SHA covers the exact UTF-8 bytes produced by `JSON.stringify` of the
envelope. The strict portable parser rejects alternate outer serialization,
duplicate keys, unsupported fields/profiles and mismatched expected bindings. It
preserves nested title/body strings exactly, including whitespace, combining
characters and embedded BOMs. It independently enumerates the rendered JRT and
requires a complete one-to-one source-path mapping with no unused assets. Declared
logical local paths provide display-only inventory membership; they confer no
URL-fetch, storage or private-file authority. The parser performs no I/O and
does not decode image pixels; byte validity comes from acquisition and is checked
again when actual downloads are installed.

Bounds are 16 MiB for the manifest, 4 MiB for rendered JSON, 64 KiB for title,
1 MiB per reference, 512 assets/occurrences and 64 MiB total declared image bytes.
An individual raster is at most 20 MiB and SVG at most 4 MiB. These are wire and
capture limits, not total process memory or SVG paint-cost guarantees. The parser
copies its expected delivery binding before its first await and returns a deeply
frozen independent projection. A valid manifest alone must never feed
`acceptPermission(..., bundleId)`; only a separately validated authorized
publication response may do that.

## Next: publication and current-access reads

Use app-owned bundle storage rather than Loom Files rows: shared static, legacy
and generated snapshots require separate ritual-scoped copies, whereas Loom Files
has a global digest uniqueness and uploader-ownership contract. Avoid cross-ritual
blob deduplication initially.

The proposed SQL boundary has three tables:

| Table | Responsibility |
| --- | --- |
| Publication intents | Immutable operation/request hash, actor, target descriptor, preallocated IDs/locations, bounded claim and completion receipt |
| Ritual bundles | Completed exact body/title/manifest, manifest SHA, selected revision/artifact binding and private plan evidence |
| Bundle assets | Per-bundle UUID key, exact byte/MIME/hash, owned private location and verified storage receipt |

Pending work lives only in intents. Persist an immutable intent before conditional
private object writes. Reconcile only its exact owned keys by bytes and provenance.
Keep provider I/O outside SQL. Reverify the session before finalization; inside a
short transaction use the existing operation/principal/grant/parent locking
conventions, then check current read access, selected descriptor/title, current
claim and all expected receipts. Publish bundle/assets and complete the intent
atomically. A changed selection or revoked access leaves unpublished owned objects
for reconciliation. Completed replay must recheck access/selection and existing
rows; it must not resurrect removed or stale resources.

The paired reader must select only completed publications matching the currently
authorized output. Its asset transport must verify current session/policy and
exact bundle/asset membership, read bounded stored bytes outside SQL, then recheck
access before exposing them. Knowing a UUID or holding an offline lease never
authorizes a server download. Future protected attachments additionally require a
live file/link and occurrence in that authorized rendered context.

The delivery envelope must bind account, request, lease, descriptor and published
manifest identity. Extend Dexie storage to retain occurrence mapping and verify
that same-bundle renewal only renews the same manifest. A changed bundle that
fails to download cannot extend old bytes. Source/edit grants remain independent.

Private R2 configuration, SQL/auth import and runtime activation remain pending.
No HTTP endpoint, public caching rule or active reader changed in this unit.

## Verification

The unit adds 132 tests: 43 preparation cases, 79 manifest cases and ten descriptor
regressions. All 2,442 default tests pass (14 opt-in Mongo cases skipped), with
66-module coverage gates at 98.31% statements, 97.02% branches, 99.88% functions
and 99.34% lines. Types, Biome, ordinary Loom check and production build pass.
TypeScript required the `never` error helper to be a function declaration for
control-flow narrowing; its runtime behavior is unchanged.

Independent real catalog/plan/preparer/parser probes verify exact body/descriptor,
stable retry IDs, new IDs, query/fragment mapping, disposal ownership and
cancellation cleanup. The final read-only corpus run prepares and reparses all
five archived and three built-in trees. It verifies all copied bytes after source
plan disposal, then disables further copies on preparation disposal. All 21
backups, 15 public images and three builtin source hashes remain unchanged. The
script writes no protected manifest, body, full references or object bytes.
Evidence: `/tmp/magickli-prepared-plan-acceptance.json`,
`/tmp/magickli-tree-render-review/prepare-report.json` and
`/tmp/magickli-prepared-{full-coverage,types,biome,loom,build}.log`.

Twelve native parser scenarios pass in Chromium 152.0.7977.82 with Playwright
1.62.1, covering exact strings, all five MIME declarations, missing/swapped
occurrences, identity/hash tampering, frozen ownership and mutation of expected
bindings while real SHA-256 completion is delayed. All 28 digest calls use native
ArrayBuffer crypto. Only the two owned fixture GETs occur; no other network,
storage, permission or object-URL API calls, page errors or console errors occur.
The owned server/browser are closed. This is parser acceptance, not pixel decode,
installed-device readiness or iOS evidence. Report:
`/tmp/magickli-manifest-browser/README.md`, result SHA-256
`2fe44294187474198a5f9274c887082e1700ee5573e6ac4db9d4721c0b05abd4`.
