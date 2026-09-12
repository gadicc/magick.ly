# Protected ritual files

New attachments follow the selected ritual's current permissions. Initiation and
finalization require its current editor. An explicit ritual/file link is necessary
but insufficient for ordinary reading: the attachment must also occur in the
authorized rendered context. Source previews are editor-only. Publishing a ritual
does not make its unsaved or historical source attachments public. Canonical file
rows and storage remain private; access is evaluated by the application.

Legacy public links retain their original keys, filenames, MIME types and null
ownership. Their JPEG/SVG compatibility path remains distinct from new uploads.

## Implemented service boundary

The strict v1 upload protocol accepts canonical UUIDv7 identities, an exact
filename, SHA-256, declared MIME type and byte size. It never accepts a client
storage location or owner. PNG, JPEG, GIF and WebP are supported up to 20 MiB.
Signed upload capabilities are transient credentials and must not be persisted
in ritual source, receipts, recovery or offline bundles.

The server-only finalizer uses the installed Loom Files service. It reads a
bounded staging stream, checks actual size/hash/type, decodes the image, and
passes those exact verified bytes to private canonical storage. Copying a mutable
staging object after validation would introduce a replacement race. Conditional
canonical writes and verified retry of the operation's own object belong in the
provider adapter. Global SHA collisions, including tombstones, are rejected
without exposing another owner's file identity.

Provider I/O precedes SQL publication. The publication adapter must recheck
current identity and ritual editing permission, fence the worker claim, and commit
the file, ritual link and immutable receipt atomically. Completed-operation replay
also requires current permission and existing parent/file/link rows; it must not
resurrect anything. Unknown acknowledgement retries retain the same operation.
Late provider writes can leave owned orphans and require reconciliation.

The overall finalization deadline is at most 60 seconds. Failed claims have a
bounded best-effort release; failure leaves the persisted lease to expire. Abort
and timeout prevent subsequent publication through the supplied cancellation
contract, but do not imply an external provider rolled back an accepted write.

## Actual image validation

Sharp 0.35.4 and file-type 19.0.0 validate synthetic real images in the tests.
Limits are 16,384 pixels per dimension, 64 million decoded pixels across all
frames, 256 frames and 15 seconds of native decode time. Configuration may only
tighten these defaults and is copied at construction. Original compressed bytes
remain unchanged. Animated GIF/WebP are fully decoded; APNG is rejected because
the installed decoder cannot establish all-frame validity for it.

Bounded GIF/WebP container checks additionally reject truncated framing. A real
two-frame GIF with four trailing bytes removed was accepted by Sharp as one frame;
the guard preserves this regression. Pixel validation uses an all-pages raw RGBA
pipeline, not metadata alone. This can require 256 MB plus overhead per operation,
so runtime concurrency and memory bounds remain an activation gate.

An actual native smoke test accepted a synthetic 18,512,794-byte, 128-frame GIF
with 63,980,672 pixels. Suspending only its owned worker process during active
decode triggered the tightened native timeout after resume; Sharp's queue and
processing counts returned to zero. Caller cancellation also returned safely
after native completion. Destroying a Sharp stream is not proof of immediate
native cancellation; its native deadline bounds remaining work.

## Verified existing provider

Read-only inspection through the authenticated Vercel CLI establishes that the
current production endpoint is Cloudflare R2. The legacy signing configuration
uses region `weur`; that string does not establish physical placement. Direct
HEAD/GET and the existing public application route both verified all ten objects,
totaling 7,790,234 bytes, against backup size and SHA-256. No raw object bytes or
credentials were retained and all 21 backup fingerprints stayed unchanged.

All ten storage Content-Type headers differ from the preserved Mongo metadata.
The public application route currently returns the expected Mongo MIME types;
the compatibility adapter must preserve that precedence. S3-style bucket-policy,
location and CORS probes returned unsupported/not-found responses on R2. These
responses do not establish private storage or an absent CORS policy.

Evidence: `/tmp/magickli-file-object-preflight/report.json`,
`public-route-report.json` and `provider-kind.log`. The endpoint/region/bucket
fingerprint is
`ba1b8f401e1745f89644ae2eeadb41ae89ab11a46caea8ce254a79bd767e213c`.
Production mapping remains to be durably bound during import. R2 direct-upload
size/checksum restrictions and browser transport require separate acceptance.

## Verification and activation gates

The finalizer/decoder unit adds 98 tests. All 1,344 default tests pass, with
98.64% statements, 97.40% branches, 100% functions and 99.43% lines across the
46 explicitly covered modules. Types, Biome, ordinary Loom checks and the
production build pass. Evidence: `/tmp/magickli-protected-files-*.log` and native
smoke scripts/reports under `/tmp/magickli-protected-files-runtime/`.

This unit introduces no provider configuration, schema changes, route or upload
UI activation. SQL intent/link/receipt adapters, provider conditional writes and
orphan reconciliation, private bucket/CORS proof, bounded direct-upload
capabilities, current-policy download/source/rendered binding, offline asset
manifests and authenticated browser acceptance remain required. Loom Files stays
`planned`; its generic upload route must not bypass the ritual finalizer.

## SQL publication adapter

The app-owned `ritual_upload_intents` and `ritual_file_links` tables now implement
the publication boundary locally. Managed Loom Files columns remain unchanged.
An intent retains its immutable request/hash, exact filename, actor/ritual,
preallocated UUIDv7 file/link identities, explicit staging/canonical locations and
completion evidence. It contains no signed URL or credential. Historical domain
IDs in receipts do not reference deletable domain rows; live associations have
restrictive foreign keys and an exact composite intent binding.

Initiation, claim, publication and replay recheck current verified identity and
persisted edit grants. Read-committed transactions use the same grant-lock order
as ritual writes, an operation advisory lock and a five-second lock timeout.
Location allocation also serializes both namespaces to prevent cross-namespace
collisions. The location factory is synchronous server configuration; signing and
all provider I/O occur outside SQL.

Intent lifetime is at most 24 hours, worker claims at most 120 seconds and direct
capabilities at most ten minutes, clipped to the intent deadline. Retries preserve
the original request, locations and deadline. Expired uncompleted intents remain
recorded; an uncertain operation must not be automatically replaced. Claim start
and expiry are persisted, and stale workers cannot publish or release a newer
claim. Completed receipts remain available indefinitely subject to current access
and existing domain rows.

Publication validates every supplied Loom file fact against the intent and actual
decoder evidence. File/link/completion commit together or roll back together.
Global duplicate lookup returns only a safe error, including for tombstones.
The real postgres-js driver exposes uniqueness details as `constraint_name`,
where PGlite uses `constraint`; the adapter recognizes both on the same underlying
error without classifying unrelated constraints as duplicates.

All 1,441 default tests, 47-module coverage, types, Biome, ordinary Loom checks and
production build pass. The adapter adds 97 SQL/schema/error-shape cases, including
actual Loom/Sharp integration for all four accepted formats. Real PostgreSQL
acceptance passes 16 concurrency/preservation/constraint gates: initiation and
claim contention, stale-worker fencing, atomic replay, all three grant revocations,
parent policy/deletion, actual lock timeout, rollback, unknown acknowledgement,
global digest race and generated constraints. Eleven completed synthetic intents
reconcile to eleven files and links with no missing publication row. Ten migration
records and all 29 tables remain unchanged on rerun; the owned database was removed.

Evidence: `/tmp/magickli-sql-upload-*.log` and
`/tmp/magickli-upload-postgres-rehearsal/{README.md,result.json,source-manifest.json}`.
Migration 0009 and the preceding domain migrations remain local. No SQL upload
route, identity switch, private Neon import or provider adapter is activated.

## Verified legacy key mapping and R2 capabilities

Canonical-origin SDK v3 reads establish that every legacy object is stored at
`<configured bucket>/<unchanged sha256>` within that bucket. Bare digest keys all
return 404. The old endpoint already included the bucket path and SDK v2 appended
the bucket again. The importer now requires an explicit verified key prefix;
it never derives one from an endpoint or bucket. Prefix bytes remain exact, with
no Unicode/path normalization, and public URLs still use only the original hash.
Protected provenance stores the prefix, with SQL constraints binding the key and
public path independently to the archived digest. Migration 0010 defaults existing
bare-key rows to an empty prefix without changing their stored values.

All 1,506 default tests, 49-module coverage, types, Biome, ordinary Loom checks and
production build pass. Real PostgreSQL accepts an upgrade with a pre-existing
bare-key row, exact BOM/space/Unicode and 1024-byte keys, and eleven invalid cases
that roll back both file and snapshot. Eleven journal entries and 29 tables remain
unchanged on rerun; both owned rehearsal databases were removed. All ten actual
file rows also pass a production-config-bound in-memory plan with disposable IDs
and unchanged backup fingerprints. No durable private import ran. Evidence:
`/tmp/magickli-file-locations-postgres/`, `/tmp/magickli-file-location-*.log` and
`/tmp/magickli-protected-preflight/files-plan-bound-report.json`.

The live R2 capability probe created only fresh 64/65-byte synthetic test objects.
Correct bytes returned 200 and matched GET size/SHA; unchanged checksum with altered
bytes returned 400 BadDigest; altered signed length returned 403
SignatureDoesNotMatch; same-key conditional replay returned 412 PreconditionFailed.
All test objects were removed and absence verified. Native Chromium separately
proves that Blob PUT automatically supplies exact Content-Length for 64-byte and
20 MiB bodies under real SDK signatures. This is not yet an authenticated browser
upload through production CORS or a 20 MiB production decode/load acceptance.

R2 ignored metadata hoisted into the signed URL query. The corrected probe signs
and sends checksum/provenance as explicit HTTP headers. Its preceding 64-byte
object was verified against the exact sent bytes and original absent-key/PUT
evidence before exact-key cleanup. No existing objects or bucket settings changed.
Evidence: `/tmp/magickli-file-object-preflight/r2-capability-report.json`,
`r2-capability-v1-report.json`, `r2-probe-cleanup-report.json`, and browser evidence
under `/tmp/magickli-files-s3-adapter/output/playwright/`.

Canonical bucket-level CORS inspection returns 403 AccessDenied with the existing
object credentials. Earlier CORS/policy probes through the bucket-prefixed legacy
endpoint were not valid bucket-level evidence. Private Production/Preview bucket
configuration, CORS and full browser/runtime acceptance remain separate gates.
