# SQL ritual reader and offline navigation

The ritual catalog now uses the current SQL session and scoped permissions.
Built-in public rituals retain their static routes. SQL public content has an
anonymous-only server reader; private rendered content enters the browser through
the permission/bundle transport and the existing account-scoped Dexie lifecycle.
Old Mongo docs/ObjectId links resolve through the exact retained alias namespace.
An offline alias is retained only when the server confirms its canonical ritual.

The private reader loads verified bundle bytes and asset blobs through the
current account epoch and 14-day lease. Titles, document state and object URLs
are hidden or revoked on lifecycle changes. Rendered state also carries its route
identity so a navigation cannot display the preceding private ritual while the
new one loads. Late session responses cannot reopen a signed-out account.
Runtime/storage failures produce unavailable states, including a device with no
previously verified account.

`/offline/ritual` is an anonymous static shell with a guarded downloaded-ritual
catalog. The service worker warms this exact shell alongside the three built-in
public rituals. It serves both direct offline-library navigation and eligible
private document HTML navigation; API, editor, RSC and prefetch requests cannot
use that fallback. The shell loader verifies anonymous cache policy, build
identity and precached assets. Private responses bypass generic Serwist caches,
and activation removes private entries from known older caches.

The HTTP adapter binds fresh permission, manifest identity and current SQL asset
reads. Permission is rechecked after manifest lookup, so a revoked editor cannot
receive the earlier source lease. Browser asset reads bound and hash decoded
bytes; gzip transport length does not invalidate a correct downloaded image or
permit expansion beyond the manifest limit. R2 bundle storage uses canonical
Loom configuration and the fixed `ritual-bundles` prefix, separate from upload
staging and finalized attachments.

This unit does not publish bundle markers. Imported and newly edited revisions
still need the authenticated asset-planning/publication pipeline. The reader
correctly remains unavailable when publication evidence is incomplete. Global
auth activation, editor integration, real provider/offline acceptance and final
cutover are separate remaining steps.

Root adversarial review covered stale route content, initial anonymous catalog
state, runtime construction failure, delayed identity responses, permission
changes during manifest assembly and first-visit offline navigation. The focused
suite includes real lifecycle/IndexedDB, SQL/PGlite, installed Serwist request
routing and loopback compressed HTTP tests. Evidence is in
`/tmp/magickli-reader-runtime-{tests,types,biome,build}.log`.

The isolated final unit passes 180 tests across 12 files, TypeScript, targeted
Biome, ordinary Loom check and the production build. The compressed-response
test uses only a synthetic local HTTP server; no private content or provider
objects were published. Real deployed acceptance is still pending.
