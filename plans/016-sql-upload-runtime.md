# SQL image upload and legacy public reads

The upload page now selects a ritual the current SQL account can edit. New
PNG/JPEG/GIF/WebP images up to 20 MiB use the reviewed SQL initiation,
conditional R2 upload and image-validation/finalization services. The browser
retains its operation UUID for an uncertain retry. Controls remain fixed during
an upload, and duplicate submissions cannot allocate competing operations.

The private runtime reads only canonical Loom `FILES_S3_*` configuration with
`FILES_STORAGE_PROVIDER=cloudflare-r2`, region `auto` and force-path-style `true`.
Staging and finalized files use disjoint `ritual-staging` and `ritual-files`
prefixes. Missing configuration returns an unavailable result; no ambient AWS
credentials or public bucket fallback is used for new files.

The legacy `/api/file2?sha256=...` route supports reads only. Each public result
requires the exact protected imported snapshot, matching stored object location
and public unowned file metadata. The old AWS environment family is isolated to
that reader, including the historical endpoint containing the bucket suffix.
The reader preserves SVG links with sandbox/nosniff headers and supports Unicode
filenames through an ASCII fallback and RFC 5987 disposition. Private attachments
cannot become public through this route.

This unit also introduces shared SQL route-reader wiring and narrowly scoped
Mongo docs/ObjectId alias resolution, needed by the upload selector and upcoming
reader. Anonymous SQL reads use a separate reader whose identity cannot widen.

The upload receipt attaches the stored file to its ritual. Source insertion and
publication of completed offline bundles remain the next integration: the
existing asset inventory does not yet recognize a new private attachment locator.
This commit does not claim that an attached image already appears in a ritual,
activate the planned Loom files manifest, change live environment variables,
upload objects, import SQL data or deploy the app.

Root adversarial review corrected selection changes during upload, duplicate
submissions and Unicode filename failures. The isolated validation covers 251
focused tests across 11 files, TypeScript, targeted Biome, ordinary Loom check
and a production build. Build evidence is recorded in
`/tmp/magickli-upload-runtime-build.log`; focused evidence is in
`/tmp/magickli-upload-runtime-{tests,types}.log`.
