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
