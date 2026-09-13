# Protected backup import preflight

The 2026-09-12 backup passes the current pure auth, membership, ritual and study import planners with the two reviewed exceptions in the [migration contract](003-data-migration-contract.md). The preflight read BSON in memory, used disposable UUIDv7 allocations, and made no database writes or provider requests. All 21 manifest-listed files and the manifest matched their fingerprints before and after; no production mappings or private fixtures were retained.

## Results

The backup contains 190 documents across 10 collections. A separate metadata inventory found 10 images: 3 JPEG and 7 SVG, all with valid creation dates and no owner field. Stored image formats, MIME types and byte sizes agree. Legacy SVG links must remain supported independently of the new-upload format allowlist.

| Boundary | Preserved result |
| --- | --- |
| [Auth normalization](../src/migration/normalizeLegacyAuth.ts) and [auth import](../src/migration/planBetterAuthImport.ts) | 12 users, 12 provider identities, 13 email records; no shared-email collisions. One obsolete strategy configuration excluded and 36 sessions discarded. Five missing historical creation dates remain explicit. |
| [Membership import](../src/migration/planLegacyMembershipImport.ts) | 1 group, 2 combined membership/admin grants, 1 temple, 1 protected invite and 7 temple memberships, including grade zero. The global access projection retains 1 administrator. |
| [Ritual import](../src/migration/planLegacyRitualImport.ts) | 5 rituals, 59 revisions and 5 exact original compiled archives. One unresolved creator remains nullable with explicit evidence; the current revision author is not substituted. |
| [Study import](../src/migration/planLegacyStudyImport.ts) | 49 source rows become 48 active baselines and 1 protected duplicate archive. All 49 full EJSON snapshots and hashes match the source. |
| [File metadata import](../src/migration/planLegacyFileImport.ts) | 10 public file rows, 10 exact protected EJSON snapshots and 10 typed aliases; original fields and null ownership retained. Canonical R2 reads and a production-config-bound in-memory plan verify all ten prefixed keys. Durable aliases/location writes remain outstanding. |
| [Discourse link import](../src/migration/planLegacyDiscourseImport.ts) | 12 canonical user projections account for 7 exact numeric links to the reviewed source forum origin, 5 missing links and 0 null links. No email merging or external UUID conversion. |

No new source-shape rejection required a mapper or schema relaxation.

The Discourse pass verifies all twelve typed user aliases and original property
presence, preserves each numeric link and binds the explicit reviewed source
origin. Identical repeat planning passes. All 21 backup files (767,839 bytes),
the manifest and decoded inputs remain unchanged; UUID mappings are disposable
in-memory values only. Only aggregate evidence was saved, with no database or
provider calls. Evidence:
`/tmp/magickli-discourse-import/preflight/report.json`, SHA-256
`a831ce1d8d16ae4c064e8bbb79ff1dbb81c9f7e87be1633b297c4a8f45161a30`.
This closes a concrete omission in the auth-only projection, not a claim that
runtime Discourse actions or durable import have switched to SQL.

The separate file planning pass reads the same protected backup in memory and
retains only aggregate results. An identical rerun produces the same plan with
disposable aliases; all source values and the 21 backup fingerprints remain
unchanged. It does not inspect stored object bodies or infer a production bucket.

A subsequent read-only pass on 12 September fetched the ten existing
`https://magick.ly/api/file2?sha256=...` URLs without authentication. All returned
HTTP 200 and the expected MIME type; streamed byte sizes and SHA-256 hashes
matched every backup file record exactly, totaling 7,790,234 bytes. Streams were
bounded by each expected size and a deadline. No raw image bytes were retained,
no provider/database write ran, and all 21 backup fingerprints remained unchanged.
Evidence: `/tmp/magickli-file-object-preflight/public-route-report.json` and its
runner. This proves current public delivery, not an object-body backup, direct
bucket access, storage policy/CORS or private-upload readiness. Local env loading
found no AWS/S3 configuration at that checkpoint.

A subsequent authenticated Vercel CLI read loaded the existing Production storage
configuration in process. The actual endpoint is Cloudflare R2. Direct HEAD/GET
verified the same ten sizes and hashes, totaling 7,790,234 bytes, with no raw
object bytes retained, no provider writes and all backup fingerprints unchanged.
Evidence: `/tmp/magickli-file-object-preflight/report.json`. The configured signing
region `weur` is not evidence of physical placement. All ten object MIME headers
differ from Mongo metadata; the compatibility route must retain the original
Mongo MIME precedence. Unsupported/not-found bucket-policy and CORS probes do
not establish privacy or missing policy. See the [Files contract](008-protected-ritual-files.md)
for the verified resource fingerprint and remaining provider acceptance gates.

An aggregate-only traversal of the five exact stored compiled trees accounts for
17 image nodes and 17 distinct references: six legacy file URLs, four local
`/pics/` images, four external images, two inline data images and one generated
tree-of-life diagram. All six legacy hashes resolve to file metadata. No non-image
`src` fields or CSS `url()` references occurred in these trees. This pass made no
resource requests and left all backup fingerprints unchanged. Evidence:
`/tmp/magickli-protected-preflight/asset-inventory.json`. Renderer fonts and future
source edits still need their own dependencies accounted for; the four external
images require an explicit supported fetch policy before complete offline Ready.
A follow-up child-graph inventory finds zero stylesheet nodes and no image below
the known non-rendering containers; all 17 structural images occur in the child
graph. Evidence: `/tmp/magickli-protected-preflight/asset-inventory-v2.json`.

The legacy endpoint contains its bucket as a path component, and AWS SDK v2 adds
the bucket again when constructing requests. Canonical account-origin SDK v3
HEAD/GET proves all ten actual object keys are the configured bucket name plus
`/` plus the unchanged digest. All ten bare-digest keys return 404. Sizes/hashes
still match exactly; no original objects were modified. Earlier bucket-level
probes through the legacy endpoint were therefore addressing a key, not the
intended bucket. Canonical GetBucketCors returns AccessDenied with the existing
credentials; GetBucketLocation succeeds. Neither establishes bucket privacy.

The planner now requires explicit verified prefix input and records it as protected
provenance, independently of the unchanged public hash URL. The actual prefix and
provider/bucket were supplied from the previously fingerprinted Production config
for a read-only in-memory preflight. All ten metadata/source/alias projections and
repeat-plan checks pass; no durable aliases or locations were written. Evidence:
`/tmp/magickli-file-object-preflight/canonical-key-report.json`,
`canonical-cors-report.json` and
`/tmp/magickli-protected-preflight/files-plan-bound-report.json`.

## Discourse PostgreSQL acceptance

The Discourse projection also passes synthetic real PostgreSQL acceptance with
the exact migration and planner. All 13 migrations apply, 33 tables reconcile,
and typed aliases, maximum safe integers, origin isolation, constraints and
rollback behave as planned. An unchanged migration rerun preserves every row;
all 41 source fingerprints remain unchanged and the owned database is removed.
Evidence: `/tmp/magickli-discourse-postgres-rehearsal/README.md`, result SHA-256
`aa32430df95689ae2fc85d603bdb03b67927a7faced137a353cee2cd4bf490cf`.
This does not call the forum or activate its SQL runtime.

## Reviewed study duplicate

The reviewed duplicate contains the same 11 card keys as its retained counterpart. Its set/card correct, incorrect and time counters are zero; all cards have initial SM2 interval/repetition/ease and repetition weight 1. Every card due date is a genuine Date at the same instant as the set due date. Historical creation/update dates are absent, while legacy sync bookkeeping is present.

The exception uses the independently reviewed full-source SHA-256 and typed source references tied to the unchanged backup manifest. Without that declaration, the planner rejects the duplicate. Future input must match the fixed fingerprint; zero counters alone do not establish approval.

All state remains accounted for:

- 667 card states: 656 active plus 11 archived.
- 459 repetition objects: 448 active plus 11 archived.
- 208 active cards have no repetition object; no empty repetition objects occur in this backup.
- All 48 reconstructed active snapshots match the original scheduler fields, Date values, counters, card keys and repetition presence.
- One quirk-bearing row and 11 aggregate discrepancy rows remain preserved. No totals were recomputed and no historical review events were created.

## Ritual source and compiled output

All 59 historical revision sources compile under the current compiler. Four of the five current trees match structurally after removing the 152 derived `forMe` properties from comparison copies only.

The remaining difference is one stored text node with `children: []`, where the current compiler omits that property. There is no remaining text, node-type, attribute-value or child-count difference. A synthetic test against installed `json-rich-text` verifies identical rendered markup for those two shapes and unchanged stored input.

All **5/5 current trees are semantically equivalent under the two named comparison rules**, `derived-forMe` and `empty-text-children`; the result remains **4/5 after `forMe` alone**. These rules apply only to comparison copies. Original compiled archives remain exact, including `forMe`, empty arrays and unknown JRT attributes.

The [SQL ritual reader](../src/doc/sqlReads.ts) may return an original archive only when no artifact is selected and its claimed revision is the current revision of that same authorized ritual. The implemented [SQL v2 write contract](007-sql-ritual-write-contract.md) selects explicitly versioned output for new saves. Missing, stale or incompatible selected output fails closed without archive fallback. This preflight does not authorize automatic replacement with recompiled import output.

## Remaining cutover gates

The [combined preparation/checkpoint pass](011-legacy-import-checkpoint.md) now
accounts for all domain rows together, including exact typed aliases and stable
provenance IDs. It also retains previously unclassified historical locale/gender
values and photo provider labels privately. Repeat preparation and exact Date/
JSON checkpoint round trips pass with unchanged backup/module hashes. This pass
uses synthetic destination bindings and creates no durable import artifact.
The authoritative owned loader and atomic SQL application remain separate work.

The pure rendered asset inventory finds all 17 image occurrences across the five
exact current archives: six legacy file URLs, four external images, two inline
images, one generated TreeOfLife and four local PNG references. Two local paths
are missing from the current catalog and both return 404 in production. Their
exact files were renamed by `05d4c96` with identical blobs; old stored URLs were
not updated. Four inventories are complete, while the remaining one explicitly
reports those two unresolved paths. A complete inventory still does not prove
downloaded bytes or offline readiness. No source or URL values were retained in
the aggregate reports; all 21 backup fingerprints remain unchanged. Evidence:
`/tmp/magickli-protected-preflight/asset-inventory-module.json`,
`missing-static-assets.json` and `missing-static-history.json`.

The two exact static aliases now redirect to the current canonical PNGs locally.
Those PNGs changed after the original rename; no historical-byte parity is claimed.
Built HTTP responses verify their current size/SHA/MIME and preserved query values.
The bounded aggregate rerun with only those validated aliases has five complete
enumerations, 17 occurrences, no issues and unchanged source/backup fingerprints.
Evidence: `/tmp/magickli-protected-preflight/asset-inventory-aliases.json` and
`/tmp/magickli-legacy-static-images/http-results.json`. The fix is not deployed;
complete offline byte resolution remains separate from enumeration.

This preflight validates the pure planning boundaries, not a live import. Transactional import and durable UUID aliases, a final backup under the approved write pause, legacy write-receipt handling, file migration, the one-time reauthentication switch and private offline acceptance remain separate gates. Follow the [migration contract](003-data-migration-contract.md) and [implementation ledger](002-implementation-ledger.md) for their status.
