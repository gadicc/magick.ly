# Durable ritual bundles

The image plan now resolves every image in the verified corpus. A prepared bundle
binds that evidence to exact selected ritual content. SQL publication and the
current-access reader now preserve that binding durably. Private object storage,
authenticated delivery and browser activation remain the next integration steps.
Neither preparation nor publication grants an offline lease.

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
preparation. The publisher persists those IDs before provider writes and never
allocates replacements after an uncertain acknowledgement.

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

## Implemented publication and current-access reads

Use app-owned bundle storage rather than Loom Files rows: shared static, legacy
and generated snapshots require separate ritual-scoped copies, whereas Loom Files
has a global digest uniqueness and uploader-ownership contract. Avoid cross-ritual
blob deduplication initially.

Migration `0011_ritual_bundles` adds three app-owned tables:

| Table | Responsibility |
| --- | --- |
| Publication intents | Immutable operation/request hash, actor, exact manifest/private plan and selected output, bounded claim, retained completion timestamp |
| Bundle assets | Reserved per-bundle UUID key, exact byte/MIME/hash and private location; complete verified receipt fields are populated atomically at publication |
| Ritual bundles | Minimal completed delivery marker bound to its intent and the ritual's own revision |

`createSqlRitualBundlePublisher` reserves the immutable intent and all destinations
in one transaction before any provider write. Pending asset rows confer no access.
Destinations are unique within the bundle store; they must use a separate provider
namespace from Loom Files. The request hash binds operation, actor, manifest, plan
and explicit publication policy. A same-operation retry reuses the original IDs
and destinations; a changed payload or policy requires a new operation.

Each operation verifies the session and reloads persisted identity/grants. The
write transaction uses operation advisory locks, principal/grant locks and a
parent share lock, then verifies current read access and the exact selected body,
title and descriptor. Intents last at most 24 hours; replaceable worker claims
last at most 120 seconds and cannot outlast the intent. Neither interval is the
14-day offline retention policy. Stale workers cannot release a replacement claim.

Publication requires every exact reserved object receipt under the current claim.
Receipt hashes, location, byte/MIME facts and verification times are checked;
receipts must come from a trusted storage adapter, never client claims or provider
ETags alone. All receipts, the intent's completion timestamp and the delivery
marker commit together. No provider operation runs inside SQL. A changed selection
or revoked access leaves unpublished reserved work for later reconciliation.

Completed retries recheck current access, selection and all stored evidence before
returning the existing receipt. They neither renew a lease nor recreate missing
resources. The intent retains completion evidence after marker deletion, including
for zero-image bundles; otherwise a lost acknowledgement could revive a removed
bundle. Historical pending selection IDs are not foreign keys to mutable current
pointers. The completed marker uses a non-null composite binding to the intent
and an own-ritual revision foreign key, avoiding nullable artifact columns that
would bypass the whole composite constraint.

`createSqlRitualBundleReader` selects only completed publications matching the
currently authorized output and an explicitly accepted publication policy. Each
call uses a read-only repeatable-read snapshot. An omitted bundle ID selects the
newest accepted current publication deterministically; corrupt selected evidence
fails closed without fallback to an older bundle. The shared decoder rechecks
manifest/plan/request hashes, complete occurrence mapping, validation facts,
reservations and historically fenced receipts. Generic missing, denied, stale or
operational results are not authoritative offline revocation responses.

The manifest projection excludes private plan/provenance and provider locations.
The asset projection is an internal server descriptor, not a browser capability.
Its future transport must verify current session/policy and
exact bundle/asset membership, read bounded stored bytes outside SQL, then recheck
access before exposing them. Knowing a UUID or holding an offline lease never
authorizes a server download. Future protected attachments additionally require a
live file/link and occurrence in that authorized rendered context.

The delivery envelope must bind account, request, lease, descriptor and published
manifest identity. Extend Dexie storage to retain occurrence mapping and verify
that same-bundle renewal only renews the same manifest. A changed bundle that
fails to download cannot extend old bytes. Source/edit grants remain independent.

Private R2 configuration, the exact-byte storage adapter, SQL/auth import and
runtime activation remain pending. No HTTP endpoint, public caching rule or
active reader changed in this unit.

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

### Durable SQL checkpoint

The publication unit adds 305 tests: 61 database constraint cases, 40 exact receipt
cases, 118 publisher cases and 86 reader/decoder cases. All 2,747 default tests
pass (14 opt-in Mongo cases skipped); 70-module coverage gates pass at 98.39%
statements, 97.20% branches, 99.89% functions and 99.37% lines. Types, Biome,
ordinary Loom check and production build pass with existing warnings.

Independent adversarial review reproduced one timing defect: an awaited SQL write
could finish after a claim expired while the service retained its earlier clock
value. New in-transaction checks after reservation writes, claim update and marker
insert reject expiry or clock rollback before returning from the transaction
callback. Eight regression cases cover delayed acknowledgements and completed
replay. Completed historical receipts remain recoverable after intent expiry,
subject to fresh access and selection checks.

The final exact-source rehearsal uses PostgreSQL 15.17 through Loom 1.24.0's actual
`neonFull`/postgres-js/Drizzle path. Twenty scenario checks, aggregate reconciliation
and an unchanged migration rerun pass. It exercises real lock interleavings,
grant revocation, reader snapshots, atomic visibility, lost acknowledgements,
missing empty-bundle markers and the delayed-write clock regressions. All twelve
migration journal rows and 32 public tables remain identical across rerun; the
actual lock timeout returns safely after 5,009 ms. All five supported image MIME
types use actual prepared synthetic bytes. No provider or production calls occur;
every fresh owned rehearsal database is dropped and verified absent.

All 76 source fingerprints match before and after the final run. Evidence:
`/tmp/magickli-bundle-postgres-rehearsal/README.md` and `result.json`, source
manifest SHA `23e185a3fcc78e49f78aebb05520bfc97112764c07195e004c7d514490e95796`,
publisher SHA `fd4a9e53bc292c5a1534c3af5fdb4ee9ba6bf335113457808086bcec6e9302c6`,
and `/tmp/magickli-bundle-final-{coverage,types,loom}.log`. A preliminary harness
attempt exposed a tsx CommonJS namespace/default import mismatch; correcting that
test harness required no application change. These checks prove SQL behavior, not
private provider configuration or actual object persistence.
