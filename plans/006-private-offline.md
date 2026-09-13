# Private ritual offline storage and 14-day authorization

Status: the pure [lease policy](../src/offline/lease.ts), account-scoped [Dexie repository](../src/offline/repository.ts), [SQL permission checker](../src/offline/sqlPermissionCheck.ts) and strict [wire parser](../src/offline/permissionContract.ts) are implemented. Dexie 4.4.6 is pinned, with fake-indexeddb 6.2.5 for tests. Native IndexedDB acceptance covers the initial repository; the app's HTTP/auth, reader/editor, service worker and migration integration remain inactive.

The installed JRT 1.3.1 now has a one-line pnpm patch changing its private node
cache from Map to WeakMap. Live blocks retain their node identity and editing
behavior; discarded trees can be collected once application references are gone.
This permits garbage collection, without promising immediate memory erasure or
changing the existing hook architecture. The app records the patched node module's
exact SHA in its compiler/renderer identity. Output compatibility remains profile 1,
so previously selected compatible artifacts and exact legacy archives still render.

Independent controlled-GC tests retained all 128 discarded objects with the old
Map and collected all 128 with WeakMap, while preserving a deliberately live node.
Forced GC is outside ordinary CI. Package compatibility and source-build evidence
is in `/tmp/magickli-jrt-cache/`; the upstream checkout and publication remain
unchanged. Private-view integration must still remove application references.
The editor's `window.doc` handle now has owned effect cleanup: it is emptied and
removed on unmount, and captured callbacks cannot affect a replacement editor.
Live console scripting remains available. Compilation results are fenced by both
editor lifetime and source generation; every created source-map consumer is
released, including those that resolve after unmount. This does not activate the
14-day policy in the current Gongo/localStorage editor.

All 1,573 default tests, scoped coverage, types, Biome, frozen install, ordinary
Loom checks and a clean production build pass. Five installed-package regressions
cover live identity, mutation callbacks, ancestor rekeying, moved nodes and valid
object keys. Nine additional actual-package/app-renderer cases pass with both
Map and WeakMap. Ten native Chromium stages cover source edits, stateful component
insertion/removal, roles, navigation, recovery, account replacement and saving.
Both builds emit the known hook-order errors (#310 on insertion, #300 on removal)
and recover through the existing preview boundary; no new hook fix is claimed.

The first incremental build retained the old JRT module despite the patched
installation. Only the subsequent empty-`.next` build is patched browser evidence:
the browser verified the served `1355-8f616ae039a21a6f.js` WeakMap module with SHA
`f670e3b2476ff9138e672c31411b00982d2b4f2396b8a7386e27985c1006125a`.
Future dependency patches require emitted-bundle inspection and cache invalidation
when needed, not just an installed-file check. Detailed baseline/patch evidence:
`/tmp/magickli-jrt-app-browser/` and `/tmp/magickli-jrt-*.log`.

The separate editor cleanup passes all 1,651 default tests, scoped coverage,
types, Biome, ordinary Loom checks and a production build. Thirteen new editor
cases cover stale async work, current errors, account replacement, captured
callbacks and actual StrictMode effect replay. Twelve Chromium stages verify
the real editor, same-document Back/remount, inert old handles, account changes,
the built-in `unshortcut` script, saving and unsaved-draft recovery after reload.
Known hook diagnostics remain #310/#300 with existing recovery; no unexpected
errors occurred. StrictMode and stalled promises are tested separately from the
production browser. Evidence: `/tmp/magickli-editor-lifetime/` and
`/tmp/magickli-editor-*.log`. The original browser harness incorrectly reused a
JSHandle across a hard navigation; its retained failure and corrected same-realm
harness distinguish this test defect from application behavior.

## Agreed contract

A successful **server ritual permission check** may issue at most 14 × 24 hours of offline access. Local reads, an existing cached grant, successful session lookup, `navigator.onLine`, firewall/VPN changes and failed requests cannot renew it. Keep read and source/edit capabilities separate. Ordinary readers receive rendered content, not source/history.

Explicit sign-out removes downloaded rituals, source snapshots and private assets. Expiry or confirmed revocation removes the corresponding renewable downloads at the next running lifecycle check. Preserve unique editor recovery and pending commands, but lock them. Expired/revoked/signed-out recovery cannot be reopened, previewed, copied or exported until the same owner passes a successful online **source/edit** permission check for the target. A read-only grant is insufficient. New offline creation is deferred; recovery of a not-yet-created ritual requires verified create permission for its original scope, never a fabricated ritual grant.

The app must distinguish these results:

| Event | Existing unexpired rendered grant | Source/drafts | Downloaded data |
| --- | --- | --- | --- |
| Fresh allowed read + source/edit | Renew from this check | Available under the new lease | Replace/renew a complete authorized bundle |
| Fresh allowed read, source/edit removed | Renew read | Remove source snapshots; lock recovery/export | Keep rendered bundle and read assets |
| Explicit same-account denied/missing ritual result | Revoke immediately | Lock unique recovery | Remove that ritual's downloads/assets |
| 401 / expired session | Do not renew; offer re-auth | Same existing source lease remains bounded | Do not misclassify as revocation |
| Timeout / offline / 429 / 5xx / malformed or incomplete response | Do not renew | Preserve pending requests | Keep only the existing grant's remaining window |
| Explicit sign-out/account replacement | Clear account binding immediately | Preserve but lock recovery | Remove old account's downloads |
| Deadline reached / observed clock rollback | Lock before display | Preserve but lock recovery | Remove renewable downloads; online check required |

A generic HTTP403/404, proxy/login HTML, empty Gongo result or omission from a paginated list is not proof of revocation. The offline protocol must return an explicit, validated result for each requested ritual, bound to its request ID and freshly authenticated account. Missing results are retryable protocol failures, not tombstones.

## What the reference code actually provides

- [Shadowlang clientCache.ts](/home/dragon/www/projects/shadowlang/src/flashcards/clientCache.ts) uses installed Dexie 4.4.3, a singleton `shadowlang-flashcards` database, versioned stores, account/course compound indexes and transactional snapshot/metadata writes. Its six-hour `staleAt` is content freshness, not authorization. Private Magickly reads must never normalize a missing identity to Shadowlang's `anonymous` key.
- [reviewOutbox.ts](/home/dragon/www/projects/shadowlang/src/flashcards/reviewOutbox.ts) persists client UUIDv7 review IDs and before/after state. [drainOutbox.ts](/home/dragon/www/projects/shadowlang/src/flashcards/drainOutbox.ts) groups ordered requests, handles partial acknowledgements and backs off transient errors. Reuse these ideas, not its global drain singleton/global inflight reset: each Magickly claim and reply must stay account/epoch scoped.
- [useOutboxSync.ts](/home/dragon/www/projects/shadowlang/src/flashcards/useOutboxSync.ts) listens for mount, online and visible events. Those are retry triggers only. Its disposal clears listeners but does not cancel an in-flight domain operation; Magickly additionally needs epoch/CAS guards and abort signals.
- [deviceCleanup.ts](/home/dragon/www/projects/shadowlang/src/account/deviceCleanup.ts) deletes declared owned stores and reports partial failure. Its whole flashcard database deletion would destroy an outbox here. Its shared [media cache](/home/dragon/www/projects/shadowlang/src/flashcards/mediaCache.ts) and URL-based [prewarm](/home/dragon/www/projects/shadowlang/src/flashcards/mediaPrewarm.ts) are unsuitable for private account/ritual assets.
- [Magickly db.ts](/home/dragon/www/projects/magickli/src/db.ts) persists `docs`, `docRevisions`, users, groups, temples/memberships and study data in Gongo's shared browser database. It enables polling from persisted network preference after collection population. [publications.ts](/home/dragon/www/projects/magickli/src/doc/publications.ts) now returns full authorized snapshots, but an empty result still does not remove old Gongo records. That cache is not an offline permission grant.
- [drafts.ts](/home/dragon/www/projects/magickli/src/doc/drafts.ts) already preserves exact source, CAS base, original pending requests and raw legacy mutations under `magickli:ritual-recovery:v1:` before polling can overwrite them. Preserve this evidence. `raw.userId` can describe a legacy creator/author rather than the actor who made a pending edit; unknown provenance cannot be reassigned to the account currently signing in.
- [MyAppBar.tsx](/home/dragon/www/projects/magickli/src/app/MyAppBar.tsx) currently calls Auth.js `signOut()` directly. Cache/recovery gating must be integrated into a coordinated app sign-out flow before private downloads activate.

## Minimal storage model

Use one dedicated Dexie database `magickli-ritual-offline`, schema version 1, with mandatory canonical UUIDv7 owner IDs. Partition every data lookup by owner **and** ritual. Avoid cross-account and cross-ritual blob deduplication initially; the dataset is small and separate deletion is easier to reason about.

| Store / key | Minimum fields |
| --- | --- |
| `deviceState`, `&key` (`active`) | `ownerId|null`, random UUIDv7 `epoch`, cleanup-pending state. This is a local account binding, not a session token or permission grant. |
| `checks`, `&[ownerId+ritualId]` | Latest `requestId`, account epoch, local request-start instant. Updating this row fences earlier replies across tabs. |
| `authorizations`, `&[ownerId+ritualId]` | Versioned server grant; local request-start/deadline/last-observed time; latched lock reason; epoch. See `lease.ts`. |
| `bundles`, `&[ownerId+ritualId]` | Data version1, opaque `bundleId`, permitted title and compiled JRT body/hash, renderer/output format versions, exact asset manifest, completeness status. Readers need no source hash/current source revision pointer. |
| `assets`, `&[ownerId+ritualId+bundleId+assetKey]` | Blob, digest, MIME, byte size, exact logical reference, purpose `read` or `source`. Never key only by URL/hash. |
| `sourceSnapshots`, `&[ownerId+ritualId+revisionId]` | Exact requested source/history metadata and hashes, compiler provenance, parent version/CAS token; authorized editors only. Default download includes current source only if editing was requested; no automatic full history download. |

Keep durable recovery in separate object stores of the same dedicated database, so epoch, lease, draft and outbox operations can share one IndexedDB transaction. Expose no whole-database delete/reset API; cleanup explicitly targets renewable download stores and never unique recovery:

- `drafts`: UUIDv7 draft ID, owner, target kind, exact source/current base, original request when present, lock metadata and authorized check/epoch reference.
- `outbox`: immutable UUIDv7 operation/request ID; owner; original backend/protocol version and byte-preserving payload/hash; target; CAS base; status `queued|sending|authentication-required|conflict|rejected|acknowledged|locked`; bounded retry metadata. Do not change request ID or source after an uncertain result.
- `quarantine`: deterministic legacy key/digest and original raw serialized record, including corrupt/unattributed records. This store has no guessed owner and no normal editor/export path. An unknown owner needs explicit verified recovery mapping, not an account picker that grants access.
- `migrationLedger`: source store/key, digest, destination key, copied/verified status. Do not mark migration complete when copying or re-reading fails.

Existing localStorage recovery can remain the durable source until this migration is verified. Preserving its exact serialization and original keys is safer than immediately changing its persistence format. Never delete a whole Gongo database while study/other pending work still lives there.

## Permission and download protocol

The transport-neutral checker accepts one ritual per strict version-1 request with canonical UUIDv7 `requestId`, `expectedActorId` and `ritualId`. Its future uncached HTTP endpoint stays separate from ordinary list/detail pages. The checker verifies the current session and expected actor, then reloads persisted identity/grants, ritual policy and selected output in one read-only repeatable-read SQL transaction. Do not copy cached Gongo memberships or treat client `canEdit` as authority.

Confirmed policy denial or a missing parent for an existing authenticated user
returns explicit `denied`. Missing/changed/deleted identity returns
`authentication-required`; malformed policy and operational errors are temporary.
A permitted parent with missing/stale/unsupported output still receives its
read/source grant but reports rendered output unavailable. That grant contains no
source, rendered JSON, title, membership or asset inventory. Available output has
an opaque descriptor digest, content digest and output profile; only editors
receive current revision/version tokens. The descriptor is never a bundle ID or
proof of complete assets.

Return an explicit per-ritual `granted`, `denied`, authentication-required or temporary-failure result. A grant contains owner/ritual/request binding, a fresh lease ID, `checkedAtMs`, `respondedAtMs`, `expiresAtMs <= checkedAtMs + 14 days`, and separate source/edit capability. Render data must come from the approved rendered SQL projection, not an unvalidated original compiled archive. Per-role JRT hiding is presentation: receiving a compiled ritual means receiving its authorized whole body.

The response's explicit grant authorizes app-managed offline payload storage. HTTP `Cache-Control: private, no-store` and a NetworkOnly service-worker rule still prevent automatic HTML/RSC/API response caching. Never infer permission from an ETag304, successful session endpoint, defaultCache entry or a generic200 body. No server write endpoint accepts an offline lease as its authorization.

The client captures request-start time before sending, and records the latest check ID in a Dexie transaction. Only accept a reply if owner, ritual, account epoch and latest check ID still match in another transaction. A late A reply must never repopulate downloads after sign-out or after B signs in; an older grant cannot overwrite a newer denial.

Fetch/validate/hash all required assets outside a Dexie transaction. Then atomically publish the complete bundle, asset rows and accepted authorization. IndexedDB transactions must not wait for unrelated network work ([Dexie transaction guidance](https://dexie.org/docs/Dexie/Dexie.transaction())). Partial downloads never receive a Ready badge. On refresh failure, an existing complete bundle may keep only its previous unexpired lease; a successful check of a changed bundle must not silently extend the old bundle's lease. Apply denial and source-right downgrade immediately, even if a replacement download later fails.

For a same-bundle renewal, update authorization atomically without downloading unchanged blobs. For a new bundle, stage bytes and swap the active bundle only when complete; clean old renewable bytes after the swap. Unknown/missing asset types remain explicitly incomplete until supported.

## Asset visibility is a prerequisite

[Legacy file2](/home/dragon/www/projects/magickli/src/app/api/file2/route.ts) currently serves a content hash with public immutable caching and no visibility check. Such a URL is public today; placing its response in a private Dexie table does not make the original protected. Root's Loom file migration must classify these files and govern delivery before protected media downloads activate.

The server's asset manifest must distinguish public bundled/generated media from ritual-read and source-only assets, and bind protected files to the same permitted ritual/revision. A user's authority to upload a file does not automatically make it readable by every ritual reader. Do not forward cookies/authorization to arbitrary source URLs or create an unrestricted server URL proxy.

Use private blobs directly from the gated Dexie repository with short-lived object URLs. Revoke those URLs and clear rendered/editor memory on expiry, revocation, sign-out, account switch and unmount. Do not introduce a generic cached private-file service-worker route. Source-only assets are removed on edit-right downgrade even if read access remains.

Gather only known renderer asset references, preserving every functional query and SVG fragment. The bundled source concretely includes inline data images, local SVG/PNG files, external images and `/api/treeOfLife?...` generated output. Do not assume every `src`/`text` in JRT is editor source, or mutate the protected compiled archive while building an asset map. Unknown external URLs may prevent complete offline readiness; they need an explicit supported fetch/hosting policy. A file extension or URL hash is not a visibility decision.

The pure `ritualAssetInventory` module now enumerates exact source paths without
running React or changing the input. It follows the actual suppressed-child,
task and collected-footnote rules, and keeps query spelling/order and display
fragments exact. One source path may produce multiple DOM images when a task has
both `say` and `do`; the resolver must apply that one source replacement to both.
Stylesheets, unsupported resource styles/attributes and ambiguous footnote hosts
produce explicit incomplete results. External/generated/inline classification
identifies remaining resolver work and never means bytes are available.

The JSON boundary permits at most 4 MiB, 20,000 child nodes, depth 128, 512 image
occurrences, 1 MiB per reference, 16 KiB per style and 512 diagnostics; overrides
only tighten those limits. Callers supply trusted exact HTTPS app origins and a
build-static URL catalog. Bind the inventory to the authorized selected-render
descriptor. Complete enumeration is a prerequisite, not a complete asset manifest
or a permission grant. SHA/MIME/size, SVG/font dependencies, protected links and
actual offline decoding still require their separate adapters and checks.

All 1,638 default tests, 51-module coverage, types, Biome and ordinary Loom checks
pass. Sixty-five portable cases cover identity, reachability, malformed input and
bounds. Three additional actual-JRT acceptance cases cover all twelve public
built-in image references and synthetic footnotes, including repeated rendering of
one source path. Evidence: `/tmp/magickli-ritual-asset-inventory/` and
`/tmp/magickli-assets-*.log`. This module is not yet wired into the reader.

The same module enumerates all 17 images in the five protected archived trees
without changing any backup bytes. Four trees enumerate completely. Two PNG paths
in the remaining tree are absent from the current static catalog and return 404
in production. Git commit `05d4c96` renamed both files from `magickli` to `magickly`
with identical blobs; their stored references were left behind. Two exact aliases
now drive permanent redirects to the current canonical PNGs. Commit `6c71d32`
subsequently changed both images, including their pixels; compatibility restores
the current locations, not historical bytes. Built HTTP checks verify 308/200,
PNG MIME/size/SHA, query values and unrelated-path 404s; target decode tests,
types, Biome, ordinary Loom checks and production build pass.

Adding only those validated alias targets to the read-only preflight catalog
makes all five trees enumerate completely, still with 17 occurrences and all 21
backup fingerprints unchanged. The shared alias map is available to the later
offline resolver; redirects alone do not supply offline bytes. No blanket `/pics`
allowance or source rewrite is used. Four external images and generated
TreeOfLife/font dependencies still require complete resolver support. Evidence:
`/tmp/magickli-legacy-static-images/http-results.json` and
`/tmp/magickli-protected-preflight/asset-inventory-aliases.json`.

The server-only [static raster catalog](../src/files/staticRitualImageCatalog.ts)
now captures an explicit list of exact `/pics` paths, validates their complete
raster bytes, and binds original/alias paths to separate canonical identities.
Its public metadata contains SHA, MIME, size, dimensions and frame counts; a
catalog hash also covers ordered entries, aliases and the pinned validator/native
decoder identity. It does not identify a deployment, permission grant or complete
ritual bundle. SVGs and unavailable/unsafe/invalid files remain unresolved.

Capture is sequential, bounded to 128 configured paths, 20 MiB per file and
64 MiB total compressed reads, including candidates that fail validation. Limits
can only be tightened. The build root must be trusted and quiescent; directory
symlinks, file replacements and changes observed during capture are rejected.
Queries/fragments/encoded paths are not file selectors. A subsequent resolver
must preserve the original occurrence identity separately. The catalog retains
validated snapshots; each byte lookup returns a fresh copy without rereading disk.
Disposal clears those snapshots, and a whole-build abort/limit failure publishes
no partial result. Browser consumers import only the separate metadata types.

All 1,699 default tests, 52-module coverage, types, Biome, ordinary Loom checks and
production build pass. The 46 new tests cover actual raster/animation decoding,
alias targets, identity, mutation isolation, filesystem changes and bounded cleanup.
Read-only acceptance across all 15 current public images finds nine rasters
(929,740 bytes), two available aliases and six unresolved SVGs, with unchanged
source hashes. Root integration replaced an unsupported bigint literal with
`BigInt(1)` for the existing TypeScript target and reran all checks. Evidence:
`/tmp/magickli-static-raster-catalog/` and `/tmp/magickli-static-catalog-*.log`.
The builder remains inactive pending asset resolution and complete bundle wiring.

The subsequent read-only non-static inventory narrows that work: the archived
inline raster is a fully decoded 1,311-byte, 54×29 single-frame GIF; the other
inline image is an 899-byte SVG with six paths and no discovered dependencies.
The latter sniffs as XML and needs a separate bounded SVG profile. Four external
HTTPS images still have unverified bytes/MIME/availability. Do not turn their
hostnames into a generic fetch allowlist; resolve exact references selected from
authorized content, preserving immutable acquisition evidence.

The six public ritual SVGs use internal fragment references and four embedded
PNGs. Their structural inspection found no external resource URLs, but embedded
raster decoding and actual offline visual acceptance remain required. Preserve
existing gradients, patterns, text paths and system-font fallback; stripping all
references would break them. The seven legacy SVG files require their own byte
inspection through the verified storage mapping before corpus readiness.

TreeOfLife's default SVG response contains absolute Noto font URLs. Caching those
URLs alone does not establish font availability when SVG is displayed as an image.
A versioned generated-image adapter must constrain query semantics and verify a
self-contained output, retaining any captured original separately from a font-
embedded derivative. The existing `/api/treeOfLife` compatibility route and broader
component-export consolidation need coordinated handling. No renderer change or
new SVG upload support is implied by this inventory. Safe evidence is frozen in
`/tmp/magickli-nonstatic-asset-review.md` (SHA-256
`388fd5da4c90c243dc46f25806ef3c3274286a5308d09489b4337f42ae32f7dc`)
and its report/manifest companions. All 21 backup fingerprints stayed unchanged;
no asset/provider requests or retained private sources/full URLs were involved.
Generic public SVG documentation was consulted separately.

## Implemented inline image transport

`src/files/dataImage.ts` decodes explicit PNG/JPEG/GIF/WebP/SVG data URLs into
owned original bytes. Its 1 MiB reference and decoded-byte caps can only be
tightened. It requires callers to separate and retain literal display fragments,
refuses malformed percent escapes and unsupported headers, and requires escaping
raw Unicode and non-base64 whitespace. Percent escapes represent bytes, including
binary values that are not UTF-8. Base64 accepts standard ASCII whitespace and
optional padding; it rejects junk and malformed padding. Unused final bits follow
the [WHATWG base64 algorithm](https://infra.spec.whatwg.org/#forgiving-base64-decode).
Percent decoding precedes base64, following the
[data-URL processing order](https://fetch.spec.whatwg.org/#data-url-processor).

This is transport decoding only: a declared image type is not trusted, and SVG
validation, image decoding, authorization, complete asset manifests and runtime
integration remain separate. It does not rewrite the original reference or SVG.

All 90 new cases pass, with 100% measured module coverage. The full suite passes
1,789 tests (14 opt-in Mongo cases skipped), 53-module coverage, types, Biome and
ordinary Loom checks. Read-only acceptance matches native data-URL fetch bytes for
both backed-up inline images (1,311-byte GIF and 899-byte SVG) and all four embedded
public PNGs (29,179, 7,288, 8,795 and 34,948 bytes). XML character references are
parsed before handing embedded href values to the decoder. All 21 backup
fingerprints and original trees remain unchanged; no provider requests occur.
Evidence: `/tmp/magickli-data-image-acceptance.mjs`, its aggregate JSON report and
`/tmp/magickli-data-image-{coverage,types,biome,loom}.log`. No framework or dependency
change occurred, so this unit uses the preceding successful production build.

## Implemented SVG image compatibility

`src/files/validateRitualSvg.ts` validates the static dependency profile of
existing SVG images and retains an owned copy of the exact original bytes. It
checks XML namespaces, UTF-8, a closed graphics/presentation subset, parsed CSS,
unique XML names (including Unicode), exact internal targets, dependency cycles
and excessive reference expansion. Inherited paints, use shadow content and
marker context paints are conservatively included. It fully decodes embedded
rasters through the existing validator. Scripts, event handlers, DTDs, processing
instructions, foreignObject and unresolved external dependencies never yield a
validated result. Unsupported constructs stay incomplete; nothing is sanitized.

Limits include 4 MiB SVG input, 20,000 elements, depth 128, 100,000 attributes,
256 KiB aggregate CSS, 2,000 lexical/applied/inherited references, 100,000 expanded
dependency elements, 64 embedded rasters, 4 MiB embedded compressed bytes and
64 million embedded decoded pixels, with a cooperative 15-second deadline.
These bound parsing/dependencies and embedded raster decoding; they do not bound
SVG geometry, filter allocations or final painted pixels. Browser image-context
checks and complete authorized bundle integration remain separate requirements.
New uploads remain PNG/JPEG/GIF/WebP only.

Exact runtime dependencies are css-tree 3.2.1, saxes 6.0.0 and xmlchars 2.2.0;
all three were already in the dependency graph. Only css-tree development types
3.2.0 add a package. XML name validation reuses the parser's Unicode rules.
[Saxes upstream](https://github.com/lddubeau/saxes) is archived; its strict XML and
namespace behavior was retained with explicit corpus tests. A parser upgrade
must repeat this compatibility review. The profile is not a general SVG sanitizer.

All 102 new cases pass. The full suite passes 1,891 tests (14 opt-in Mongo cases
skipped), 54-module coverage, types, Biome, ordinary Loom checks and production
build. All six public SVGs, seven legacy uploaded SVGs and the backed-up 899-byte
inline SVG validate with original-byte parity. Legacy object streams stayed in
memory, matched the backup sizes/checksums and left all 21 backup fingerprints
unchanged. Two legacy files exposed valid Unicode IDs that the initial ASCII
subset rejected; the final profile preserves their exact spelling. No stored
objects, ritual sources or public links changed.

Chromium 152 renders all six public files identically from their HTTP URL and
offline Blob bytes with the HTTP cache cleared/disabled and service workers
blocked. No external request attempts or page errors occurred. This uses the same
installed system fonts; it does not prove cross-device font parity or the private
reader's lifecycle integration. Public screenshot and safe reports:
`/tmp/magickli-svg-browser-public.png`, `/tmp/magickli-svg-browser.json`,
`/tmp/magickli-legacy-svg-preflight.json`, `/tmp/magickli-inline-svg-acceptance.json`.
The staged source manifest is `/tmp/magickli-svg-validator/manifest.json`; full
root checks are `/tmp/magickli-svg-{coverage,types,biome,loom,build}.log`.
The static catalog integration is recorded below; complete asset-plan and runtime
integration remain separate units.

## Implemented static SVG catalog

The existing captured-byte catalog now includes both raster and SVG evidence under
`magickli-static-image-catalog-v2`. Each available entry distinguishes full raster
decoding from the SVG dependency profile. Embedded raster facts are deeply frozen;
the outer SVG has no invented pixel or dimension guarantee. Catalog identity binds
the validators, source hashes, parser versions and actual native decoder versions.

All 15 configured public files validate: nine rasters and six SVGs, plus the two
exact legacy pathname aliases. The six SVGs contain four validated embedded PNGs.
The catalog retains 2,942,290 canonical compressed bytes, with no unresolved files
and no source changes. This completes static-file compatibility only; it is not an
authorized download manifest or a private reader readiness result.

SVG capture is bounded at 4 MiB before allocation; both formats consume the
existing 64 MiB aggregate capture budget. The catalog retains the validator's own
snapshot after checking its length, digest and exact bytes. Cancellation, mismatch
and whole-catalog failure clear owned allocations. Returned copies cannot mutate
retained bytes, and later filesystem changes require a new catalog. Filesystem
checks assume a trusted, quiescent build directory.

All 63 catalog cases and 1,908 default tests pass (14 opt-in Mongo cases skipped).
The 54-module coverage result is 98.21% statements, 96.92% branches, 100% functions
and 99.25% lines. Types, Biome, ordinary Loom checks and production build pass;
the existing 46 Biome warnings and Loom release-workflow advisory remain.
Evidence: `/tmp/magickli-static-svg-catalog/manifest.json`, its public catalog
report, and `/tmp/magickli-svg-catalog-root-{coverage,types,biome,loom,build}.log`.
The catalog SHA is
`7b021dc2f57daa0c9e79daef7ea2ba57950141d1d544ba762bad27de963bed00`;
validation SHA is
`cd11c8765f14de5253e312c69be35cf9a55193c237b4afc811a3d29044a0957c`.
Inline, legacy upload, generated and external occurrence resolution, complete
manifests and authenticated delivery remain required before private activation.

## Implemented static and inline resolution plan

The server-only `createRitualAssetPlan` verifies the supplied selected-content
digest, inventories that exact JSON itself and resolves static snapshots and
inline images. It accepts a trusted server-built static catalog, never a supplied
occurrence list, manifest or generic fetch callback. SQL selection and permission
checks remain the caller's responsibility. Even `resolutionComplete: true` is
image-resolution evidence, not an authorized bundle or permission grant.

The immutable plan binds content, inventory and validation profiles, static
catalog identity, resource limits, each original child path and image reference,
exact query spelling/order and display fragment. Identical network references
share one capture; distinct queries keep separate identities. Fragments remain
attached to each occurrence for the later Blob-URL projection. The archived JSON
is never rewritten, and no source/history or title enters this metadata. Original
image references can themselves contain private information or inline image
bytes, so the metadata is not public and must not be logged indiscriminately.

Each inline image passes the existing byte decoder and either full raster
decoding with declared/detected MIME agreement or the closed SVG profile. Limits
are 64 MiB of captured compressed data, 64 distinct inline attempts, 64 million
inline decoded pixels and a 30-second cooperative deadline; overrides only
tighten them. A failed native/SVG decode reserves the remaining pixel budget
because partial work has no complete pixel receipt. Exhaustion prevents further
inline decoding. Static and inline copy allocation, global abort/timeout and
failure cleanup preserve ownership; catalog disposal cannot invalidate an already
captured plan. Plan disposal clears its retained byte arrays, not copies or
immutable metadata already held by its caller.

Legacy file links, external images and generated Tree of Life images explicitly
remain pending. Missing, invalid or unsupported references and unsupported JRT
resource constructs keep the whole plan incomplete. Available partial evidence
must not be published as a complete download. Persistent bundles still need
UUIDv7 identities and binding to the authorized SQL render descriptor; transient
plan array indices are not database IDs.

All 25 new cases and 1,933 default tests pass (14 opt-in Mongo cases skipped).
The 55-module coverage result is 98.25% statements, 96.96% branches, 100% functions
and 99.28% lines. Types, Biome, ordinary Loom checks and production build pass with
existing warnings.
Read-only corpus acceptance resolves all six static/inline occurrences among the
17 archived images, with six legacy-upload, four external and one generated-image
gap. Two of five archived trees have complete image plans, including one with no
images. The public neophyte and zelator trees resolve completely; theoricus still
has two external-image gaps and its generated diagram. No readiness UI changed.
All 21 backup fingerprints, 15 public image hashes and three builtin source files
remain unchanged. No remote requests or durable image/source writes occurred.
Evidence: `/tmp/magickli-asset-plan-acceptance.json` and
`/tmp/magickli-asset-plan-{coverage,types,biome,loom,build}.log`.

The [remaining acquisition record](009-ritual-image-acquisition.md) now documents
successful reads of three existing external images, the verified Wikimedia
standard-size replacement, and the generated SVG embedded-font experiment. These
findings do not install durable assets or activate their resolvers.

## Lifecycle, timing and draft locks

The pure module derives a conservative local deadline from local request-start plus the **remaining** server lease at response assembly. Server preparation and network/download latency never restart a 14-day clock. It persists observed wall-clock time and latches expiry/observed rollback. Only a new successful permission check clears such a latch. Inspect stored records at cold start, `pageshow`/resume, visibility change and every protected source/export operation; missing or malformed state requires an online check. Schedule normal expiry and bounded active-window checks too; timers alone are insufficient.

The active account/epoch, latest check and authorization decisions must be read/updated together in Dexie transactions. Recompute the current clock inside that transaction, not from an earlier queued callback. `BroadcastChannel`/Dexie live queries notify other tabs, but every operation still checks persisted epoch; notifications are not authority. Abort pending downloads/sync on lifecycle changes and also fence late completions, since abort can race.

Sign-out first closes the visible private view and clears/fences the active account in the offline DB, then purges that account's download/source/asset rows. Drafts/outbox remain. Failure to delete must leave the account blocked and cleanup pending; do not report successful removal while bytes remain. Re-authentication alone does not reopen a draft: perform the target's source/edit check. First commit a durable account fence and cleanup-pending marker in its own transaction. Then purge renewable stores in a second transaction: a purge failure rolls back deletion but leaves access blocked. Fresh authentication cannot bypass pending cleanup. Because all protected stores share the dedicated database, every draft/source/export/outbox gate reads the persisted account and lease in the same transaction as the protected operation; cached UI flags are never authority.

Before hiding an editor, preserve its latest in-memory source as locked recovery even if the normal autosave debounce has not fired. Persisting recovery is permitted while locking; reading/previewing/exporting it is not. Keep a locked-draft indicator without leaking source/title to another account. Unknown-outcome creation requests remain attached to their owner and original scope; resolve their receipt online without manufacturing a nonexistent ritual ID. New offline creation stays disabled.

A browser cannot provide tamperproof DRM: local privileges or script compromise can read/change browser storage ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#storage-apis)). The lock controls application behavior, not ciphertext. An offline deadline cannot become a trusted clock across device resets/boots: wall clocks can change, and `performance.now()` has cross-platform sleep behavior unsuitable as a persistent lease clock ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)). A rollback that is not observable from persisted state cannot be proven. These safeguards should not be presented as defeating a determined device owner.

Connectivity events only trigger a request; `navigator.onLine` can be true on a disconnected LAN or affected by firewalls ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine)). Browser storage can be evicted or cleared; request persistence when appropriate, display readiness honestly, and preserve/recover failures without promising guaranteed device storage ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).

## Migration and release order

1. Review/commit the pure lease rules independently; they activate nothing. Finish the server rendered bundle/asset authority contract and versioned typed endpoint with synthetic SQL/transport tests.
2. Add Dexie and the owner-scoped repository behind an inactive integration boundary. Test atomic completion, epoch/check CAS, source downgrade, cleanup failure and quota/crash recovery with real IndexedDB/browser fixtures.
3. Fence old polling before importing. Await Gongo `collectionsPopulated`, durably archive **all** pending ritual mutations/current recovery, verify the copy, then stop ritual subscriptions and prevent old rows repopulating. Existing generic mutation bypasses stay closed. Reuse the tested current polling/archive ordering.
4. Treat every legacy downloaded ritual/source as unleased. Map known legacy IDs only through the trusted server import mapping for the verified owner. Re-fetch after current permission checks; do not grant 14 days based on a legacy row's timestamp. Preserve unknown/corrupt/ambiguous work in locked quarantine. Resolve known uncertain Mongo command receipts before disabling that backend, or provide a deliberate receipt-translation bridge; never replay a changed SQL payload under the same old request ID.
5. Integrate reader/source UI, sign-out/account epoch, draft/export guards and private asset delivery **together before enabling downloads**. Keep public builtin caches unchanged. Use a static anonymous private-reader fallback shell; it obtains all protected data through the lease-gated repository. Do not cache dynamic private SSR HTML or RSC as a shortcut.
6. Replace automatic private response caching with NetworkOnly for relevant private HTML/RSC/API/file requests. Clear owned legacy private-capable `others`, RSC, API and `pages` entries under an explicit migration plan, without deleting public asset caches or unique recovery. Test existing tabs/BFCache and Next router memory; sign-out must reset private in-memory routing state too.
7. Activate the SQL/Dexie reader and owner-bound outbox, remove legacy ritual reads after parity, then perform the production write pause/import/reauth cutover already approved by the operator. Existing offline creation remains deferred.

The 14-day policy starts only after the new client/migration is installed. A never-reconnecting browser running old code already has an indefinite cache; the server cannot retrofit expiry into that offline program. Minimum-client/protocol gates at cutover stop further legacy network reads/writes but cannot retract previously copied data. Preserved locked recovery can itself contain old source and saved-source copies, so sign-out removes downloads, not every byte of private text.

## Concrete acceptance matrix

- **Lease boundaries:** 13d23:59 usable; exact deadline unavailable; source/export checks immediate; idle foreground expiry, suspended tab, BFCache resume and cold start all lock. Local read, browser reload, session-only success, firewall flip and repeated failed requests do not move deadline. Missing/malformed/unknown-version records fail closed. Detected rollback latches until a successful check.
- **Capabilities:** creator/global/scoped editor can download source; ordinary/grade-gated reader cannot. Read-only renewal after edit revocation retains rendered content but removes source/editor assets and locks existing drafts, previews, clipboard and export. Restoration unlocks only after a new owner-bound source/edit check.
- **Identity/concurrency:** A downloads, signs out, B signs in; B sees none of A's content/drafts/assets. Late download/renew/save replies cannot repopulate A or B. A→sign-out→A still changes epoch. An older allowed response cannot override a later denied response. Two tabs and a killed leader retry the same operation ID safely.
- **Network/errors:** 401 requires re-auth without deleting an unexpired grant; typed same-account denied removes cached ritual; proxy403/login HTML/missing batch items/timeouts/429/5xx do not revoke or renew. Permission checks themselves bypass SW/HTTP application caches and always re-read server grants.
- **Bundles/assets:** fresh offline deep link renders a previously completed private bundle with HTTP cache disabled; all required images/fonts/generated outputs available. No Ready state after failed/missing asset, wrong hash/MIME, account mismatch or incomplete transaction. Same URL under two owners/rituals cannot leak across keys. Private payloads/sentinels appear in no shared SW/HTTP cache; expired blob URLs and source-only blobs stop rendering.
- **Recovery/migration:** mixed old accounts, raw pending insert/update/delete, corrupt/unattributed records, a pending unconfirmed create, and new draft text inside the debounce window survive migration/sign-out/expiry byte-for-byte but remain locked. A full/quota-blocked recovery store aborts destructive migration. Fresh verified target capability is required before reopen/export. No automatic adoption or replay under another identity/backend.
- **Cleanup:** crash after epoch invalidation but before blob purge resumes cleanup on next start. Blocked deletion reports failure and stays locked. Other accounts' unique recovery, anonymous study data and unrelated browser databases remain untouched.

## Implemented repository evidence

The repository uses one dedicated database and explicit renewable-store cleanup.
Sign-out commits its account fence before purge; failure leaves cleanup pending
and blocks reauthentication from bypassing it. Protected reads bracket IDB access
and commit with permission/time checks. Latest check IDs fence old responses;
each complete bundle keeps its own lease so a different download cannot extend
old bytes. Source permission gates source, draft recovery, copy/export and outbox
claims separately from rendered reading.

Draft CAS preserves conflicting local work as a separate variant. The SQL-v2
save outbox retains exact payload JSON, checksum and operation ID. Checksum
verification occurs outside IDB, followed by an exact payload/checksum comparison
inside the claim transaction. Two tabs claim once; a lost sender's lease expires
after 60 seconds and retries the same operation. A late acknowledgement may be
retained as locked metadata but cannot renew access or overwrite a newer draft.

The 58 repository cases pass with real Dexie over fake-indexeddb, including
transaction rollback, input mutation during awaits, expiry during reads/commit,
account fencing, source downgrade and preservation of conflicting work. Nine
native Chromium 152 scenarios verify real PNG Blob persistence and decoding,
full browser restart, two-tab check/claim coordination, exact retries, expiry,
revocation, cleanup failure across restart and account isolation. Scoped injected
quota/deletion failures prove native transaction rollback; they do not simulate
actual disk exhaustion or browser eviction. No external requests or page errors
occurred, and the owned browser/server were stopped. Evidence:
`/tmp/magickli-dexie-repository/browser/`. Root and browser source hashes match;
the lease copy differs only in a documentation word (`proposal` versus `policy`).

The permission boundary adds 135 service/parser cases, with 100% measured
coverage of the checker, parser and shared output selector. Eight additional
Dexie cases verify that check-only grants renew source capability independently,
without installing or renewing any bundle bytes. Accepted source installation
requires the latest request's explicit accepted lease ID to match the current
grant. A newly begun, unaccepted check cannot borrow an earlier lease. Read-only
downgrade removes source snapshots and locks recovery even if output is unavailable.
The full integrated suite passes 1,246 default tests, 42-module coverage, types,
Biome, ordinary Loom checks and production build. Evidence:
`/tmp/magickli-permission-check/`, `/tmp/magickli-check-only-repository/` and
`/tmp/magickli-permission-*.log`.

These tests do not establish runtime auth transport, BFCache UI, renderer/media
cleanup, a private service-worker shell or legacy migration acceptance. Those
integration checks remain required before downloads activate. The HTTP adapter
must establish uncached same-origin, nonredirected transport before accepting the
strict envelope; generic HTTP errors or malformed bodies never become revocation.
Source responses must bind the requested parent/revision and editor CAS state.
Complete server asset manifests remain a separate requirement for downloads.

## Implemented view lifecycle

The framework-independent coordinator now closes private views synchronously on
startup, hide/resume, expiry, account changes and sign-out. It aborts pending work,
revokes owned Blob URLs and captures the latest editor value before hiding it.
Protected operations have opaque account/generation/deadline tokens and a final
synchronous guard before updating a view. Separate online-check tokens can renew
an absent or expired lease but cannot display protected bytes.

The repository's `runtimeState` returns only identity, cleanup status, capabilities,
deadlines and opaque lease IDs. It checks complete read assets and sweeps all owned
authorizations and each bundle's independent original lease, including downloads
that are not open. An old clock observation applies only to its exact account and
lease; it cannot re-lock a fresh grant after a legitimate clock correction.

Cross-tab sign-out notifications close views before the durable fence. Receiving
tabs keep that old epoch closed until persisted state shows the fence or a new
epoch. A sign-out bound to A cannot silently sign out a newer B discovered during
an async lookup. Cold-start sign-out inspects the stored account when no local
snapshot exists. Generic authentication failures remain separate from explicit
sign-out.

An application-lifetime recovery queue retains opaque persistence handles through
route/coordinator disposal and write failures. It exposes only counts and retry,
with no source/export getter. Subscribers cannot reenter a save and start a second
copy. A future editor adapter must keep uncaptured text in an opaque holder if
capture itself fails, report pending recovery and guard destructive navigation.
This does not promise durability when storage fails and the browser is killed.

All 1,499 default tests, 49-module coverage, types, Biome, ordinary Loom checks and
production build pass. The unit adds 58 tests. Ten native Chromium scenarios use
actual IndexedDB, Blob URLs and BroadcastChannel, including delayed two-tab
sign-out, stale paint, locked recovery, corrected clocks, reentrant retries and
unviewed old-bundle expiry. They use synthetic time/visibility and scoped injected
storage failure, with no external requests or page errors. Evidence:
`/tmp/magickli-offline-lifecycle/` and `/tmp/magickli-offline-lifecycle-*.log`.

This is lifecycle/repository acceptance, not live private-offline activation.
React adapters, beforeunload handling, complete asset delivery, authenticated
transport, legacy recovery migration, private shell/cache policy and end-to-end
reader/editor acceptance remain required. JRT's weak cache and the editor's owned
handle cleanup are now verified separately above; the future private renderer
must still clear its own live trees and references on closure.
